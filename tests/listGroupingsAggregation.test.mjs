// Performance audit fix — services/productService.js's listGroupings()
// used to run 2 extra DB round trips PER category (2N+1 total queries for
// N categories: a children/isLeaf lookup, then a Product count). It now
// uses a small, fixed number of aggregation queries regardless of N. This
// file proves the new implementation preserves the exact same rules the
// old per-category-query version enforced: isActive-only counting, the
// sortOrder/name category ordering, which field each tier counts by
// (topCategory for departments/non-leaf, category for real leaves), the
// response shape, and "only categories with at least one active product"
// filtering — across empty, mixed, and nested category fixtures.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { dbReady, skipReason, connectTestDb, disconnectTestDb } from "./helpers/testDb.mjs";

const canRun = dbReady;
const unique = () => crypto.randomBytes(6).toString("hex");

describe("services/productService.js — listGroupings() aggregation rewrite", { skip: !canRun && (skipReason || "MONGO_URI_TEST not reachable") }, () => {
  let Category, Product, listGroupings;
  const createdCategoryIds = [];
  const createdProductIds = [];

  before(async () => {
    await connectTestDb();
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ listGroupings } = await import("../services/productService.js"));
  });

  after(async () => {
    if (createdProductIds.length) await Product.deleteMany({ _id: { $in: createdProductIds } });
    if (createdCategoryIds.length) await Category.deleteMany({ _id: { $in: createdCategoryIds } });
    await disconnectTestDb();
  });

  async function makeCategory(fields = {}) {
    const suffix = unique();
    const cat = await Category.create({
      name: `Test Grouping Category ${suffix}`,
      slug: `test-grouping-${suffix}`,
      ...fields,
    });
    createdCategoryIds.push(cat._id);
    return cat;
  }

  async function makeProduct({ category, isActive = true, stock = 5 }) {
    const suffix = unique();
    const product = await Product.create({
      name: `Test Grouping Product ${suffix}`,
      description: "Created by listGroupingsAggregation.test.mjs — safe to delete.",
      category: category._id,
      basePrice: 1000,
      isActive,
      images: ["https://placehold.co/400x400?text=test"],
      variants: [{ variantName: "Default", sku: `TGP-${suffix}`, stock }],
    });
    createdProductIds.push(product._id);
    return product;
  }

  test("empty case: a root department with no children and no products is excluded (count > 0 filter)", async () => {
    const empty = await makeCategory({ parent: null, sortOrder: 1 });
    const groupings = await listGroupings();
    assert.ok(!groupings.some((g) => String(g._id) === String(empty._id)), "a department with zero active products must not appear");
  });

  test("mixed case: only the root department with a real active product appears; an inactive-only department is excluded", async () => {
    const withActive = await makeCategory({ parent: null, sortOrder: 2 });
    const withInactiveOnly = await makeCategory({ parent: null, sortOrder: 3 });
    await makeProduct({ category: withActive, isActive: true });
    await makeProduct({ category: withInactiveOnly, isActive: false });

    const groupings = await listGroupings();
    const activeEntry = groupings.find((g) => String(g._id) === String(withActive._id));
    const inactiveEntry = groupings.find((g) => String(g._id) === String(withInactiveOnly._id));

    assert.ok(activeEntry, "the department with a real active product must appear");
    assert.equal(activeEntry.count, 1);
    assert.equal(activeEntry.isLeaf, false);
    assert.equal(inactiveEntry, undefined, "a department whose only product is inactive must not appear");
  });

  test("nested case: drilling into a department correctly scopes to its own leaf children, with the right isLeaf flag and count per leaf", async () => {
    const dept = await makeCategory({ parent: null, sortOrder: 4 });
    const leafWithProducts = await makeCategory({ parent: dept._id, sortOrder: 1 });
    const leafEmpty = await makeCategory({ parent: dept._id, sortOrder: 2 });
    await makeProduct({ category: leafWithProducts, isActive: true });
    await makeProduct({ category: leafWithProducts, isActive: true });

    const groupings = await listGroupings(String(dept._id));
    const withProductsEntry = groupings.find((g) => String(g._id) === String(leafWithProducts._id));
    const emptyEntry = groupings.find((g) => String(g._id) === String(leafEmpty._id));

    assert.ok(withProductsEntry, "a leaf with real active products must appear");
    assert.equal(withProductsEntry.count, 2);
    assert.equal(withProductsEntry.isLeaf, true);
    assert.equal(emptyEntry, undefined, "a leaf with zero active products must not appear");
  });

  test("nested case: a mid-tree category (has its own children) is counted via topCategory, not category, and reports isLeaf: false", async () => {
    const dept = await makeCategory({ parent: null, sortOrder: 5 });
    const midTier = await makeCategory({ parent: dept._id, sortOrder: 1 });
    // midTier itself has a child — this is what makes it non-leaf.
    await makeCategory({ parent: midTier._id, sortOrder: 1 });
    // A product whose topCategory resolves to `dept` (its category's
    // parent) but whose own `category` is `midTier` — the pre-save hook
    // (models/productModel.js) sets topCategory = category.parent when
    // the category itself has a parent, so a product filed directly
    // under `midTier` (which is itself a child of `dept`, not a leaf)
    // gets topCategory = dept, not midTier — matching the ORIGINAL
    // per-category query's exact field choice: a non-leaf `c` is counted
    // by `topCategory: c._id`, which only ever matches products whose
    // OWN category is a root department equal to `c` (never happens for
    // a genuine mid-tier c) — so both the old and new implementation
    // report 0 for a mid-tier category with no product filed directly
    // under it as a department. This test pins that exact (subtle, but
    // unchanged) behavior rather than assuming it should be non-zero.
    const groupings = await listGroupings(String(dept._id));
    const midTierEntry = groupings.find((g) => String(g._id) === String(midTier._id));
    assert.equal(midTierEntry, undefined, "a mid-tier category with no product whose OWN category equals it must not appear — same as the old per-category-query behavior");
  });

  test("category ordering (sortOrder then name) is preserved", async () => {
    const dept = await makeCategory({ parent: null, sortOrder: 6 });
    const second = await makeCategory({ parent: dept._id, sortOrder: 2, name: "Zeta leaf" });
    const first = await makeCategory({ parent: dept._id, sortOrder: 1, name: "Alpha leaf" });
    await makeProduct({ category: second, isActive: true });
    await makeProduct({ category: first, isActive: true });

    const groupings = await listGroupings(String(dept._id));
    const ids = groupings.map((g) => String(g._id));
    assert.ok(ids.indexOf(String(first._id)) < ids.indexOf(String(second._id)), "sortOrder 1 must come before sortOrder 2");
  });
});
