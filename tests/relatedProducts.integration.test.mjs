// Integration tests for the real MongoDB-backed related-products and
// batch-lookup endpoints. This project has no isolated test database
// (only MONGO_URI is configured, no MONGO_URI_TEST) and no mocking layer
// over Mongoose, so — consistent with how every feature in this project has
// been verified — these tests run against the same dev database via the
// live dev server's REST API, and against Mongoose directly only to create
// and immediately remove one temporary inactive product (guaranteed via
// try/finally) to prove inactive products are excluded.
//
// Requires the dev server running at localhost:3000 (`npm run dev`) and a
// reachable MONGO_URI. Skips (not fails) if the server isn't reachable.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:3000";

let serverUp = false;
try {
  const res = await fetch(`${BASE_URL}/api/products?limit=1`);
  serverUp = res.ok;
} catch {
  serverUp = false;
}

describe(
  "related-products and batch endpoints (real MongoDB)",
  { skip: !serverUp && "dev server not reachable at localhost:3000 — run `npm run dev` first" },
  () => {
    let activeProducts;
    let tempInactiveId;
    let connectDB, Product;

    before(async () => {
      const listRes = await fetch(`${BASE_URL}/api/products?limit=100`);
      const listJson = await listRes.json();
      activeProducts = listJson.products;
      assert.ok(activeProducts.length >= 2, "seed data must have at least 2 active products to test against");

      ({ default: connectDB } = await import("../config/db.js"));
      ({ default: Product } = await import("../models/productModel.js"));
      await connectDB();

      const created = await Product.create({
        name: "TEST-ONLY inactive product (safe to delete)",
        description: "Created by tests/relatedProducts.integration.test.js — removed in `after`.",
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

    test("batch endpoint silently drops malformed ids instead of erroring", async () => {
      const validId = activeProducts[0]._id;
      const res = await fetch(`${BASE_URL}/api/products/batch?ids=not-an-id,${validId},123`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.deepEqual(
        json.products.map((p) => p._id),
        [validId],
      );
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

    test("batch endpoint returns an empty list for an empty ids param", async () => {
      const res = await fetch(`${BASE_URL}/api/products/batch?ids=`);
      const json = await res.json();
      assert.deepEqual(json.products, []);
    });
  },
);
