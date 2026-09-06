// Integration tests for the real MongoDB-backed related-products and
// batch-lookup endpoints — run against a real Next.js server via HTTP.
//
// Database isolation: as of the Phase 1 HTTP-test-server harness
// (scripts/httpTestServer.mjs, invoked via `npm run test:http`), the
// Next.js server this file talks to is started with an explicit,
// double-gated override (config/db.js's `ALLOW_TEST_DB_OVERRIDE` +
// `TEST_SERVER_MONGO_URI`) pointing it at the SAME database this file's
// own direct Mongoose fixture-writes use (MONGO_URI_TEST, via
// tests/helpers/testDb.mjs) — both sides are now genuinely the same
// database, closing the split-brain gap the previous version of this
// comment described. This file's own test behavior/assertions are
// unchanged from before.
//
// If run any other way than `npm run test:http` (e.g. someone manually
// starts `npm run dev` and runs this file directly), BASE_URL still
// defaults to localhost:3000 and the suite still skips gracefully if
// nothing answers there — but in that manual scenario the isolation
// guarantee above does NOT hold (a manually-started `next dev` uses
// whatever MONGO_URI it has, not MONGO_URI_TEST). Prefer `npm run
// test:http` / `npm run test:all`.
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

// A second, independent preflight — separate from the server-reachability
// check above — so a missing/unreachable MONGO_URI_TEST degrades this
// suite to a graceful skip instead of a hard failure in before(). Only
// attempted when serverUp is already true, so a connection that would
// never get cleaned up (this describe's own after(), which does the
// actual disconnect, never runs when the describe itself is skipped)
// is never opened in the first place.
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

describe("related-products and batch endpoints (real MongoDB, via HTTP)", { skip }, () => {
  let activeProducts;
  let tempInactiveId;
  let Product;

  before(async () => {
    const listRes = await fetch(`${BASE_URL}/api/products?limit=100`);
    const listJson = await listRes.json();
    activeProducts = listJson.products;
    assert.ok(activeProducts.length >= 2, "seed data must have at least 2 active products to test against");

    ({ default: Product } = await import("../../models/productModel.js"));

    const created = await Product.create({
      name: "TEST-ONLY inactive product (safe to delete)",
      description: "Created by tests/http/relatedProducts.integration.test.mjs — removed in `after`.",
      category: activeProducts[0].category?._id || activeProducts[0].category,
      basePrice: 50,
      images: ["https://placehold.co/400x400?text=test"],
      variants: [{ variantName: "Default", sku: "TEST-TEMP-SKU", stock: 5 }],
      isActive: false,
    });
    tempInactiveId = created._id.toString();
  });

  after(async () => {
    if (tempInactiveId && Product) await Product.deleteOne({ _id: tempInactiveId });
    await disconnectTestDb();
  });

  test("related-products excludes the current product itself", async () => {
    const target = activeProducts[0];
    const res = await fetch(`${BASE_URL}/api/products/${target._id}/related`);
    const json = await res.json();
    assert.ok(json.products.every((p) => p._id !== target._id));
  });

  test("related-products respects the limit param", async () => {
    const target = activeProducts[0];
    const res = await fetch(`${BASE_URL}/api/products/${target._id}/related?limit=2`);
    const json = await res.json();
    assert.ok(json.products.length <= 2);
  });

  test("related-products fallback-fill returns real candidates on a sparse catalog", async () => {
    const target = activeProducts[0];
    const res = await fetch(`${BASE_URL}/api/products/${target._id}/related`);
    const json = await res.json();
    // Live-confirmed prior bug: same-topCategory-only matching returned 0
    // results on this catalog. The fallback-fill fix must return real
    // products, not an invented/empty result.
    assert.ok(json.products.length > 0);
    for (const p of json.products) assert.ok(p._id && p.name);
  });

  test("related-products never surfaces an inactive product", async () => {
    const target = activeProducts[0];
    const res = await fetch(`${BASE_URL}/api/products/${target._id}/related?limit=24`);
    const json = await res.json();
    assert.ok(json.products.every((p) => p._id !== tempInactiveId));
  });

  test("batch endpoint returns matching active products for valid ids", async () => {
    const ids = activeProducts.slice(0, 2).map((p) => p._id);
    const res = await fetch(`${BASE_URL}/api/products/batch?ids=${ids.join(",")}`);
    const json = await res.json();
    assert.equal(json.products.length, 2);
    assert.deepEqual(
      json.products.map((p) => p._id).sort(),
      [...ids].sort(),
    );
  });

  test("FIXED (Phase 5C): a malformed id in the batch list rejects the WHOLE request (400), rather than silently dropping it", async () => {
    // schemas/catalogSchemas.js's productBatchQuerySchema now validates
    // every comma-separated id explicitly — "do not silently filter
    // invalid IDs" per the Phase 5 input-validation contract. Previously
    // a garbage id was just dropped and the request quietly succeeded with
    // whatever valid ids remained.
    const validId = activeProducts[0]._id;
    const res = await fetch(`${BASE_URL}/api/products/batch?ids=not-an-id,${validId},123`);
    assert.equal(res.status, 400);
  });

  test("batch endpoint excludes an inactive product", async () => {
    const validId = activeProducts[0]._id;
    const res = await fetch(`${BASE_URL}/api/products/batch?ids=${tempInactiveId},${validId}`);
    const json = await res.json();
    assert.deepEqual(
      json.products.map((p) => p._id),
      [validId],
    );
  });

  test("FIXED (Phase 5C): an empty ids param is now rejected (400) — 'at least one id is required', not silently a 200 with an empty list", async () => {
    const res = await fetch(`${BASE_URL}/api/products/batch?ids=`);
    assert.equal(res.status, 400);
  });

  test("FIXED (Phase 5C): duplicate ids in the batch list are de-duplicated (not meaningful, not rejected)", async () => {
    const validId = activeProducts[0]._id;
    const res = await fetch(`${BASE_URL}/api/products/batch?ids=${validId},${validId}`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.products.length, 1);
  });

  test("FIXED (Phase 5C): more than the maximum allowed ids is rejected (400)", async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => "5".repeat(23) + i.toString(16)).join(",");
    const res = await fetch(`${BASE_URL}/api/products/batch?ids=${tooMany}`);
    assert.equal(res.status, 400);
  });
});
