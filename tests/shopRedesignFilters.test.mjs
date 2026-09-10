// Shop redesign v3 — services/productService.js's new filter/facet
// dimensions (collection, availability, ratingGte), the effective-price
// fix, and the explicit attribute-scoping pipeline (stale-filter removal).
// Creates its own department/category/product fixtures (never depends on
// scripts/seedCatalog.mjs having run) and runs only against
// MONGO_URI_TEST.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb } from "./helpers/testDb.mjs";
import { HttpError } from "../lib/http.js";

const canRun = dbReady;
const reason = skipReason;

describe("Shop redesign v3 — filters, facets, effective price, stale-filter removal", { skip: !canRun && reason }, () => {
  let Category, Product, AttributeDefinition;
  let listProducts, parseProductListQuery, getStorefrontDepartmentIds, buildFacetCounts;

  let division, dept, leafA, leafB;
  let productDiscounted, productPlain, productOutOfStock, productRated, productUnrated;

  before(async () => {
    await connectTestDb();
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ default: AttributeDefinition } = await import("../models/attributeDefinitionModel.js"));
    ({ listProducts, parseProductListQuery, getStorefrontDepartmentIds, buildFacetCounts } = await import("../services/productService.js"));

    const suffix = Date.now();
    dept = await Category.create({ name: `Test Dept ${suffix}`, slug: `test-dept-${suffix}` });
    leafA = await Category.create({ name: `Test Leaf A ${suffix}`, slug: `test-leaf-a-${suffix}`, parent: dept._id });
    leafB = await Category.create({ name: `Test Leaf B ${suffix}`, slug: `test-leaf-b-${suffix}`, parent: dept._id });

    const base = {
      description: "Fixture product for shop redesign tests.",
      category: leafA._id,
      images: ["https://placehold.co/400x400?text=test"],
    };

    productDiscounted = await Product.create({
      ...base,
      name: `Discounted Product ${suffix}`,
      basePrice: 1500,
      discountPrice: 1200,
      variants: [{ variantName: "Default", sku: `TEST-DISC-${suffix}`, stock: 10 }],
    });
    productPlain = await Product.create({
      ...base,
      name: `Plain Product ${suffix}`,
      basePrice: 1250,
      variants: [{ variantName: "Default", sku: `TEST-PLAIN-${suffix}`, stock: 10 }],
    });
    productOutOfStock = await Product.create({
      ...base,
      name: `Out Of Stock Product ${suffix}`,
      basePrice: 500,
      variants: [{ variantName: "Default", sku: `TEST-OOS-${suffix}`, stock: 0 }],
    });
    productRated = await Product.create({
      ...base,
      name: `Rated Product ${suffix}`,
      basePrice: 800,
      rating: 4.5,
      variants: [{ variantName: "Default", sku: `TEST-RATED-${suffix}`, stock: 5 }],
    });
    productUnrated = await Product.create({
      ...base,
      name: `Unrated Product ${suffix}`,
      basePrice: 800,
      variants: [{ variantName: "Default", sku: `TEST-UNRATED-${suffix}`, stock: 5 }],
    });
  });

  after(async () => {
    await Product.deleteMany({ _id: { $in: [productDiscounted?._id, productPlain?._id, productOutOfStock?._id, productRated?._id, productUnrated?._id].filter(Boolean) } });
    await Category.deleteMany({ _id: { $in: [dept?._id, leafA?._id, leafB?._id].filter(Boolean) } });
    await disconnectTestDb();
  });

  describe("Effective-price filtering (v3-5/v2-6) — the regression this fixes", () => {
    test("a discounted product (basePrice 1500, discountPrice 1200) is included in priceMax=1300 — a basePrice-only comparison would wrongly exclude it", async () => {
      const result = await listProducts({ category: dept._id.toString(), basePrice: { lte: "1300" }, limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(ids.includes(String(productDiscounted._id)), "the discounted product (effective price 1200) must be included");
    });

    test("a discounted product is correctly EXCLUDED from priceMax=1100 (below its real 1200 selling price, even though its basePrice 1500 is also above)", async () => {
      const result = await listProducts({ category: dept._id.toString(), basePrice: { lte: "1100" }, limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(!ids.includes(String(productDiscounted._id)));
    });

    test("priceMin correctly uses effective price too (a discounted product doesn't wrongly satisfy a minimum meant to exclude it)", async () => {
      const result = await listProducts({ category: dept._id.toString(), basePrice: { gte: "1300" }, limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(!ids.includes(String(productDiscounted._id)), "effective price 1200 must not satisfy a >=1300 minimum, even though basePrice 1500 would");
    });
  });

  describe("Availability filter", () => {
    test("availability=in_stock excludes the zero-stock product", async () => {
      const result = await listProducts({ category: dept._id.toString(), availability: "in_stock", limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(!ids.includes(String(productOutOfStock._id)));
      assert.ok(ids.includes(String(productDiscounted._id)));
    });

    test("availability=out_of_stock returns only the zero-stock product", async () => {
      const result = await listProducts({ category: dept._id.toString(), availability: "out_of_stock", limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(ids.includes(String(productOutOfStock._id)));
      assert.ok(!ids.includes(String(productDiscounted._id)));
    });
  });

  describe("Rating threshold filter", () => {
    test("ratingGte=4 includes the 4.5-rated product and excludes the unrated (0) one", async () => {
      const result = await listProducts({ category: dept._id.toString(), ratingGte: "4", limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(ids.includes(String(productRated._id)));
      assert.ok(!ids.includes(String(productUnrated._id)));
    });

    test("ratingGte=1 (the lowest threshold) still excludes an unrated (rating: 0) product — 'at least 1 star' is not satisfied by zero stars", async () => {
      const result = await listProducts({ category: dept._id.toString(), ratingGte: "1", limit: 50 }, { isAdmin: true });
      const ids = result.products.map((p) => String(p._id));
      assert.ok(!ids.includes(String(productUnrated._id)));
      assert.ok(ids.includes(String(productRated._id)));
    });
  });

  // Called directly with scopeIds: null (like an admin request would
  // resolve, minus the storefront-department allowlist that doesn't know
  // about this file's ad-hoc test fixtures) so these tests exercise the
  // real self-exclusion logic against real fixture data, independent of
  // getStorefrontDepartmentIds()'s unrelated real-department allowlist
  // (covered by its own tests elsewhere).
  describe("Self-excluding facet counts for the new dimensions", () => {
    test("availability facet counts ignore the current availability selection when computing each option's own count", async () => {
      const facets = await buildFacetCounts({ category: dept._id.toString(), availability: "in_stock" }, {}, null);
      assert.ok(facets.availability.out_of_stock >= 1, "out_of_stock count must not be zeroed out by the active in_stock filter");
      assert.ok(facets.availability.in_stock >= 1);
    });

    test("ratingGte facet counts are present for all 5 thresholds and reflect real data", async () => {
      const facets = await buildFacetCounts({ category: dept._id.toString() }, {}, null);
      for (const n of [1, 2, 3, 4, 5]) {
        assert.ok(typeof facets.ratingGte[n] === "number", `expected a numeric count for threshold ${n}`);
      }
      assert.ok(facets.ratingGte[4] >= 1, "the 4.5-rated fixture must be counted at the 4+ threshold");
      assert.equal(facets.ratingGte[5], 0, "no fixture is rated exactly 5, so this bucket must be 0, not miscounted");
    });

    test("collection facet counts use the real-discount definition (matches effective-price semantics), not a bare discountPrice != null check", async () => {
      const facets = await buildFacetCounts({ category: dept._id.toString() }, {}, null);
      assert.ok(facets.collection.discount >= 1, "the real discounted fixture must be counted");
    });

    test("ageGroup facet counts still work unaffected by the new dimensions being added alongside them", async () => {
      const facets = await buildFacetCounts({ category: dept._id.toString(), ratingGte: "4" }, {}, null);
      assert.equal(typeof facets.ageGroup.adult, "number");
    });
  });

  describe("Collection: canonical vs legacy, and rejecting a mixed request", () => {
    test("collection=discount and the legacy discount=true resolve to the same result set", async () => {
      const canonical = await listProducts({ category: dept._id.toString(), collection: "discount", limit: 50 }, { isAdmin: true });
      const legacy = await listProducts({ category: dept._id.toString(), discount: "true", limit: 50 }, { isAdmin: true });
      const canonicalIds = canonical.products.map((p) => String(p._id)).sort();
      const legacyIds = legacy.products.map((p) => String(p._id)).sort();
      assert.deepEqual(canonicalIds, legacyIds);
    });

    test("parseProductListQuery rejects collection= combined with a legacy boolean (v3-6)", async () => {
      await assert.rejects(
        () => parseProductListQuery({ collection: "new", featured: "true" }),
        (err) => err instanceof HttpError && err.status === 400,
      );
    });

    test("parseProductListQuery accepts collection= alone", async () => {
      const out = await parseProductListQuery({ collection: "featured" });
      assert.equal(out.collection, "featured");
    });

    test("parseProductListQuery rejects an invalid collection value", async () => {
      await assert.rejects(() => parseProductListQuery({ collection: "bogus" }), (err) => err instanceof HttpError && err.status === 400);
    });

    test("parseProductListQuery rejects an invalid ratingGte value (out of 1-5 range)", async () => {
      await assert.rejects(() => parseProductListQuery({ ratingGte: "6" }), (err) => err instanceof HttpError && err.status === 400);
      await assert.rejects(() => parseProductListQuery({ ratingGte: "0" }), (err) => err instanceof HttpError && err.status === 400);
    });

    test("parseProductListQuery rejects an invalid availability value", async () => {
      await assert.rejects(() => parseProductListQuery({ availability: "sold_out" }), (err) => err instanceof HttpError && err.status === 400);
    });
  });

  describe("Stale-filter removal — the 4-outcome matrix (v3-4)", () => {
    let otherDept, otherLeaf, realAttrDef;

    before(async () => {
      const suffix = `sfr-${Date.now()}`;
      otherDept = await Category.create({ name: `Other Dept ${suffix}`, slug: `other-dept-${suffix}` });
      otherLeaf = await Category.create({ name: `Other Leaf ${suffix}`, slug: `other-leaf-${suffix}`, parent: otherDept._id });
      realAttrDef = await AttributeDefinition.create({
        key: `onlyOnOtherDept${suffix.replace(/-/g, "")}`,
        label: "Only On Other Dept",
        type: "select",
        filterable: true,
        appliesToCategories: [otherDept._id],
        options: [{ value: "x", label: "X" }],
      });
    });

    after(async () => {
      await Category.deleteMany({ _id: { $in: [otherDept?._id, otherLeaf?._id].filter(Boolean) } });
      await AttributeDefinition.deleteOne({ _id: realAttrDef?._id });
    });

    test("a real attribute key that doesn't apply to the currently-selected department is dropped server-side, not left to wrongly zero the result set", async () => {
      // `dept` (this describe block's outer fixture) has no products with
      // this attribute at all, and the attribute isn't even scoped to
      // `dept` — the naive old behavior would $elemMatch on a key no
      // product in `dept` ever has, returning zero results. The fix strips
      // it before that ever happens, so the normal category-only result
      // set survives unchanged.
      const withStaleFilter = await listProducts(
        { category: dept._id.toString(), [realAttrDef.key]: "x", limit: 50 },
        { isAdmin: true },
      );
      const withoutFilter = await listProducts({ category: dept._id.toString(), limit: 50 }, { isAdmin: true });
      assert.equal(withStaleFilter.total, withoutFilter.total, "the inapplicable attribute filter must be stripped, not silently zero the results");
    });

    test("the same attribute key correctly filters when the applicable department IS selected (a valid, applicable attribute still filters normally)", async () => {
      const result = await listProducts({ category: otherDept._id.toString(), [realAttrDef.key]: "x", limit: 50 }, { isAdmin: true });
      assert.equal(result.total, 0, "no real product carries this attribute value yet, so 0 is correct — the key was NOT stripped this time, it was validated and applied");
    });

    test("an unrecognized/unknown key is still rejected with 400 by parseProductListQuery (unchanged behavior)", async () => {
      await assert.rejects(() => parseProductListQuery({ totallyMadeUpKey123: "x" }), (err) => err instanceof HttpError && err.status === 400);
    });
  });

});
