import { query, withConnection } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import { getOrganizationId } from "../lib/tenant.js";

function rowToItem(row) {
  return {
    _id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    quantity: row.quantity,
    snapshot: {
      sku: row.snapshot_sku,
      attributes: typeof row.snapshot_attributes === "string" ? JSON.parse(row.snapshot_attributes) : row.snapshot_attributes || {},
      price: row.snapshot_price == null ? null : Number(row.snapshot_price),
      image: row.snapshot_image,
    },
  };
}

async function loadItems(cartId) {
  const rows = await query(
    "SELECT * FROM cart_items WHERE organization_id = ? AND cart_id = ? ORDER BY created_at ASC",
    [getOrganizationId(), cartId],
  );
  return rows.map(rowToItem);
}

function rowToCart(row, items) {
  const cart = {
    _id: row.id,
    userId: row.customer_id,
    items: items || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  cart.totalItems = cart.items.reduce((sum, i) => sum + i.quantity, 0);
  cart.save = async function save() {
    return saveCart(this);
  };
  return cart;
}

async function findByUser(userId) {
  const rows = await query("SELECT * FROM carts WHERE organization_id = ? AND customer_id = ?", [
    getOrganizationId(),
    userId,
  ]);
  if (!rows.length) return null;
  return rowToCart(rows[0], await loadItems(rows[0].id));
}

async function create(userId) {
  const id = generateObjectId();
  await query("INSERT INTO carts (id, organization_id, customer_id) VALUES (?, ?, ?)", [
    id,
    getOrganizationId(),
    userId,
  ]);
  return rowToCart({ id, customer_id: userId, created_at: new Date(), updated_at: new Date() }, []);
}

/** Replaces the cart's item list wholesale — matches how services/cartService.js already mutates `cart.items` in memory before calling save(). */
async function saveCart(cart) {
  const organizationId = getOrganizationId();
  await withConnection(async (conn) => {
    await conn.query("DELETE FROM cart_items WHERE organization_id = ? AND cart_id = ?", [organizationId, cart._id]);
    for (const item of cart.items) {
      await conn.query(
        `INSERT INTO cart_items (id, organization_id, cart_id, product_id, variant_id, quantity, snapshot_sku, snapshot_attributes, snapshot_price, snapshot_image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item._id || generateObjectId(),
          organizationId,
          cart._id,
          item.productId,
          item.variantId,
          item.quantity,
          item.snapshot?.sku || "",
          JSON.stringify(item.snapshot?.attributes || {}),
          item.snapshot?.price ?? null,
          item.snapshot?.image || "",
        ],
      );
    }
    await conn.query("UPDATE carts SET updated_at = NOW(3) WHERE organization_id = ? AND id = ?", [
      organizationId,
      cart._id,
    ]);
  });
  return cart;
}

/** Clears every item in one statement — used by order creation inside its own transaction connection. */
async function clearByUser(userId, conn) {
  const sql =
    `DELETE ci FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
      WHERE c.organization_id = ? AND ci.organization_id = ? AND c.customer_id = ?`;
  const params = [getOrganizationId(), getOrganizationId(), userId];
  if (conn) {
    await conn.query(sql, params);
  } else {
    await query(sql, params);
  }
}

const Cart = { findByUser, create, clearByUser };

export default Cart;
