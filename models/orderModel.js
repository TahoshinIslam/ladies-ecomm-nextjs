import { query, withConnection } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import { getOrganizationId } from "../lib/tenant.js";
import User from "./userModel.js";

function rowToItem(row) {
  return {
    product: row.product_id,
    variantId: row.variant_id,
    quantity: row.quantity,
    snapshot: {
      name: row.snapshot_name,
      sku: row.snapshot_sku,
      attributes: typeof row.snapshot_attributes === "string" ? JSON.parse(row.snapshot_attributes) : row.snapshot_attributes || {},
      price: Number(row.snapshot_price),
      image: row.snapshot_image,
    },
  };
}

async function loadItems(orderIds) {
  if (!orderIds.length) return new Map();
  const rows = await query(
    `SELECT * FROM order_items
      WHERE organization_id = ? AND order_id IN (${orderIds.map(() => "?").join(",")})
      ORDER BY position ASC`,
    [getOrganizationId(), ...orderIds],
  );
  const map = new Map();
  for (const r of rows) {
    const list = map.get(r.order_id) || [];
    list.push(rowToItem(r));
    map.set(r.order_id, list);
  }
  return map;
}

function rowToOrder(row, items, user) {
  if (!row) return null;
  const order = {
    _id: row.id,
    user: user ?? row.customer_id,
    items: items || [],
    shippingAddress: {
      fullName: row.shipping_full_name,
      phone: row.shipping_phone,
      street: row.shipping_street,
      city: row.shipping_city,
      state: row.shipping_state,
      postalCode: row.shipping_postal_code,
      country: row.shipping_country,
    },
    coupon: row.coupon_id,
    subtotal: Number(row.subtotal),
    tax: Number(row.tax),
    taxLabel: row.tax_label,
    shippingCost: Number(row.shipping_cost),
    shippingTier: row.shipping_tier,
    discount: Number(row.discount),
    total: Number(row.total),
    region: row.shipping_region,
    currency: row.currency,
    status: row.status,
    paymentMethod: row.payment_method,
    trackingNumber: row.tracking_number,
    deliveredAt: row.delivered_at,
    notes: row.notes,
    idempotencyKeyHash: row.idempotency_key_hash,
    idempotencyRequestHash: row.idempotency_request_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  order.save = async function save() {
    return saveOrder(this);
  };
  return order;
}

async function hydrateOne(row, { populateUser = false } = {}) {
  if (!row) return null;
  const items = (await loadItems([row.id])).get(row.id) || [];
  const user = populateUser ? await User.findById(row.customer_id) : undefined;
  const userSummary = populateUser && user ? { _id: user._id, name: user.name, email: user.email } : undefined;
  return rowToOrder(row, items, userSummary);
}

async function findById(id, opts) {
  if (!id) return null;
  const rows = await query(
    "SELECT * FROM orders WHERE organization_id = ? AND id = ? AND deleted_at IS NULL",
    [getOrganizationId(), id],
  );
  return hydrateOne(rows[0], opts);
}

/** Locks the order row for the rest of the caller's transaction (SELECT ... FOR UPDATE) and returns it fully hydrated — used by cancelOrder() so the read-modify-write is race-free against a concurrent cancel/status-update on the same order. */
async function findByIdForUpdate(conn, id) {
  const [rows] = await conn.query(
    "SELECT * FROM orders WHERE organization_id = ? AND id = ? AND deleted_at IS NULL FOR UPDATE",
    [getOrganizationId(), id],
  );
  if (!rows.length) return null;
  const [itemRows] = await conn.query(
    "SELECT * FROM order_items WHERE organization_id = ? AND order_id = ? ORDER BY position ASC",
    [getOrganizationId(), id],
  );
  return rowToOrder(rows[0], itemRows.map(rowToItem));
}

async function findByIdempotencyKey(userId, keyHash) {
  const rows = await query(
    `SELECT * FROM orders
      WHERE organization_id = ? AND customer_id = ? AND idempotency_key_hash = ? AND deleted_at IS NULL`,
    [getOrganizationId(), userId, keyHash],
  );
  return hydrateOne(rows[0]);
}

async function findMyOrders(userId) {
  const rows = await query(
    `SELECT * FROM orders
      WHERE organization_id = ? AND customer_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    [getOrganizationId(), userId],
  );
  const itemsByOrder = await loadItems(rows.map((r) => r.id));
  return rows.map((r) => rowToOrder(r, itemsByOrder.get(r.id) || []));
}

const ADMIN_SORT_COLUMNS = { createdAt: "created_at", total: "total", status: "status" };

async function findAdminList({ status, search, sortBy, sortOrder, skip, limit }) {
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push("o.status = ?");
    params.push(status);
  }
  if (search && String(search).trim()) {
    const term = String(search).trim();
    clauses.push("(o.id LIKE ? OR c.name LIKE ? OR c.email LIKE ?)");
    params.push(`%${term}%`, `%${term}%`, `%${term}%`);
  }
  const filters = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
  const sortCol = `o.${ADMIN_SORT_COLUMNS[sortBy] || "created_at"}`;
  const sortDir = sortOrder === "asc" ? "ASC" : "DESC";

  // The buyer joins from `customers` now, and the join carries the scope
  // too: matching on id alone would let a shopper of another store supply
  // the name on this store's order if the ids ever collided.
  const rows = await query(
    `SELECT o.*, c.name AS user_name, c.email AS user_email
     FROM orders o
     LEFT JOIN customers c ON c.id = o.customer_id AND c.organization_id = o.organization_id
     WHERE o.organization_id = ? AND o.deleted_at IS NULL ${filters}
     ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
    [getOrganizationId(), ...params, Number(limit), Number(skip)],
  );
  const totalRows = await query(
    `SELECT COUNT(*) AS n FROM orders o
     LEFT JOIN customers c ON c.id = o.customer_id AND c.organization_id = o.organization_id
     WHERE o.organization_id = ? AND o.deleted_at IS NULL ${filters}`,
    [getOrganizationId(), ...params],
  );
  const itemsByOrder = await loadItems(rows.map((r) => r.id));
  const orders = rows.map((r) =>
    rowToOrder(r, itemsByOrder.get(r.id) || [], { _id: r.customer_id, name: r.user_name, email: r.user_email }),
  );
  return { orders, total: totalRows[0].n };
}

async function create(data, conn) {
  const id = generateObjectId();
  await conn.query(
    `INSERT INTO orders
       (id, organization_id, customer_id, coupon_id, shipping_full_name, shipping_phone, shipping_street,
        shipping_city, shipping_state, shipping_postal_code, shipping_country, subtotal, tax, tax_label,
        shipping_cost, shipping_tier, discount, total, shipping_region, currency, status, notes,
        idempotency_key_hash, idempotency_request_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      getOrganizationId(),
      data.user,
      data.coupon || null,
      data.shippingAddress.fullName,
      data.shippingAddress.phone,
      data.shippingAddress.street,
      data.shippingAddress.city,
      data.shippingAddress.state || "",
      data.shippingAddress.postalCode,
      data.shippingAddress.country,
      data.subtotal,
      data.tax || 0,
      data.taxLabel || "",
      data.shippingCost || 0,
      data.shippingTier || "",
      data.discount || 0,
      data.total,
      data.region || "BD",
      data.currency || "BDT",
      data.status || "pending",
      data.notes || "",
      data.idempotencyKeyHash,
      data.idempotencyRequestHash,
    ],
  );
  for (let i = 0; i < data.items.length; i++) {
    const it = data.items[i];
    await conn.query(
      `INSERT INTO order_items (organization_id, order_id, product_id, variant_id, quantity, snapshot_name,
         snapshot_sku, snapshot_attributes, snapshot_price, snapshot_image, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        it.product,
        it.variantId,
        it.quantity,
        it.snapshot.name,
        it.snapshot.sku || "",
        JSON.stringify(it.snapshot.attributes || {}),
        it.snapshot.price,
        it.snapshot.image || "",
        i,
      ],
    );
  }
  const [rows] = await conn.query(
    "SELECT * FROM orders WHERE organization_id = ? AND id = ? AND deleted_at IS NULL",
    [getOrganizationId(), id],
  );
  const items = data.items.map((it) => ({ product: it.product, variantId: it.variantId, quantity: it.quantity, snapshot: it.snapshot }));
  return rowToOrder(rows[0], items);
}

async function saveOrder(order) {
  await withConnection(async (conn) => {
    await conn.query(
      `UPDATE orders SET status=?, payment_method=?, tracking_number=?, delivered_at=?, notes=?
        WHERE organization_id=? AND id=?`,
      [
        order.status,
        order.paymentMethod || "",
        order.trackingNumber || "",
        order.deliveredAt ?? null,
        order.notes || "",
        getOrganizationId(),
        order._id,
      ],
    );
  });
  return order;
}

/** Same update, but runs on the caller's own transaction connection (order cancellation, coupon/stock rollback all need to commit or roll back together). */
async function saveOrderOnConnection(conn, order) {
  await conn.query(
    `UPDATE orders SET status=?, payment_method=?, tracking_number=?, delivered_at=?, notes=?
      WHERE organization_id=? AND id=?`,
    [
        order.status,
        order.paymentMethod || "",
        order.trackingNumber || "",
        order.deliveredAt ?? null,
        order.notes || "",
        getOrganizationId(),
        order._id,
      ],
  );
  return order;
}

/** Every product a user has in a delivered order — reviewService.js's eligibility check/list. */
async function findDeliveredProductIdsByUser(userId) {
  const rows = await query(
    `SELECT DISTINCT oi.product_id FROM order_items oi
     JOIN orders o ON o.id = oi.order_id AND o.organization_id = oi.organization_id
     WHERE o.organization_id = ? AND o.customer_id = ? AND o.status = 'delivered' AND o.deleted_at IS NULL`,
    [getOrganizationId(), userId],
  );
  return rows.map((r) => r.product_id);
}

async function existsDeliveredWithProduct(userId, productId) {
  const rows = await query(
    `SELECT 1 FROM order_items oi
     JOIN orders o ON o.id = oi.order_id AND o.organization_id = oi.organization_id
     WHERE o.organization_id = ? AND o.customer_id = ? AND o.status = 'delivered'
       AND o.deleted_at IS NULL AND oi.product_id = ? LIMIT 1`,
    [getOrganizationId(), userId, productId],
  );
  return rows.length > 0;
}

const Order = {
  findById,
  findByIdForUpdate,
  findDeliveredProductIdsByUser,
  existsDeliveredWithProduct,
  findByIdempotencyKey,
  findMyOrders,
  findAdminList,
  create,
  saveOrderOnConnection,
};

export default Order;
