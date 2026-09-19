// Repairs the attribute system so the admin product form shows Color / Size
// (and the rest of a department's fields) again — and gives Shoes a real
// size scale.
//
// WHY the fields vanished: attribute_definition_categories (and the
// label-overrides table) reference categories by id with NO foreign key
// (sql/schema.sql — same reasoning as products.category_id). When the
// category tree was re-created (delete + re-seed / the Men/Women
// restructure) the assignments kept pointing at the OLD ids. Every
// Color/Size/Fabric assignment then matched no live category, so
// AttributeDefinition.findByCategoryOrGlobal() returned neither — the form
// code was never changed, it simply had nothing to render.
//
// What this does (all idempotent, one transaction):
//   1. Deletes assignment / label-override rows whose category no longer
//      exists.
//   2. For every definition that lost assignments in step 1, re-applies its
//      intended scope from scripts/seedCatalog.mjs by department SLUG (a
//      definition with NO assignment rows means "applies to every
//      department", so simply deleting the dead rows would have made e.g.
//      Coverage Level appear on shoes).
//   3. Creates the `shoeSize` definition (label "Size", EU 36–46) if
//      missing and assigns it, plus Color, to every live Shoe department —
//      the same pattern cosmetics use for their own size-like field
//      (shade / volumeMl) rather than overloading clothing's `size`.
//
// Never touches products, variants, orders or carts.
import { generateObjectId } from "../../lib/objectId.js";

const CLOTHING = ["burqa", "abaya", "hijab", "niqab", "khimar", "modest-sets", "t-shirt", "shirts", "jeans"];

// key -> department slugs (mirrors buildAttributeDefs() in seedCatalog.mjs).
export const INTENDED_SCOPE = {
  color: CLOTHING,
  size: CLOTHING,
  fabric: CLOTHING,
  coverageLevel: ["burqa", "abaya", "khimar"],
  closure: ["burqa", "abaya"],
  opacity: ["hijab", "niqab"],
  lining: ["burqa", "abaya", "hijab"],
};

const INTENDED_LABEL_OVERRIDES = { size: [["burqa", "Length"], ["khimar", "Length"]] };

export const SHOE_SIZES = ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"];

const isShoeDepartment = (c) => /^shoes?(-[0-9a-f]{6})?$/i.test(c.slug) || /^shoes?$/i.test(c.name.trim());

const migration = {
  id: "0007_repair_variant_attribute_assignments",
  description: "Remove dangling attribute→category assignments, restore Color/Size scope by slug, add shoe sizes",
  async up(conn) {
    await conn.beginTransaction();
    try {
      const [categories] = await conn.query("SELECT id, slug, name, parent_id FROM categories");
      const liveIds = new Set(categories.map((c) => c.id));
      const idBySlug = new Map(categories.map((c) => [c.slug, c.id]));
      const [defs] = await conn.query("SELECT id, attr_key, sort_order FROM attribute_definitions");
      const defByKey = new Map(defs.map((d) => [d.attr_key, d]));

      // 1. dangling rows
      const [assignments] = await conn.query("SELECT attribute_definition_id AS defId, category_id AS catId FROM attribute_definition_categories");
      const affected = new Set();
      for (const a of assignments) {
        if (liveIds.has(a.catId)) continue;
        affected.add(a.defId);
        await conn.query("DELETE FROM attribute_definition_categories WHERE attribute_definition_id = ? AND category_id = ?", [a.defId, a.catId]);
      }
      const [overrides] = await conn.query("SELECT id, category_id AS catId FROM attribute_definition_label_overrides");
      for (const o of overrides) {
        if (!liveIds.has(o.catId)) await conn.query("DELETE FROM attribute_definition_label_overrides WHERE id = ?", [o.id]);
      }

      // 2. re-apply the intended scope for definitions that lost rows
      for (const [key, slugs] of Object.entries(INTENDED_SCOPE)) {
        const def = defByKey.get(key);
        if (!def || !affected.has(def.id)) continue;
        for (const slug of slugs) {
          const catId = idBySlug.get(slug);
          if (catId) await conn.query("INSERT IGNORE INTO attribute_definition_categories (attribute_definition_id, category_id) VALUES (?, ?)", [def.id, catId]);
        }
        for (const [slug, label] of INTENDED_LABEL_OVERRIDES[key] || []) {
          const catId = idBySlug.get(slug);
          if (!catId) continue;
          const [have] = await conn.query("SELECT 1 FROM attribute_definition_label_overrides WHERE attribute_definition_id = ? AND category_id = ?", [def.id, catId]);
          if (!have.length) {
            await conn.query("INSERT INTO attribute_definition_label_overrides (attribute_definition_id, category_id, label, label_bn) VALUES (?, ?, ?, '')", [def.id, catId, label]);
          }
        }
      }

      // 3. shoes
      const shoeDepts = categories.filter((c) => !c.parent_id && isShoeDepartment(c));
      if (shoeDepts.length) {
        let shoeSize = defByKey.get("shoeSize");
        if (!shoeSize) {
          const id = generateObjectId();
          const sortOrder = defByKey.get("size")?.sort_order ?? 0;
          await conn.query(
            `INSERT INTO attribute_definitions (id, attr_key, label, label_bn, type, derived_from_variant, filterable, required, sort_order)
             VALUES (?, 'shoeSize', 'Size', 'সাইজ', 'select', 1, 1, 0, ?)`,
            [id, sortOrder],
          );
          for (let i = 0; i < SHOE_SIZES.length; i++) {
            await conn.query(
              "INSERT INTO attribute_definition_options (attribute_definition_id, value, label, label_bn, swatch_hex, position) VALUES (?, ?, ?, '', '', ?)",
              [id, SHOE_SIZES[i], SHOE_SIZES[i], i],
            );
          }
          shoeSize = { id };
        }
        // Only extend Color's scope if it IS scoped — a definition with no
        // rows applies everywhere, and adding one row would narrow it.
        const color = defByKey.get("color");
        const [colorRows] = color
          ? await conn.query("SELECT COUNT(*) AS n FROM attribute_definition_categories WHERE attribute_definition_id = ?", [color.id])
          : [[{ n: 0 }]];
        const colorScoped = Number(colorRows[0].n) > 0;
        for (const dept of shoeDepts) {
          await conn.query("INSERT IGNORE INTO attribute_definition_categories (attribute_definition_id, category_id) VALUES (?, ?)", [shoeSize.id, dept.id]);
          if (color && colorScoped) await conn.query("INSERT IGNORE INTO attribute_definition_categories (attribute_definition_id, category_id) VALUES (?, ?)", [color.id, dept.id]);
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  },
};

export default migration;
