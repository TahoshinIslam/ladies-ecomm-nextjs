import slugify from "slugify";

import { query } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";

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
  const rows = await query("SELECT * FROM brands WHERE id = ?", [id]);
  return rowToBrand(rows[0]);
}

async function findByIds(ids) {
  if (!ids.length) return [];
  const rows = await query(`SELECT * FROM brands WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  return rows.map(rowToBrand);
}

async function findActive() {
  const rows = await query("SELECT * FROM brands WHERE is_active = 1 ORDER BY name ASC");
  return rows.map(rowToBrand);
}

async function findActiveByIds(ids) {
  if (!ids.length) return [];
  const rows = await query(
    `SELECT * FROM brands WHERE id IN (${ids.map(() => "?").join(",")}) AND is_active = 1 ORDER BY name ASC`,
    ids,
  );
  return rows.map(rowToBrand);
}

async function create({ name, logo, description, isActive }) {
  const id = generateObjectId();
  const slug = slugify(name, { lower: true, strict: true });
  await query(
    "INSERT INTO brands (id, name, slug, logo, description, is_active) VALUES (?, ?, ?, ?, ?, ?)",
    [id, name, slug, logo || "", description || "", isActive === false ? 0 : 1],
  );
  return findById(id);
}

const Brand = { findById, findByIds, findActive, findActiveByIds, create };

export default Brand;
