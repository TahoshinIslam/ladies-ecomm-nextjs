import bcrypt from "bcryptjs";

import { query } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";

// SQL-backed replacement for the old Mongoose user model. Keeps the exact
// same field names the rest of the app already reads/writes (_id, role,
// permissions, isVerified, firstOrderPromoUsed, ...) so services/routes/
// views that consume a user object need minimal changes — only the calls
// that used to chain Mongoose query builders (`.select().lean()`, etc.)
// change shape. See models/README-migration.md for the general pattern
// every model in this directory follows.

function rowToUser(row) {
  if (!row) return null;
  const user = {
    _id: row.id,
    name: row.name,
    email: row.email,
    password: row.password,
    role: row.role,
    permissions: typeof row.permissions === "string" ? JSON.parse(row.permissions) : row.permissions || [],
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
        `INSERT INTO users
           (id, name, email, password, role, permissions, avatar, phone, is_verified,
            reset_password_token, reset_password_expires, login_attempts, lock_until,
            last_login, first_order_promo_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          this._id,
          this.name,
          this.email.toLowerCase().trim(),
          this.password,
          this.role,
          JSON.stringify(this.permissions || []),
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
      `UPDATE users SET
         name = ?, email = ?, password = ?, role = ?, permissions = ?, avatar = ?, phone = ?,
         is_verified = ?, reset_password_token = ?, reset_password_expires = ?,
         login_attempts = ?, lock_until = ?, last_login = ?, first_order_promo_used = ?
       WHERE id = ?`,
      [
        this.name,
        this.email.toLowerCase().trim(),
        this.password,
        this.role,
        JSON.stringify(this.permissions || []),
        this.avatar || "",
        this.phone || "",
        this.isVerified ? 1 : 0,
        this.resetPasswordToken ?? null,
        this.resetPasswordExpires ?? null,
        this.loginAttempts || 0,
        this.lockUntil ?? null,
        this.lastLogin ?? null,
        this.firstOrderPromoUsed ? 1 : 0,
        this._id,
      ],
    );
    return this;
  };

  user.deleteOne = async function deleteOne() {
    await query("DELETE FROM users WHERE id = ?", [this._id]);
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
    await query("UPDATE users SET login_attempts = ?, lock_until = ? WHERE id = ?", [
      this.loginAttempts,
      this.lockUntil,
      this._id,
    ]);
  };

  user.resetLoginAttempts = async function resetLoginAttempts() {
    this.loginAttempts = 0;
    this.lockUntil = null;
    this.lastLogin = new Date();
    await query("UPDATE users SET login_attempts = 0, lock_until = NULL, last_login = ? WHERE id = ?", [
      this.lastLogin,
      this._id,
    ]);
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
  const rows = await query(`SELECT * FROM users WHERE ${sql} LIMIT 1`, params);
  return rowToUser(rows[0]);
}

async function findById(id) {
  if (!id) return null;
  return findOne({ _id: id });
}

async function create({ name, email, password, role, permissions, avatar, phone, isVerified }) {
  const user = rowToUser({
    id: generateObjectId(),
    name,
    email: String(email).toLowerCase().trim(),
    password,
    role: role || "customer",
    permissions: JSON.stringify(permissions || []),
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

const SORT_COLUMNS = { name: "name", email: "email", role: "role", createdAt: "created_at" };

async function find(filter = {}, { sort, skip = 0, limit = 1000 } = {}) {
  const clauses = [];
  const params = [];
  if (filter.role) {
    clauses.push("role = ?");
    params.push(filter.role);
  }
  if (filter.$or) {
    // Only shape actually used: [{name: RegExp}, {email: RegExp}] for the
    // admin users search box — translated to a MySQL LIKE on both columns.
    const term = filter.$or[0]?.name?.source ?? filter.$or[0]?.name ?? "";
    const like = `%${String(term).replace(/\\(.)/g, "$1")}%`;
    clauses.push("(name LIKE ? OR email LIKE ?)");
    params.push(like, like);
  }
  const where = clauses.length ? clauses.join(" AND ") : "1=1";
  const sortCol = SORT_COLUMNS[sort?.field] || "created_at";
  const sortDir = sort?.dir === 1 ? "ASC" : "DESC";
  const rows = await query(
    `SELECT * FROM users WHERE ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(skip)],
  );
  return rows.map(rowToUser);
}

async function countDocuments(filter = {}) {
  const clauses = [];
  const params = [];
  if (filter.role) {
    clauses.push("role = ?");
    params.push(filter.role);
  }
  if (filter.$or) {
    const term = filter.$or[0]?.name?.source ?? filter.$or[0]?.name ?? "";
    const like = `%${String(term).replace(/\\(.)/g, "$1")}%`;
    clauses.push("(name LIKE ? OR email LIKE ?)");
    params.push(like, like);
  }
  const where = clauses.length ? clauses.join(" AND ") : "1=1";
  const rows = await query(`SELECT COUNT(*) AS n FROM users WHERE ${where}`, params);
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
  const sql = "UPDATE users SET first_order_promo_used = 1 WHERE id = ? AND first_order_promo_used = 0";
  if (conn) {
    const [result] = await conn.query(sql, [userId]);
    return result.affectedRows > 0;
  }
  const result = await query(sql, [userId]);
  return result.affectedRows > 0;
}

/** Read-only check (preview mode: `commit=false` in services/orderService.js). */
async function hasUnusedFirstOrderPromo(userId, conn) {
  const sql = "SELECT first_order_promo_used FROM users WHERE id = ?";
  const rows = conn ? (await conn.query(sql, [userId]))[0] : await query(sql, [userId]);
  if (!rows.length) return false;
  return !rows[0].first_order_promo_used;
}

/** Every admin/employee's id — the fan-out list for createAdminNotification(). */
async function findStaffIds() {
  const rows = await query("SELECT id FROM users WHERE role IN ('admin', 'employee')");
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
