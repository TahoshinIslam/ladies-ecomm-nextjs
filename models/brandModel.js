import slugify from "slugify";

import { query } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import { getOrganizationId } from "../lib/tenant.js";

function rowToBrand(row) {
  if (!row) return null;
  return {
    _id: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo,
    description: row.description,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findById(id) {
  if (!id) return null;
  const rows = await query(
    "SELECT * FROM brands WHERE id = ? AND organization_id = ? AND deleted_at IS NULL",
    [id, getOrganizationId()],
  );
  return rowToBrand(rows[0]);
}

async function findByIds(ids) {
  if (!ids.length) return [];
  const rows = await query(
    `SELECT * FROM brands WHERE id IN (${ids.map(() => "?").join(",")})
       AND organization_id = ? AND deleted_at IS NULL`,
    [...ids, getOrganizationId()],
  );
  return rows.map(rowToBrand);
}

async function findActive() {
  const rows = await query(
    "SELECT * FROM brands WHERE organization_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY name ASC",
    [getOrganizationId()],
  );
  return rows.map(rowToBrand);
}

async function findActiveByIds(ids) {
  if (!ids.length) return [];
  const rows = await query(
    `SELECT * FROM brands WHERE id IN (${ids.map(() => "?").join(",")})
       AND organization_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY name ASC`,
    [...ids, getOrganizationId()],
  );
  return rows.map(rowToBrand);
}

async function create({ name, logo, description, isActive }) {
  const id = generateObjectId();
  const slug = slugify(name, { lower: true, strict: true });
  await query(
    `INSERT INTO brands (id, organization_id, name, slug, logo, description, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, getOrganizationId(), name, slug, logo || "", description || "", isActive === false ? 0 : 1],
  );
  return findById(id);
}

const Brand = { findById, findByIds, findActive, findActiveByIds, create };

export default Brand;
