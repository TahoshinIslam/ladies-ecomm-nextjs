import slugify from "slugify";

import { query } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import { getOrganizationId } from "../lib/tenant.js";

function rowToCategory(row) {
  if (!row) return null;
  const category = {
    _id: row.id,
    name: row.name,
    nameBn: row.name_bn,
    slug: row.slug,
    parent: row.parent_id,
    image: row.image,
    icon: row.icon,
    description: row.description,
    descriptionBn: row.description_bn,
    sortOrder: row.sort_order,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  // Tracks the name this category had when loaded, so save() can tell
  // whether `name` actually changed (Mongoose's `isModified("name")`) —
  // needed because, unlike products, a category's slug is sometimes a
  // human-curated stable key (see scripts/seedCatalog.mjs's upsert-by-slug
  // seeding, e.g. "burqa-closed-style") that must NOT be silently
  // overwritten by a name-derived one on every unrelated save (a plain
  // "recompute unconditionally" approach — which is safe for products,
  // which never have a custom slug — would corrupt these on the very next
  // re-seed or admin edit).
  category.__originalName = category.name;
  category.save = async function save() {
    if (this.name !== this.__originalName || !this.slug) {
      this.slug = buildSlug(this.name, this._id);
      this.__originalName = this.name;
    }
    await query(
      `UPDATE categories SET name=?, name_bn=?, slug=?, parent_id=?, image=?, icon=?,
         description=?, description_bn=?, sort_order=?, is_active=? WHERE organization_id=? AND id=?`,
      [
        this.name,
        this.nameBn || "",
        this.slug,
        this.parent,
        this.image || "",
        this.icon || "",
        this.description || "",
        this.descriptionBn || "",
        this.sortOrder || 0,
        this.isActive ? 1 : 0,
        getOrganizationId(),
        this._id,
      ],
    );
    return this;
  };
  category.deleteOne = async function deleteOne() {
    // Soft delete, as the dashboard's catalog does — products reference
    // categories, and a hard delete would orphan them.
    await query(
      "UPDATE categories SET deleted_at = NOW(3) WHERE organization_id = ? AND id = ? AND deleted_at IS NULL",
      [getOrganizationId(), this._id],
    );
  };
  return category;
}

async function findById(id) {
  if (!id) return null;
  const rows = await query(
    "SELECT * FROM categories WHERE organization_id = ? AND id = ? AND deleted_at IS NULL",
    [getOrganizationId(), id],
  );
  return rowToCategory(rows[0]);
}

async function findBySlug(slug) {
  const rows = await query(
    "SELECT * FROM categories WHERE organization_id = ? AND slug = ? AND deleted_at IS NULL",
    [getOrganizationId(), slug],
  );
  return rowToCategory(rows[0]);
}

/** Every category, sorted sort_order then name — the one shape listCategories() needs. */
async function findAll() {
  const rows = await query(
    `SELECT * FROM categories WHERE organization_id = ? AND deleted_at IS NULL
      ORDER BY sort_order ASC, name ASC`,
    [getOrganizationId()],
  );
  return rows.map(rowToCategory);
}

/**
 * A cheap fingerprint of the whole category table (row count, newest change,
 * how many are active). Any insert, delete, (de)activation or move changes it
 * (updated_at is ON UPDATE CURRENT_TIMESTAMP), so a cache built from the
 * table can be validated against it in one tiny aggregate instead of trusting
 * a timer or an in-process reset call.
 */
async function stamp() {
  const rows = await query(
    `SELECT COUNT(*) AS n, MAX(updated_at) AS newest, COALESCE(SUM(is_active), 0) AS active
       FROM categories WHERE organization_id = ? AND deleted_at IS NULL`,
    [getOrganizationId()],
  );
  const { n, newest, active } = rows[0];
  return `${n}|${newest ? new Date(newest).getTime() : 0}|${active}`;
}

async function findByIds(ids) {
  if (!ids.length) return [];
  const rows = await query(
    `SELECT * FROM categories
      WHERE organization_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
    [getOrganizationId(), ...ids],
  );
  return rows.map(rowToCategory);
}

async function findByParent(parentId) {
  const rows = parentId === null
    ? await query(
        `SELECT * FROM categories
          WHERE organization_id = ? AND deleted_at IS NULL AND parent_id IS NULL
          ORDER BY sort_order ASC, name ASC`,
        [getOrganizationId()],
      )
    : await query(
        `SELECT * FROM categories
          WHERE organization_id = ? AND deleted_at IS NULL AND parent_id = ?
          ORDER BY sort_order ASC, name ASC`,
        [getOrganizationId(), parentId],
      );
  return rows.map(rowToCategory);
}

async function findChildIdsByParents(parentIds) {
  if (!parentIds.length) return [];
  const rows = await query(
    `SELECT id, parent_id FROM categories
      WHERE organization_id = ? AND deleted_at IS NULL
        AND parent_id IN (${parentIds.map(() => "?").join(",")})`,
    [getOrganizationId(), ...parentIds],
  );
  return rows;
}

function buildSlug(name, id) {
  const base = slugify(name, { lower: true, strict: true });
  return `${base}-${id.slice(-6)}`;
}

async function create(data) {
  const id = generateObjectId();
  // Explicit `slug` (used only by scripts/seedCatalog.mjs, which treats
  // slug as a stable, human-curated natural key, e.g. "burqa-closed-style"
  // rather than a name-derived one) wins over the usual auto-generated
  // form — every other caller (the admin API) never passes one.
  const slug = data.slug || buildSlug(data.name, id);
  await query(
    `INSERT INTO categories (id, organization_id, name, name_bn, slug, parent_id, image, icon, description, description_bn, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      getOrganizationId(),
      data.name,
      data.nameBn || "",
      slug,
      data.parent || null,
      data.image || "",
      data.icon || "",
      data.description || "",
      data.descriptionBn || "",
      data.sortOrder || 0,
      data.isActive === false ? 0 : 1,
    ],
  );
  return findById(id);
}

async function countByParent(parentId) {
  const rows = await query(
    "SELECT COUNT(*) AS n FROM categories WHERE organization_id = ? AND parent_id = ? AND deleted_at IS NULL",
    [getOrganizationId(), parentId],
  );
  return rows[0].n;
}

async function existsWithParent(parentId) {
  const rows = await query(
    "SELECT 1 FROM categories WHERE organization_id = ? AND parent_id = ? AND deleted_at IS NULL LIMIT 1",
    [getOrganizationId(), parentId],
  );
  return rows.length > 0;
}

const Category = {
  findById,
  findBySlug,
  findAll,
  stamp,
  findByIds,
  findByParent,
  findChildIdsByParents,
  create,
  countByParent,
  existsWithParent,
  buildSlug,
};

export default Category;
