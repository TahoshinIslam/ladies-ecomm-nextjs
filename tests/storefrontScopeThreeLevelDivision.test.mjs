// Regression coverage for a real bug found while adding the marketplace-
// expansion taxonomy (scripts/seedMarketplaceExpansion.mjs): a genuine
// 3-level division (division -> department -> style, e.g. Food -> Meat &
// Fish -> Fish) denormalizes a leaf product's `topCategory` to the MID-TIER
// department id (productModel.js's pre-validate hook walks exactly one
// level up), never the division's own id. services/productService.js's
// getStorefrontDepartmentIds() previously scoped the storefront by division
// ids ONLY — correct for the original 2-level-only clothing catalog, where
// a product's topCategory always IS its division's id, but silently
// excluding every product filed under a real 3-level division (its
// products' topCategory never equals the division's own id at all).
// resolveScopeIdsForSlugs() now includes each division's direct children
// too, closing this gap.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { dbReady, skipReason, connectTestDb, disconnectTestDb } from "./helpers/testDb.mjs";

const canRun = dbReady;
const unique = () => crypto.randomBytes(6).toString("hex");

describe("services/productService.js — resolveScopeIdsForSlugs() covers 3-level divisions", { skip: !canRun && (skipReason || "MONGO_URI_TEST not reachable") }, () => {
  let Category, Product, resolveScopeIdsForSlugs, buildFilter;
  const createdCategoryIds = [];
  const createdProductIds = [];

  before(async () => {
    await connectTestDb();
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ resolveScopeIdsForSlugs, buildFilter } = await import("../services/productService.js"));
  });

  after(async () => {
    if (createdProductIds.length) await Product.deleteMany({ _id: { $in: createdProductIds } });
    if (createdCategoryIds.length) await Category.deleteMany({ _id: { $in: createdCategoryIds } });
    await disconnectTestDb();
  });

  async function makeCategory(fields = {}) {
    const suffix = unique();
    const cat = await Category.create({
      name: `Test Scope Category ${suffix}`,
      slug: `test-scope-${suffix}`,
      ...fields,
    });
    createdCategoryIds.push(cat._id);
    return cat;
  }

  async function makeProduct(category) {
    const suffix = unique();
    const product = await Product.create({
      name: `Test Scope Product ${suffix}`,
      description: "Created by storefrontScopeThreeLevelDivision.test.mjs — safe to delete.",
      category: category._id,
      basePrice: 500,
      isActive: true,
      images: ["https://placehold.co/400x400.png?text=test"],
      variants: [{ variantName: "Default", sku: `TSP-${suffix}`, stock: 5 }],
    });
    createdProductIds.push(product._id);
    return product;
  }

  test("a division's real 3-level leaf product's topCategory (the mid-tier department) is included in the scope, not just the division's own id", async () => {
    const division = await makeCategory({ parent: null });
    const department = await makeCategory({ parent: division._id });
    const style = await makeCategory({ parent: department._id });
    const product = await makeProduct(style);

    // Pin the real, deliberate one-level-up behavior this whole fix
    // depends on: the leaf product's topCategory is the mid-tier
    // department, never the division.
    const saved = await Product.findById(product._id).lean();
    assert.equal(String(saved.topCategory), String(department._id));
    assert.notEqual(String(saved.topCategory), String(division._id));

    const scopeIds = await resolveScopeIdsForSlugs([division.slug]);
    assert.ok(scopeIds.includes(String(division._id)), "the division's own id must be in scope");
    assert.ok(scopeIds.includes(String(department._id)), "the division's direct child (the product's real topCategory) must also be in scope");
  });

  test("end-to-end: buildFilter(), given the department id a browse-the-division request expands to (expandCategoryScope()'s own output shape) and this scope, still finds the 3-level leaf product", async () => {
    const division = await makeCategory({ parent: null });
    const department = await makeCategory({ parent: division._id });
    const style = await makeCategory({ parent: department._id });
    await makeProduct(style);

    const scopeIds = await resolveScopeIdsForSlugs([division.slug]);
    // Simulates what listProducts()'s expandCategoryQueryParam() does to a
    // `?category=<division id>` request server-side before buildFilter()
    // ever runs: a genuine division (a child with its own children) is
    // expanded to that division's direct children ids.
    const filter = buildFilter({ category: String(department._id) }, { isActive: true }, scopeIds);
    const count = await Product.countDocuments(filter);
    assert.equal(count, 1, "the product filed 3 levels under the division must be found when browsing the division");
  });
});
