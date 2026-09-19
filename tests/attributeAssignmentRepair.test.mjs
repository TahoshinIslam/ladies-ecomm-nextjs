// Migration 0007 against a reproduction of the real defect: attribute
// definitions whose category assignments point at category ids that no longer
// exist (the category tree was re-created; assignments have no FK). Before the
// repair Color/Size applied to NO live department, so the admin product form
// had nothing to render — for Shoes and for every clothing department alike.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, truncateAll, rawQuery } from "./helpers/testDb.mjs";

const OLD_IDS = ["6a98b4a2cc94a6d364aa79c0", "6a98b4a2cc94a6d364aa79c8", "6a98b4a3cc94a6d364aa79d7"]; // deleted categories

describe("migration 0007 — repair dangling attribute assignments, add shoe sizes", { skip: !dbReady && skipReason }, () => {
  let Category, AttributeDefinition, resolveAttributesForCategory, migration, withConnection;
  let burqa, jeans, shoe, women;

  before(async () => {
    await connectTestDb();
    await truncateAll(); // the migration works on whole tables; start from a known state
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ default: AttributeDefinition } = await import("../models/attributeDefinitionModel.js"));
    ({ resolveAttributesForCategory } = await import("../services/attributeService.js"));
    ({ withConnection } = await import("../config/db.js"));
    ({ default: migration } = await import("../scripts/migrations/0007_repair_variant_attribute_assignments.mjs"));

    women = await Category.create({ name: "Women", slug: "women" });
    burqa = await Category.create({ name: "Burqa", slug: "burqa", parent: women._id });
    await Category.create({ name: "Closed Burqa", slug: "burqa-closed", parent: burqa._id });
    jeans = await Category.create({ name: "Jeans", slug: "jeans", parent: women._id });
    await Category.create({ name: "Skinny", slug: "jeans-skinny", parent: jeans._id });
    // Admin-created department: NOT one of the seeded slugs (real dev DB: "shoe-0a369b").
    shoe = await Category.create({ name: "Shoe", slug: "shoe-0a369b" });
    await Category.create({ name: "Nike", slug: "nike-0a369c", parent: shoe._id });

    const color = await AttributeDefinition.create({
      key: "color", label: "Color", type: "swatch", derivedFromVariant: true, appliesToCategories: OLD_IDS,
      options: [{ value: "black", label: "Black", swatchHex: "#111" }],
    });
    await AttributeDefinition.create({
      key: "size", label: "Size", type: "select", derivedFromVariant: true, appliesToCategories: OLD_IDS,
      labelOverrides: [{ category: OLD_IDS[0], label: "Length" }],
      options: [{ value: "s", label: "S" }],
    });
    await AttributeDefinition.create({ key: "coverageLevel", label: "Coverage Level", type: "select", appliesToCategories: [OLD_IDS[1]] });
    await AttributeDefinition.create({ key: "occasion", label: "Occasion", type: "select", appliesToCategories: [] }); // legitimately global
    assert.ok(color);
  });

  after(async () => {
    try {
      await truncateAll();
    } finally {
      await disconnectTestDb();
    }
  });

  const keysFor = async (dept) => (await resolveAttributesForCategory(String(dept._id))).map((d) => d.key).sort();
  const run = () => withConnection((conn) => migration.up(conn));

  test("reproduces the bug: before the repair, Color/Size apply to no live department", async () => {
    assert.ok(!(await keysFor(burqa)).includes("color"));
    assert.ok(!(await keysFor(jeans)).includes("size"));
    assert.ok(!(await keysFor(shoe)).includes("color"));
  });

  test("after: clothing departments regain their scoped fields; dangling rows are gone", async () => {
    await run();
    const burqaKeys = await keysFor(burqa);
    assert.deepEqual(burqaKeys.filter((k) => ["color", "size", "coverageLevel"].includes(k)), ["color", "coverageLevel", "size"]);
    assert.deepEqual((await keysFor(jeans)).filter((k) => ["color", "size", "coverageLevel"].includes(k)), ["color", "size"], "coverageLevel is scoped to burqa, not jeans");

    const dangling = await rawQuery(
      `SELECT COUNT(*) AS n FROM attribute_definition_categories a LEFT JOIN categories c ON c.id = a.category_id WHERE c.id IS NULL`,
    );
    assert.equal(dangling[0].n, 0);
    const danglingOverrides = await rawQuery(
      `SELECT COUNT(*) AS n FROM attribute_definition_label_overrides o LEFT JOIN categories c ON c.id = o.category_id WHERE c.id IS NULL`,
    );
    assert.equal(danglingOverrides[0].n, 0);

    const burqaDefs = await resolveAttributesForCategory(String(burqa._id));
    assert.equal(burqaDefs.find((d) => d.key === "size").label, "Length", "the per-department label override is restored");
    assert.equal((await resolveAttributesForCategory(String(jeans._id))).find((d) => d.key === "size").label, "Size");
  });

  test("Shoes get Color plus a real shoe-size scale (EU 36–46); nothing else leaks in", async () => {
    const defs = await resolveAttributesForCategory(String(shoe._id));
    const byKey = new Map(defs.map((d) => [d.key, d]));
    assert.ok(byKey.has("color") && byKey.get("color").derivedFromVariant);
    const shoeSize = byKey.get("shoeSize");
    assert.ok(shoeSize?.derivedFromVariant);
    assert.equal(shoeSize.label, "Size");
    assert.deepEqual(shoeSize.options.map((o) => o.value), ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"]);
    assert.ok(!byKey.has("size"), "clothing's S/M/L size scale is not offered for shoes");
    assert.ok(!byKey.has("coverageLevel"));
    assert.ok(byKey.has("occasion"), "a definition with no assignments still applies to every department, as designed");
    // ...and shoe sizes are not offered on clothing.
    assert.ok(!(await keysFor(burqa)).includes("shoeSize"));
  });

  test("idempotent: running it again changes nothing", async () => {
    const snapshot = async () => ({
      assignments: await rawQuery("SELECT attribute_definition_id, category_id FROM attribute_definition_categories ORDER BY 1, 2"),
      defs: await rawQuery("SELECT attr_key FROM attribute_definitions ORDER BY 1"),
      options: (await rawQuery("SELECT COUNT(*) AS n FROM attribute_definition_options"))[0].n,
    });
    const before = await snapshot();
    await run();
    assert.deepEqual(await snapshot(), before);
  });

  test("it never touches products or variants", async () => {
    assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM products"))[0].n, 0);
    assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM product_variants"))[0].n, 0);
  });
});
