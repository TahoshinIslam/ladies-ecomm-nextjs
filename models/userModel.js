import bcrypt from "bcryptjs";

import { query } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import { getOrganizationId } from "../lib/tenant.js";

// SQL-backed replacement for the old Mongoose user model. Keeps the exact
// same field names the rest of the app already reads/writes (_id, role,
// permissions, isVerified, firstOrderPromoUsed, ...) so services/routes/
// views that consume a user object need minimal changes — only the calls
// that used to chain Mongoose query builders (`.select().lean()`, etc.)
// change shape. See models/README-migration.md for the general pattern
// every model in this directory follows.
//
// This model reads `customers`, not `users`. In the shared database `users`
// is the dashboard's staff table and `customers` is the shoppers' — the
// split migration 052 made, because one table holding both meant a shopper
// and a staff member were the same kind of row with a `role` column telling
// them apart.
//
// Two columns did not come across with it. `role` and `permissions` do not
// exist on `customers`: a shopper has no role here, and staff permissions
// are the dashboard's RBAC tables, not a JSON blob on the person. Everything
// this model returns therefore reports role "customer", which is what every
// row in this table now is.

function rowToUser(row) {
  if (!row) return null;
  const user = {
    _id: row.id,
    name: row.name,
    email: row.email,
    password: row.password,
    // Not columns any more — every row in `customers` is a shopper. Kept on
    // the returned object so callers that read `.role` still work.
    role: "customer",
    permissions: [],
    avatar: row.avatar,
    phone: row.phone,
    isVerified: !!row.is_verified,
    resetPasswordToken: row.reset_password_token,
    resetPasswordExpires: row.reset_password_expires,
    loginAttempts: row.login_attempts,
    lockUntil: row.lock_until,
    lastLogin: row.last_login,
    firstOrderPromoUsed: !!row.first_order_promo_used,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  Object.defineProperty(user, "isLocked", {
    enumerable: true,
    get() {
      return !!(this.lockUntil && new Date(this.lockUntil).getTime() > Date.now());
    },
  });
  attachInstanceMethods(user);
  return user;
}

// bcryptjs hashes always look like $2a$12$... / $2b$12$... — used to detect
// "this.password currently holds a NEW plaintext value that needs hashing"
// without separate dirty-tracking state, mirroring Mongoose's pre("save")
// `isModified("password")` hook closely enough: whatever plaintext a
// caller assigns to `.password` gets hashed the next time `.save()` runs,
// and an already-hashed value (loaded from the DB, or already hashed by an
// earlier save() in the same request) is left alone.
const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/;

function attachInstanceMethods(user) {
  user.matchPassword = async function matchPassword(entered) {
    return bcrypt.compare(entered, this.password);
  };

  user.save = async function save() {
    if (this.password && !BCRYPT_HASH_RE.test(this.password)) {
      this.password = await bcrypt.hash(this.password, 12);
    }
    if (this.__isNew) {
      await query(
        `INSERT INTO customers
           (id, organization_id, name, email, password, avatar, phone, is_verified,
            reset_password_token, reset_password_expires, login_attempts, lock_until,
            last_login, first_order_promo_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          this._id,
          getOrganizationId(),
          this.name,
          this.email.toLowerCase().trim(),
          this.password,
          this.avatar || "",
          this.phone || "",
          this.isVerified ? 1 : 0,
          this.resetPasswordToken ?? null,
          this.resetPasswordExpires ?? null,
          this.loginAttempts || 0,
          this.lockUntil ?? null,
          this.lastLogin ?? null,
          this.firstOrderPromoUsed ? 1 : 0,
        ],
      );
      delete this.__isNew;
      return this;
    }

    await query(
      `UPDATE customers SET
         name = ?, email = ?, password = ?, avatar = ?, phone = ?,
         is_verified = ?, reset_password_token = ?, reset_password_expires = ?,
         login_attempts = ?, lock_until = ?, last_login = ?, first_order_promo_used = ?
       WHERE organization_id = ? AND id = ?`,
      [
        this.name,
        this.email.toLowerCase().trim(),
        this.password,
        this.avatar || "",
        this.phone || "",
        this.isVerified ? 1 : 0,
        this.resetPasswordToken ?? null,
        this.resetPasswordExpires ?? null,
        this.loginAttempts || 0,
        this.lockUntil ?? null,
        this.lastLogin ?? null,
        this.firstOrderPromoUsed ? 1 : 0,
        getOrganizationId(),
        this._id,
      ],
    );
    return this;
  };

  user.deleteOne = async function deleteOne() {
    await query("DELETE FROM customers WHERE organization_id = ? AND id = ?", [getOrganizationId(), this._id]);
  };

  user.incLoginAttempts = async function incLoginAttempts() {
    if (this.lockUntil && new Date(this.lockUntil).getTime() < Date.now()) {
      this.loginAttempts = 1;
      this.lockUntil = null;
    } else {
      this.loginAttempts = (this.loginAttempts || 0) + 1;
      if (this.loginAttempts >= 5 && !this.isLocked) {
        this.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
    }
    await query("UPDATE customers SET login_attempts = ?, lock_until = ? WHERE organization_id = ? AND id = ?", [
      this.loginAttempts,
      this.lockUntil,
      getOrganizationId(),
      this._id,
    ]);
  };

  user.resetLoginAttempts = async function resetLoginAttempts() {
    this.loginAttempts = 0;
    this.lockUntil = null;
    this.lastLogin = new Date();
    await query(
      "UPDATE customers SET login_attempts = 0, lock_until = NULL, last_login = ? WHERE organization_id = ? AND id = ?",
      [this.lastLogin, getOrganizationId(), this._id],
    );
  };
}

function buildSelectClause(select) {
  // `select` mirrors Mongoose's "+field" convention only in spirit — every
  // column is always fetched here (there's no real cost-of-selection
  // difference for a single-row users table the way there was for Mongo's
  // field-level `select:false` on password/loginAttempts/etc.); callers
  // that used `.select("+password")` etc. just get the full row back.
  void select;
  return "*";
}

const WHERE_BUILDERS = {
  email: (v) => ({ sql: "email = ?", params: [String(v).toLowerCase().trim()] }),
  _id: (v) => ({ sql: "id = ?", params: [v] }),
  resetPasswordToken: (v) => ({ sql: "reset_password_token = ?", params: [v] }),
};

function buildWhere(filter = {}) {
  const clauses = [];
  const params = [];
  for (const [key, value] of Object.entries(filter)) {
    if (key === "resetPasswordExpires" && value && typeof value === "object" && "$gt" in value) {
      clauses.push("reset_password_expires > ?");
      params.push(value.$gt);
      continue;
    }
    const builder = WHERE_BUILDERS[key];
    if (!builder) throw new Error(`userModel: unsupported filter field "${key}"`);
    const { sql, params: p } = builder(value);
    clauses.push(sql);
    params.push(...p);
  }
  return { sql: clauses.length ? clauses.join(" AND ") : "1=1", params };
}

async function findOne(filter) {
  const { sql, params } = buildWhere(filter);
  const rows = await query(
    `SELECT * FROM customers WHERE organization_id = ? AND deleted_at IS NULL AND ${sql} LIMIT 1`,
    [getOrganizationId(), ...params],
  );
  return rowToUser(rows[0]);
}

async function findById(id) {
  if (!id) return null;
  return findOne({ _id: id });
}

async function create({ name, email, password, avatar, phone, isVerified }) {
  const user = rowToUser({
    id: generateObjectId(),
    name,
    email: String(email).toLowerCase().trim(),
    password,
    avatar: avatar || "",
    phone: phone || "",
    is_verified: isVerified ? 1 : 0,
    login_attempts: 0,
    first_order_promo_used: 0,
  });
  user.__isNew = true;
  await user.save();
  return user;
}

const SORT_COLUMNS = { name: "name", email: "email", createdAt: "created_at" };

/**
 * `role` is no longer a column. Asking for customers matches every row in
 * this table; asking for staff matches none of them, because staff are not
 * in it — they are dashboard accounts. Returning nothing is the truthful
 * answer to "which shoppers are administrators", rather than an error.
 */
function roleMatchesCustomers(role) {
  return !role || role === "customer";
}

async function find(filter = {}, { sort, skip = 0, limit = 1000 } = {}) {
  if (!roleMatchesCustomers(filter.role)) return [];
  // The scope is in the statement below, not in this list. A caller-driven
  // WHERE that *might* contain `organization_id` is exactly the shape that
  // hides a missing one, so the invariant part is written out where it can
  // be read — and checked — and only the optional filters are assembled.
  const clauses = [];
  const params = [];
  if (filter.$or) {
    // Only shape actually used: [{name: RegExp}, {email: RegExp}] for the
    // admin users search box — translated to a MySQL LIKE on both columns.
    const term = filter.$or[0]?.name?.source ?? filter.$or[0]?.name ?? "";
    const like = `%${String(term).replace(/\\(.)/g, "$1")}%`;
    clauses.push("(name LIKE ? OR email LIKE ?)");
    params.push(like, like);
  }
  const filters = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
  const sortCol = SORT_COLUMNS[sort?.field] || "created_at";
  const sortDir = sort?.dir === 1 ? "ASC" : "DESC";
  const rows = await query(
    `SELECT * FROM customers
      WHERE organization_id = ? AND deleted_at IS NULL ${filters}
      ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
    [getOrganizationId(), ...params, Number(limit), Number(skip)],
  );
  return rows.map(rowToUser);
}

async function countDocuments(filter = {}) {
  if (!roleMatchesCustomers(filter.role)) return 0;
  const clauses = [];
  const params = [];
  if (filter.$or) {
    const term = filter.$or[0]?.name?.source ?? filter.$or[0]?.name ?? "";
    const like = `%${String(term).replace(/\\(.)/g, "$1")}%`;
    clauses.push("(name LIKE ? OR email LIKE ?)");
    params.push(like, like);
  }
  const filters = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
  const rows = await query(
    `SELECT COUNT(*) AS n FROM customers WHERE organization_id = ? AND deleted_at IS NULL ${filters}`,
    [getOrganizationId(), ...params],
  );
  return rows[0].n;
}

/**
 * Atomically flips first_order_promo_used from false->true — the SQL
 * equivalent of the old guarded `findOneAndUpdate({_id, firstOrderPromoUsed:
 * {$ne:true}}, {$set:{firstOrderPromoUsed:true}})`. Returns true if THIS
 * call won the claim, false if it was already used (by an earlier order or
 * a concurrent one). Runs inside the caller's transaction connection when
 * `conn` is passed (order creation), or standalone otherwise (preview mode
 * never commits this).
 */
async function claimFirstOrderPromo(userId, conn) {
  const sql =
    `UPDATE customers SET first_order_promo_used = 1
      WHERE organization_id = ? AND id = ? AND deleted_at IS NULL AND first_order_promo_used = 0`;
  const params = [getOrganizationId(), userId];
  if (conn) {
    const [result] = await conn.query(sql, params);
    return result.affectedRows > 0;
  }
  const result = await query(sql, params);
  return result.affectedRows > 0;
}

/** Read-only check (preview mode: `commit=false` in services/orderService.js). */
async function hasUnusedFirstOrderPromo(userId, conn) {
  // A closed account reports no unused promo rather than an error: the
  // `!rows.length` branch below already means "no promo available", which is
  // the right answer for someone who is not there.
  const sql =
    "SELECT first_order_promo_used FROM customers WHERE organization_id = ? AND id = ? AND deleted_at IS NULL";
  const params = [getOrganizationId(), userId];
  const rows = conn ? (await conn.query(sql, params))[0] : await query(sql, params);
  if (!rows.length) return false;
  return !rows[0].first_order_promo_used;
}

/**
 * Every staff account for this store — the fan-out list for
 * createAdminNotification().
 *
 * This is the one query in this model that deliberately leaves `customers`.
 * Staff are dashboard accounts: rows in `users`, joined to this store
 * through `organization_users`. The old `role IN ('admin','employee')` has
 * no equivalent here, because the column it read no longer exists and the
 * people it found are not in this table.
 *
 * Only Active memberships: someone invited but who has not claimed their
 * account yet, or whose access was suspended, should not be accumulating
 * notifications about orders they cannot open.
 */
async function findStaffIds() {
  const rows = await query(
    `SELECT /* dashboard-table */ u.id
       FROM users u
       JOIN organization_users ou ON ou.user_id = u.id
      WHERE ou.organization_id = ?
        AND ou.status = 'Active'
        AND u.status = 'Active'`,
    [getOrganizationId()],
  );
  return rows.map((r) => r.id);
}

const User = {
  findById,
  findOne,
  find,
  create,
  countDocuments,
  findStaffIds,
  claimFirstOrderPromo,
  hasUnusedFirstOrderPromo,
  buildSelectClause,
};

export default User;
