import { query, withConnection } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import { getOrganizationId } from "../lib/tenant.js";

function rowToCoupon(row, categories) {
  if (!row) return null;
  const coupon = {
    _id: row.id,
    code: row.code,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    minOrderAmount: Number(row.min_order_amount || 0),
    maxDiscount: row.max_discount == null ? null : Number(row.max_discount),
    usageLimit: row.usage_limit,
    usedCount: row.used_count,
    perUserLimit: row.per_user_limit,
    applicableCategories: categories || [],
    expiresAt: row.expires_at,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  coupon.isValid = function isValid() {
    const now = new Date();
    if (!this.isActive) return { valid: false, reason: "Coupon is inactive" };
    if (this.expiresAt < now) return { valid: false, reason: "Coupon has expired" };
    if (this.usageLimit !== null && this.usedCount >= this.usageLimit) {
      return { valid: false, reason: "Coupon usage limit reached" };
    }
    return { valid: true };
  };
  return coupon;
}

async function loadCategories(couponId) {
  const rows = await query(
    "SELECT category_id FROM coupon_categories WHERE organization_id = ? AND coupon_id = ?",
    [getOrganizationId(), couponId],
  );
  return rows.map((r) => r.category_id);
}

async function findById(id) {
  if (!id) return null;
  const rows = await query(
    "SELECT * FROM coupons WHERE organization_id = ? AND id = ? AND deleted_at IS NULL",
    [getOrganizationId(), id],
  );
  if (!rows.length) return null;
  return rowToCoupon(rows[0], await loadCategories(id));
}

async function findByCode(code) {
  const rows = await query(
    "SELECT * FROM coupons WHERE organization_id = ? AND code = ? AND deleted_at IS NULL",
    [getOrganizationId(), String(code || "").toUpperCase()],
  );
  if (!rows.length) return null;
  return rowToCoupon(rows[0], await loadCategories(rows[0].id));
}

/** `conn`-aware variant for use inside services/orderService.js's transaction. */
async function findByCodeActive(code, conn) {
  const sql =
    "SELECT * FROM coupons WHERE organization_id = ? AND code = ? AND is_active = 1 AND deleted_at IS NULL";
  const params = [getOrganizationId(), String(code || "").toUpperCase()];
  const rows = conn ? (await conn.query(sql, params))[0] : await query(sql, params);
  if (!rows.length) return null;
  return rowToCoupon(rows[0], await loadCategories(rows[0].id));
}

async function writeCategories(conn, couponId, categoryIds) {
  const organizationId = getOrganizationId();
  await conn.query("DELETE FROM coupon_categories WHERE organization_id = ? AND coupon_id = ?", [
    organizationId,
    couponId,
  ]);
  for (const categoryId of categoryIds || []) {
    await conn.query(
      "INSERT IGNORE INTO coupon_categories (organization_id, coupon_id, category_id) VALUES (?, ?, ?)",
      [organizationId, couponId, categoryId],
    );
  }
}

async function create(data) {
  const id = generateObjectId();
  await withConnection(async (conn) => {
    await conn.query(
      `INSERT INTO coupons (id, organization_id, code, discount_type, discount_value, min_order_amount, max_discount,
         usage_limit, used_count, per_user_limit, expires_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        getOrganizationId(),
        String(data.code).toUpperCase(),
        data.discountType,
        data.discountValue,
        data.minOrderAmount || 0,
        data.maxDiscount ?? null,
        data.usageLimit ?? null,
        // Real admin-facing creation never sets this explicitly (the
        // schema-validated create body has no usedCount field — a brand
        // new coupon always starts at 0) — but test fixtures legitimately
        // need to seed a coupon that's already partially/fully used, so an
        // explicit value here is honored rather than silently dropped.
        data.usedCount ?? 0,
        data.perUserLimit ?? 1,
        data.expiresAt,
        data.isActive === false ? 0 : 1,
      ],
    );
    await writeCategories(conn, id, data.applicableCategories);
  });
  return findById(id);
}

async function update(id, data) {
  const existing = await findById(id);
  if (!existing) return null;
  const merged = { ...existing, ...data };
  await withConnection(async (conn) => {
    await conn.query(
      `UPDATE coupons SET code=?, discount_type=?, discount_value=?, min_order_amount=?, max_discount=?,
         usage_limit=?, per_user_limit=?, expires_at=?, is_active=?
        WHERE organization_id=? AND id=?`,
      [
        String(merged.code).toUpperCase(),
        merged.discountType,
        merged.discountValue,
        merged.minOrderAmount || 0,
        merged.maxDiscount ?? null,
        merged.usageLimit ?? null,
        merged.perUserLimit ?? 1,
        merged.expiresAt,
        merged.isActive === false ? 0 : 1,
        getOrganizationId(),
        id,
      ],
    );
    if (data.applicableCategories !== undefined) await writeCategories(conn, id, data.applicableCategories);
  });
  return findById(id);
}

async function deleteById(id) {
  // Soft delete, as the dashboard does — a coupon still referenced by an
  // order's `coupon_id` must remain resolvable after it is withdrawn.
  const result = await query(
    "UPDATE coupons SET deleted_at = NOW(3) WHERE organization_id = ? AND id = ? AND deleted_at IS NULL",
    [getOrganizationId(), id],
  );
  return result.affectedRows > 0;
}

const SORT_COLUMNS = { code: "code", expiresAt: "expires_at", usedCount: "used_count", createdAt: "created_at" };

function buildAdminWhere({ search, status }) {
  const clauses = [];
  const params = [];
  if (search && String(search).trim()) {
    clauses.push("code LIKE ?");
    params.push(`%${String(search).trim()}%`);
  }
  // A JS-computed cutoff, not SQL's NOW() — same reasoning as
  // lib/expiryCleanup.js's expiredWhereClause() and
  // models/sessionModel.js's findActiveIdsByUser(): this server's MySQL
  // `NOW()` returns local system time while `expires_at` is stored as UTC,
  // so comparing against NOW() here would misclassify a coupon's
  // active/expired status by the server's own UTC offset.
  if (status === "active") {
    clauses.push("is_active = 1 AND expires_at >= ?");
    params.push(new Date());
  } else if (status === "paused") {
    clauses.push("is_active = 0");
  } else if (status === "expired") {
    clauses.push("expires_at < ?");
    params.push(new Date());
  }
  return { where: clauses.length ? clauses.join(" AND ") : "1=1", params };
}

async function findAdminList({ search, status, sortBy, sortOrder, skip, limit }) {
  const { where, params } = buildAdminWhere({ search, status });
  const sortCol = SORT_COLUMNS[sortBy] || "created_at";
  const sortDir = sortOrder === "asc" ? "ASC" : "DESC";
  const filters = where === "1=1" ? "" : `AND ${where}`;
  const rows = await query(
    `SELECT * FROM coupons
      WHERE organization_id = ? AND deleted_at IS NULL ${filters}
      ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
    [getOrganizationId(), ...params, Number(limit), Number(skip)],
  );
  return Promise.all(rows.map(async (r) => rowToCoupon(r, await loadCategories(r.id))));
}

async function countAdminList({ search, status }) {
  const { where, params } = buildAdminWhere({ search, status });
  const filters = where === "1=1" ? "" : `AND ${where}`;
  const rows = await query(
    `SELECT COUNT(*) AS n FROM coupons WHERE organization_id = ? AND deleted_at IS NULL ${filters}`,
    [getOrganizationId(), ...params],
  );
  return rows[0].n;
}

/** Atomic, guarded global-usage claim inside an order-creation transaction — mirrors the old guarded $inc with a usageLimit re-check at write time. */
async function claimGlobalUsage(conn, couponId) {
  const [result] = await conn.query(
    `UPDATE coupons SET used_count = used_count + 1
      WHERE organization_id = ? AND id = ? AND (usage_limit IS NULL OR used_count < usage_limit)`,
    [getOrganizationId(), couponId],
  );
  return result.affectedRows === 1;
}

/** Reverses claimGlobalUsage() on order cancellation. */
async function restoreGlobalUsage(conn, couponId) {
  await conn.query(
    "UPDATE coupons SET used_count = used_count - 1 WHERE organization_id = ? AND id = ? AND used_count > 0",
    [getOrganizationId(), couponId],
  );
}

const Coupon = {
  findById,
  findByCode,
  findByCodeActive,
  create,
  update,
  deleteById,
  findAdminList,
  countAdminList,
  claimGlobalUsage,
  restoreGlobalUsage,
};

export default Coupon;
