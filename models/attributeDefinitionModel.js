import { query, withConnection } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";

async function loadChildren(defIds) {
  if (!defIds.length) return { options: new Map(), overrides: new Map(), categories: new Map() };
  const ph = defIds.map(() => "?").join(",");
  const [optionRows, overrideRows, categoryRows] = await Promise.all([
    query(
      `SELECT * FROM attribute_definition_options WHERE attribute_definition_id IN (${ph}) ORDER BY position ASC`,
      defIds,
    ),
    query(
      `SELECT * FROM attribute_definition_label_overrides WHERE attribute_definition_id IN (${ph})`,
      defIds,
    ),
    query(
      `SELECT * FROM attribute_definition_categories WHERE attribute_definition_id IN (${ph})`,
      defIds,
    ),
  ]);
  const options = new Map();
  for (const r of optionRows) {
    const list = options.get(r.attribute_definition_id) || [];
    list.push({ value: r.value, label: r.label, labelBn: r.label_bn, swatchHex: r.swatch_hex });
    options.set(r.attribute_definition_id, list);
  }
  const overrides = new Map();
  for (const r of overrideRows) {
    const list = overrides.get(r.attribute_definition_id) || [];
    list.push({ category: r.category_id, label: r.label, labelBn: r.label_bn });
    overrides.set(r.attribute_definition_id, list);
  }
  const categories = new Map();
  for (const r of categoryRows) {
    const list = categories.get(r.attribute_definition_id) || [];
    list.push(r.category_id);
    categories.set(r.attribute_definition_id, list);
  }
  return { options, overrides, categories };
}

function rowToDefinition(row, children) {
  if (!row) return null;
  const def = {
    _id: row.id,
    key: row.attr_key,
    label: row.label,
    labelBn: row.label_bn,
    labelOverrides: children?.overrides.get(row.id) || [],
    type: row.type,
    options: children?.options.get(row.id) || [],
    appliesToCategories: children?.categories.get(row.id) || [],
    derivedFromVariant: !!row.derived_from_variant,
    filterable: !!row.filterable,
    required: !!row.required,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  def.save = async function save() {
    return saveDefinition(this);
  };
  def.deleteOne = async function deleteOne() {
    await query("DELETE FROM attribute_definitions WHERE id = ?", [this._id]);
  };
  return def;
}

async function findById(id) {
  if (!id) return null;
  const rows = await query("SELECT * FROM attribute_definitions WHERE id = ?", [id]);
  if (!rows.length) return null;
  const children = await loadChildren([id]);
  return rowToDefinition(rows[0], children);
}

async function findByKeys(keys) {
  if (!keys.length) return [];
  const rows = await query(
    `SELECT * FROM attribute_definitions WHERE attr_key IN (${keys.map(() => "?").join(",")})`,
    keys,
  );
  const children = await loadChildren(rows.map((r) => r.id));
  return rows.map((r) => rowToDefinition(r, children));
}

/** Every definition, sorted sort_order then key. */
async function findAll() {
  const rows = await query("SELECT * FROM attribute_definitions ORDER BY sort_order ASC, attr_key ASC");
  const children = await loadChildren(rows.map((r) => r.id));
  return rows.map((r) => rowToDefinition(r, children));
}

/** Definitions applying to `topCategoryId`: universal (no categories set) OR explicitly scoped to it. */
async function findByCategoryOrGlobal(topCategoryId) {
  const rows = await query(
    `SELECT ad.* FROM attribute_definitions ad
     WHERE NOT EXISTS (SELECT 1 FROM attribute_definition_categories c WHERE c.attribute_definition_id = ad.id)
        OR EXISTS (
             SELECT 1 FROM attribute_definition_categories c
             WHERE c.attribute_definition_id = ad.id AND c.category_id = ?
           )
     ORDER BY ad.sort_order ASC, ad.attr_key ASC`,
    [topCategoryId],
  );
  const children = await loadChildren(rows.map((r) => r.id));
  return rows.map((r) => rowToDefinition(r, children));
}

/** Definitions flagged derivedFromVariant, optionally narrowed to ones applying to a given top category (or universal). */
async function findDerivedFromVariant() {
  const rows = await query("SELECT * FROM attribute_definitions WHERE derived_from_variant = 1");
  const children = await loadChildren(rows.map((r) => r.id));
  return rows.map((r) => rowToDefinition(r, children));
}

async function writeChildren(conn, defId, def) {
  await conn.query("DELETE FROM attribute_definition_options WHERE attribute_definition_id = ?", [defId]);
  await conn.query("DELETE FROM attribute_definition_label_overrides WHERE attribute_definition_id = ?", [defId]);
  await conn.query("DELETE FROM attribute_definition_categories WHERE attribute_definition_id = ?", [defId]);

  const options = def.options || [];
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    await conn.query(
      "INSERT INTO attribute_definition_options (attribute_definition_id, value, label, label_bn, swatch_hex, position) VALUES (?, ?, ?, ?, ?, ?)",
      [defId, o.value, o.label, o.labelBn || "", o.swatchHex || "", i],
    );
  }
  for (const o of def.labelOverrides || []) {
    await conn.query(
      "INSERT INTO attribute_definition_label_overrides (attribute_definition_id, category_id, label, label_bn) VALUES (?, ?, ?, ?)",
      [defId, o.category, o.label, o.labelBn || ""],
    );
  }
  for (const categoryId of def.appliesToCategories || []) {
    await conn.query(
      "INSERT INTO attribute_definition_categories (attribute_definition_id, category_id) VALUES (?, ?)",
      [defId, categoryId],
    );
  }
}

async function saveDefinition(def) {
  await withConnection(async (conn) => {
    await conn.query(
      `UPDATE attribute_definitions SET label=?, label_bn=?, type=?, derived_from_variant=?,
         filterable=?, required=?, sort_order=? WHERE id=?`,
      [
        def.label,
        def.labelBn || "",
        def.type,
        def.derivedFromVariant ? 1 : 0,
        def.filterable === false ? 0 : 1,
        def.required ? 1 : 0,
        def.sortOrder || 0,
        def._id,
      ],
    );
    await writeChildren(conn, def._id, def);
  });
  return def;
}

async function create(data) {
  const id = generateObjectId();
  await withConnection(async (conn) => {
    await conn.query(
      `INSERT INTO attribute_definitions (id, attr_key, label, label_bn, type, derived_from_variant, filterable, required, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.key,
        data.label,
        data.labelBn || "",
        data.type,
        data.derivedFromVariant ? 1 : 0,
        data.filterable === false ? 0 : 1,
        data.required ? 1 : 0,
        data.sortOrder || 0,
      ],
    );
    await writeChildren(conn, id, data);
  });
  return findById(id);
}

/**
 * Removes every reference to a category from attribute assignments and
 * per-category label overrides. These tables deliberately have no foreign
 * key to `categories` (see sql/schema.sql), so deleting a category would
 * otherwise leave rows pointing at nothing — and a definition whose every
 * assignment points at nothing applies to NO category, which is exactly how
 * Color/Size vanished from the product form.
 */
async function removeCategoryReferences(categoryId) {
  await query("DELETE FROM attribute_definition_categories WHERE category_id = ?", [categoryId]);
  await query("DELETE FROM attribute_definition_label_overrides WHERE category_id = ?", [categoryId]);
}

const AttributeDefinition = { findById, findByKeys, findAll, findByCategoryOrGlobal, findDerivedFromVariant, create, removeCategoryReferences };

export default AttributeDefinition;
