// Integration tests for the shop filtering system's new query params
// (ageGroup=kids/girls/adult, new=true, featured=true, discount=true) and
// the Burqa/Hijab storefront scope — run against a real Next.js server via
// HTTP. services/productService.js imports lib/http.js, which imports
// "next/server" — that module isn't resolvable under a plain `node --test`
// process without the resolution hook other Phase 1 suites use (see
// tests/helpers/nextResolveHook.mjs) combined with Next's own bundler
// resolution being unavailable outside a real Next.js process anyway for
// the deeper service chain here — so this file goes through real HTTP
// requests against an actual server, same as it always has.
//
// Database isolation: as of the Phase 1 HTTP-test-server harness
// (scripts/httpTestServer.mjs, invoked via `npm run test:http`), the
// Next.js server this file talks to is started with an explicit,
// double-gated override (config/db.js's `ALLOW_TEST_DB_OVERRIDE` +
// `TEST_SERVER_MONGO_URI`) pointing it at the SAME database this file's
// own direct Mongoose fixture-writes use (MONGO_URI_TEST, via
// tests/helpers/testDb.mjs) — both sides are the same database, and the
// harness also seeds it (scripts/seedCatalog.mjs) before this file runs,
// so the "Burqa"/"Hijab" department assumptions below are met
// deterministically. This file's own test behavior/assertions are
// unchanged from before.
//
// If run any other way than `npm run test:http` (e.g. someone manually
// starts `npm run dev` and runs this file directly), BASE_URL still
// defaults to localhost:3000 and the suite still skips gracefully if
// nothing answers there — but the isolation/seed guarantees above do NOT
// hold in that manual scenario.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb } from "../helpers/testDb.mjs";

const BASE_URL = process.env.HTTP_TEST_BASE_URL || "http://localhost:3000";

let serverUp = false;
try {
  const res = await fetch(`${BASE_URL}/api/products?limit=1`);
  serverUp = res.ok;
} catch {
  serverUp = false;
}

// A second, independent preflight — see tests/http/relatedProducts.integration.test.mjs
// for the full reasoning (identical pattern here).
let dbConnectable = false;
if (serverUp && dbReady) {
  try {
    await connectTestDb();
    dbConnectable = true;
  } catch {
    dbConnectable = false;
  }
}

const skip = !serverUp
  ? "test server not reachable — run via `npm run test:http` (or `npm run dev` for manual, non-isolated runs)"
  : !dbConnectable
    ? skipReason || "MONGO_URI_TEST not reachable — see .env.test.example"
    : false;

describe("shop filtering: Age Group, Product Collection, Burqa/Hijab scope (real MongoDB, via HTTP)", { skip }, () => {
  let Product, Category;
  let leafCategoryId;
  let outOfScopeLeafCategoryId = null;
  const createdIds = [];

  const fetchJson = async (qs) => {
    const res = await fetch(`${BASE_URL}/api/products?${qs}`);
    return { status: res.status, json: await res.json() };
  };

  const makeProduct = async (overrides = {}) => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const product = new Product({
      name: `__test_filter_${suffix}`,
      description: "Temporary fixture created by tests/http/productFilters.integration.test.mjs — safe to delete.",
      category: leafCategoryId,
      basePrice: 1000,
      images: ["https://example.com/placeholder.jpg"],
      variants: [{ variantName: "Default", sku: `TESTSKU-${suffix}`, stock: 5 }],
      isActive: true,
      ...overrides,
    });
    await product.save();
    createdIds.push(product._id);
    return product;
  };

  // Mongoose's timestamps plugin silently strips createdAt out of
  // Model.updateOne()'s $set (confirmed empirically: modifiedCount comes
  // back 1, but the stored value never changes) — it's actively protected
  // from being touched by a normal update, on purpose. Going through the
  // raw driver collection bypasses that middleware entirely.
  const backdate = async (id, daysAgo) => {
    await Product.collection.updateOne({ _id: id }, { $set: { createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) } });
  };

  before(async () => {
    ({ default: Product } = await import("../../models/productModel.js"));
    ({ default: Category } = await import("../../models/categoryModel.js"));

    // Burqa/Hijab are real departments — one hop below the "Clothes"
    // division, not top-level roots themselves (see services/
    // categoryService.js's department-vs-division distinction) — so this
    // must not constrain `parent: null`.
    const burqa = await Category.findOne({ slug: "burqa" }).lean();
    const hijab = await Category.findOne({ slug: "hijab" }).lean();
    assert.ok(burqa && hijab, "seed data must include Burqa and Hijab departments — the harness runs scripts/seedCatalog.mjs before this file");

    const burqaLeaf = await Category.findOne({ parent: burqa._id }).lean();
    assert.ok(burqaLeaf, "Burqa needs at least one subcategory to attach test products to");
    leafCategoryId = burqaLeaf._id;

    // Real, previously-undiscovered test bug, found by actually running this
    // file against a real seeded catalog for the first time (Phase 1's HTTP
    // test harness): this used to hardcode `$nin: ["burqa", "hijab"]`, but
    // services/productService.js's real storefront scope
    // (STOREFRONT_DEPARTMENT_SLUGS) is six departments, not two — "niqab",
    // "abaya", "khimar", and "modest-sets" are ALSO in-scope. The old
    // hardcoded list would happily pick one of those four as the "out of
    // scope" department, then wrongly assert that an IN-scope product had
    // "leaked" — a false test failure, not a real app bug. Importing the
    // real constant instead of re-guessing it keeps this from drifting again.
    // Excludes "clothes" alongside the real in-scope departments — Clothes
    // is a root, but it's a division (its children are departments like
    // Burqa, not leaves), never itself a valid out-of-scope department to
    // pick here. Only a genuine root DEPARTMENT (children are leaves) not
    // in STOREFRONT_DEPARTMENT_SLUGS should ever match.
    const { STOREFRONT_DEPARTMENT_SLUGS } = await import("../../services/productService.js");
    const outOfScopeDept = await Category.findOne({
      parent: null,
      slug: { $nin: [...STOREFRONT_DEPARTMENT_SLUGS, "clothes"] },
    }).lean();
    if (outOfScopeDept) {
      const outOfScopeLeaf = await Category.findOne({ parent: outOfScopeDept._id }).lean();
      outOfScopeLeafCategoryId = outOfScopeLeaf?._id ?? null;
    }
  });

  after(async () => {
    if (createdIds.length) await Product.deleteMany({ _id: { $in: createdIds } });
    await disconnectTestDb();
  });

  test("ageGroup=girls returns girls products and excludes adult/kids", async () => {
    const girls = await makeProduct({ ageGroup: "girls" });
    const adult = await makeProduct({ ageGroup: "adult" });
    const { json } = await fetchJson("ageGroup=girls&limit=100");
    const ids = json.products.map((p) => p._id);
    assert.ok(ids.includes(girls._id.toString()), "girls product missing from ageGroup=girls results");
    assert.ok(!ids.includes(adult._id.toString()), "adult product leaked into ageGroup=girls results");
  });

  test("ageGroup=kids,girls ORs within the group (either value matches)", async () => {
    const kids = await makeProduct({ ageGroup: "kids" });
    const girls = await makeProduct({ ageGroup: "girls" });
    const adult = await makeProduct({ ageGroup: "adult" });
    const { json } = await fetchJson("ageGroup=kids,girls&limit=100");
    const ids = json.products.map((p) => p._id);
    assert.ok(ids.includes(kids._id.toString()));
    assert.ok(ids.includes(girls._id.toString()));
    assert.ok(!ids.includes(adult._id.toString()));
  });

  test("an unrecognized ageGroup value is safely ignored, not passed to Mongo", async () => {
    const adult = await makeProduct({ ageGroup: "adult" });
    const { status, json } = await fetchJson(`ageGroup=not-a-real-value&search=__test_filter_${adult.name.split("_").pop()}`);
    assert.equal(status, 200, "an invalid filter value must not crash the request");
    assert.ok(Array.isArray(json.products));
  });

  test("new=true returns only products created within the last 30 days", async () => {
    const fresh = await makeProduct({ ageGroup: "adult" });
    const old = await makeProduct({ ageGroup: "adult" });
    await backdate(old._id, 45);
    const { json } = await fetchJson("new=true&limit=200");
    const ids = json.products.map((p) => p._id);
    assert.ok(ids.includes(fresh._id.toString()), "recently created product missing from new=true");
    assert.ok(!ids.includes(old._id.toString()), "45-day-old product leaked into new=true");
  });

  test("featured=true returns only isFeatured products", async () => {
    const featured = await makeProduct({ isFeatured: true });
    const notFeatured = await makeProduct({ isFeatured: false });
    const { json } = await fetchJson("featured=true&limit=200");
    const ids = json.products.map((p) => p._id);
    assert.ok(ids.includes(featured._id.toString()));
    assert.ok(!ids.includes(notFeatured._id.toString()));
  });

  test("discount=true returns only products with a real discountPrice < basePrice", async () => {
    const discounted = await makeProduct({ basePrice: 2000, discountPrice: 1500 });
    const fullPrice = await makeProduct({ basePrice: 2000, discountPrice: null });
    const { json } = await fetchJson("discount=true&limit=200");
    const ids = json.products.map((p) => p._id);
    assert.ok(ids.includes(discounted._id.toString()));
    assert.ok(!ids.includes(fullPrice._id.toString()));
    const found = json.products.find((p) => p._id === discounted._id.toString());
    assert.ok(found.discountPrice < found.basePrice, "discount=true returned a product without a real price reduction");
  });

  test("Featured + Discount (Collection group) OR together", async () => {
    const featuredOnly = await makeProduct({ isFeatured: true, discountPrice: null });
    const discountOnly = await makeProduct({ isFeatured: false, basePrice: 2000, discountPrice: 1200 });
    const neither = await makeProduct({ isFeatured: false, discountPrice: null });
    const { json } = await fetchJson("featured=true&discount=true&limit=200");
    const ids = json.products.map((p) => p._id);
    assert.ok(ids.includes(featuredOnly._id.toString()), "featured-only product missing from OR'd Collection filter");
    assert.ok(ids.includes(discountOnly._id.toString()), "discount-only product missing from OR'd Collection filter");
    assert.ok(!ids.includes(neither._id.toString()));
  });

  test("Age Group AND Product Collection combine (girls AND featured)", async () => {
    const match = await makeProduct({ ageGroup: "girls", isFeatured: true });
    const wrongAgeGroup = await makeProduct({ ageGroup: "adult", isFeatured: true });
    const wrongCollection = await makeProduct({ ageGroup: "girls", isFeatured: false });
    const { json } = await fetchJson("ageGroup=girls&featured=true&limit=200");
    const ids = json.products.map((p) => p._id);
    assert.ok(ids.includes(match._id.toString()));
    assert.ok(!ids.includes(wrongAgeGroup._id.toString()));
    assert.ok(!ids.includes(wrongCollection._id.toString()));
  });

  test("only Burqa/Hijab category products appear with no category filter", async () => {
    if (!outOfScopeLeafCategoryId) return; // catalog has no out-of-scope department to test against
    const outOfScope = await makeProduct({ category: outOfScopeLeafCategoryId });
    const { json } = await fetchJson("limit=200");
    const ids = json.products.map((p) => p._id);
    assert.ok(!ids.includes(outOfScope._id.toString()), "an out-of-scope department product leaked onto the storefront");
  });

  test("requesting an out-of-scope category id directly returns zero results, not the full catalog", async () => {
    if (!outOfScopeLeafCategoryId) return;
    const outOfScopeDept = await Category.findById(outOfScopeLeafCategoryId).lean();
    const { json } = await fetchJson(`category=${outOfScopeDept.parent}&limit=10`);
    assert.equal(json.products.length, 0);
    assert.equal(json.total, 0);
  });

  test("response includes real facet counts for ageGroup and collection", async () => {
    const { json } = await fetchJson("limit=1");
    assert.ok(json.facets, "listProducts response is missing a facets object");
    assert.ok(typeof json.facets.ageGroup.adult === "number");
    assert.ok(typeof json.facets.ageGroup.kids === "number");
    assert.ok(typeof json.facets.ageGroup.girls === "number");
    assert.ok(typeof json.facets.collection.new === "number");
    assert.ok(typeof json.facets.collection.featured === "number");
    assert.ok(typeof json.facets.collection.discount === "number");
  });

  test("pagination metadata is internally consistent", async () => {
    const { json } = await fetchJson("limit=5&page=1");
    assert.equal(json.limit, 5);
    assert.equal(json.page, 1);
    assert.equal(json.pages, Math.max(1, Math.ceil(json.total / 5)));
    assert.ok(json.products.length <= 5);
    assert.equal(json.count, json.products.length);
  });

  test("malformed pagination params don't crash the request", async () => {
    const { status, json } = await fetchJson("page=not-a-number&limit=also-not-a-number");
    assert.equal(status, 200);
    assert.equal(json.page, 1);
    assert.equal(json.limit, 12);
  });
});
