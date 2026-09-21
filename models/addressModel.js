import { query, withConnection } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import { getOrganizationId } from "../lib/tenant.js";

function rowToAddress(row) {
  if (!row) return null;
  const address = {
    _id: row.id,
    user: row.customer_id,
    label: row.label,
    fullName: row.full_name,
    phone: row.phone,
    street: row.street,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    country: row.country,
    isDefault: !!row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  address.save = async function save() {
    return saveAddress(this);
  };
  return address;
}

async function findByUser(userId) {
  const rows = await query(
    `SELECT * FROM addresses
      WHERE organization_id = ? AND customer_id = ? AND deleted_at IS NULL
      ORDER BY is_default DESC, created_at DESC`,
    [getOrganizationId(), userId],
  );
  return rows.map(rowToAddress);
}

async function findByIdForUser(id, userId) {
  const rows = await query(
    "SELECT * FROM addresses WHERE organization_id = ? AND id = ? AND customer_id = ? AND deleted_at IS NULL",
    [getOrganizationId(), id, userId],
  );
  return rowToAddress(rows[0]);
}

// Mirrors the old pre("save") hook: setting isDefault clears every other
// address's flag for the same user, inside the same transaction as the
// write itself.
async function clearOtherDefaults(conn, userId, excludeId) {
  await conn.query(
    "UPDATE addresses SET is_default = 0 WHERE organization_id = ? AND customer_id = ? AND id != ?",
    [getOrganizationId(), userId, excludeId || ""],
  );
}

async function create(data) {
  const id = generateObjectId();
  await withConnection(async (conn) => {
    if (data.isDefault) await clearOtherDefaults(conn, data.user, id);
    await conn.query(
      `INSERT INTO addresses (id, organization_id, customer_id, label, full_name, phone, street, city, state, postal_code, country, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, getOrganizationId(), data.user, data.label || "home", data.fullName, data.phone, data.street, data.city, data.state || "", data.postalCode, data.country || "Bangladesh", data.isDefault ? 1 : 0],
    );
  });
  return findByIdForUser(id, data.user);
}

async function saveAddress(address) {
  await withConnection(async (conn) => {
    if (address.isDefault) await clearOtherDefaults(conn, address.user, address._id);
    await conn.query(
      `UPDATE addresses SET label=?, full_name=?, phone=?, street=?, city=?, state=?, postal_code=?, country=?, is_default=?
        WHERE organization_id=? AND id=?`,
      [address.label, address.fullName, address.phone, address.street, address.city, address.state || "", address.postalCode, address.country, address.isDefault ? 1 : 0, getOrganizationId(), address._id],
    );
  });
  return address;
}

async function deleteForUser(id, userId) {
  const result = await query(
    "DELETE FROM addresses WHERE organization_id = ? AND id = ? AND customer_id = ?",
    [getOrganizationId(), id, userId],
  );
  return result.affectedRows > 0;
}

const Address = { findByUser, findByIdForUser, create, deleteForUser };

export default Address;
