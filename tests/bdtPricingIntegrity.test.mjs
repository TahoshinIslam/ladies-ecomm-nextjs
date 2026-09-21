// Regression coverage for the BDT-only currency migration (see
// docs/CURRENCY_MIGRATION_PLAN.md) and the SKU-uniqueness /
// inactive-product enforcement it depends on. Exercises the real Route
// Handlers and services against the disposable test database — no mocks
// of the pricing/enforcement logic itself.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  truncateAll,
  createTestSession,
  createTestUser,
  createTestCategory,
  requestAs,
  deleteRows,
  rawQuery,
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("BDT-only pricing integrity", { skip: !canRun && reason }, () => {
  let productsPOST;
  let getProductByIdOrSlug;
  let cartPOST, ordersPreviewPOST, ordersPOST;
  let Product;
  let admin, category;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ POST: productsPOST } = await import("../app/api/products/route.js"));
    ({ getProductByIdOrSlug } = await import("../services/productService.js"));
    ({ POST: cartPOST } = await import("../app/api/cart/route.js"));
    ({ POST: ordersPreviewPOST } = await import("../app/api/orders/preview/route.js"));
    ({ POST: ordersPOST } = await import("../app/api/orders/route.js"));
    ({ default: Product } = await import("../models/productModel.js"));

    admin = await createTestUser({ role: "admin" });
    category = await createTestCategory();
  });

  after(async () => {
    await disconnectTestDb();
  });

  function newProductBody(overrides = {}) {
    return {
      name: `BDT Test Product ${Date.now()}-${Math.random().toString(36).slice(2)}`,
      description: "A test product",
      category: category._id.toString(),
      basePrice: 1000,
      images: ["https://example.test/a.jpg"],
      variants: [{ variantName: "Default", sku: `BDT-SKU-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, stock: 50 }],
      ...overrides,
    };
  }

  // ---------- 1 & 2: real admin/API creation defaults to BDT; DB and app defaults agree ----------

  test("a product created through the real admin POST /api/products path defaults to price_currency='BDT', no exchange rate involved", async () => {
    const body = newProductBody();
    const req = requestAs({ method: "POST", url: "http://test/api/products", session: await createTestSession(admin._id), body });
    const res = await productsPOST(req);
    assert.equal(res.status, 201);
    const json = await res.json();
    try {
      assert.equal(json.product.priceCurrency, "BDT", "API response must report the new product as BDT-native");
      const [row] = await rawQuery("SELECT price_currency, base_price FROM products WHERE id = ?", [json.product._id]);
      assert.equal(row.price_currency, "BDT", "the DB row itself must be BDT — not left to a stale 'USD' default");
      assert.equal(Number(row.base_price), 1000, "the entered value must be stored as-is, no ×rate conversion applied at creation");
    } finally {
      await deleteRows("products", "id", json.product._id);
    }
  });

  test("the products.price_currency column DEFAULT and the app's own creation default agree (both BDT)", async () => {
    const [col] = await rawQuery(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'price_currency'`,
    );
    // MariaDB's information_schema quotes an ENUM's literal default
    // ("'BDT'"), unlike a plain string/number column's default.
    assert.equal(
      String(col.column_default).replace(/^'|'$/g, ""),
      "BDT",
      "schema DEFAULT must be BDT (scripts/migrations/0005_bdt_default_currency.mjs)",
    );

    // App-level default: Product.create() with no priceCurrency field at
    // all (mirrors a caller that forgets to set it) must still land on BDT.
    const product = await Product.create({
      name: `Default Check ${Date.now()}`,
      description: "x",
      category: category._id,
      basePrice: 500,
      images: [],
      variants: [{ variantName: "Default", sku: `DEF-${Date.now()}`, stock: 1 }],
    });
    try {
      assert.equal(product.priceCurrency, "BDT");
    } finally {
      await deleteRows("products", "id", product._id);
    }
  });

  // ---------- 3: ৳1,000 survives unchanged end-to-end ----------

  test("an entered price of ৳1,000 remains ৳1,000 through storage, card/detail resolution, cart, order preview, and real order creation", async () => {
    const body = newProductBody({ basePrice: 1000 });
    const createRes = await productsPOST(
      requestAs({ method: "POST", url: "http://test/api/products", session: await createTestSession(admin._id), body }),
    );
    assert.equal(createRes.status, 201);
    const { product } = await createRes.json();
    const buyer = await createTestUser({ role: "customer" });

    try {
      // Storage
      const [row] = await rawQuery("SELECT base_price, price_currency FROM products WHERE id = ?", [product._id]);
      assert.equal(Number(row.base_price), 1000);
      assert.equal(row.price_currency, "BDT");

      // Card/detail resolution — the same service function the product
      // detail page's data fetch calls (see app/api/products/[idOrSlug]/
      // route.js). Called directly here rather than through that route,
      // which also invokes next/headers' cookies()-based locale resolver
      // and therefore requires a real Next.js request scope this
      // Route-Handler-level test harness doesn't provide.
      const fetched = await getProductByIdOrSlug(product._id);
      assert.equal(fetched.basePrice, 1000);
      assert.equal(fetched.priceCurrency, "BDT");

      // Cart
      const cartRes = await cartPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/cart",
          session: await createTestSession(buyer._id),
          body: { productId: product._id, variantId: product.variants[0]._id, quantity: 1 },
        }),
      );
      assert.equal(cartRes.status, 200);

      // Order preview (server-authoritative pricing)
      const previewRes = await ordersPreviewPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/orders/preview",
          session: await createTestSession(buyer._id),
          body: {
            items: [{ productId: product._id, variantId: product.variants[0]._id, quantity: 1 }],
            shippingAddress: { country: "Bangladesh" },
          },
        }),
      );
      assert.equal(previewRes.status, 200);
      const { preview } = await previewRes.json();
      assert.equal(preview.subtotal, 1000, "preview subtotal must be the raw entered price, no exchange-rate multiplication");
      assert.equal(preview.currency, "BDT");

      // Real order creation
      const orderRes = await ordersPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/orders",
          session: await createTestSession(buyer._id),
          body: {
            items: [{ productId: product._id, variantId: product.variants[0]._id, quantity: 1 }],
            shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" },
          },
        }),
      );
      assert.equal(orderRes.status, 201);
      const { order } = await orderRes.json();
      assert.equal(order.subtotal, 1000);
      assert.equal(order.currency, "BDT");
      assert.equal(order.items[0].snapshot.price, 1000, "the immutable order snapshot must also record the raw ৳1,000, not a converted value");
    } finally {
      await deleteRows("orders", "customer_id", buyer._id);
      await deleteRows("carts", "customer_id", buyer._id);
      await deleteRows("products", "id", product._id);
      await deleteRows("customers", "id", buyer._id);
    }
  });

  // ---------- 4: a migration re-run cannot double-convert an already-migrated row ----------
  //
  // Imports the REAL shared decision functions scripts/migrations/
  // 0003_bdt_price_currency.mjs actually calls (lib/bdtMigration.js) —
  // not a hand-copied reimplementation of the guard that could pass even
  // if the real migration's logic were broken. See lib/bdtMigration.js's
  // own header for why this split exists (pure decision logic vs. the
  // migration's own DB I/O).

  test("computeProductBdtMigration() — the real function 0003 calls — cannot double-convert an already-'BDT' row", async () => {
    const { computeProductBdtMigration } = await import("../lib/bdtMigration.js");
    const RATE = 120;
    const expected = { baseUsd: 10, discountUsd: null };

    const first = computeProductBdtMigration({ basePrice: 10, discountPrice: null, priceCurrency: "USD" }, expected, RATE);
    assert.equal(first.applied, true);
    assert.equal(first.basePrice, 1200, "first application converts once, as expected");
    assert.equal(first.priceCurrency, "BDT");

    // Feed the FIRST call's own output back in, exactly as the real
    // migration would on a second run against the now-migrated row.
    const second = computeProductBdtMigration(
      { basePrice: first.basePrice, discountPrice: first.discountPrice, priceCurrency: first.priceCurrency },
      expected,
      RATE,
    );
    assert.equal(second.applied, false, "a second run against an already-'BDT' row must be a no-op");
    assert.equal(second.basePrice, 1200, "must NOT become 1200 * 120 = 144000");
  });

  test("computeVariantBdtMigration() — the real function 0003 calls — cannot double-convert an already-converted variant price", async () => {
    const { computeVariantBdtMigration } = await import("../lib/bdtMigration.js");
    const RATE = 120;

    const first = computeVariantBdtMigration(10, 10, RATE);
    assert.equal(first.applied, true);
    assert.equal(first.price, 1200);

    const second = computeVariantBdtMigration(first.price, 10, RATE);
    assert.equal(second.applied, false, "a second run against the already-converted price must be a no-op");
    assert.equal(second.price, 1200, "must NOT become 1200 * 120 = 144000");
  });

  test("computeProductBdtMigration() refuses to convert data that no longer matches the audited pre-migration value", async () => {
    const { computeProductBdtMigration } = await import("../lib/bdtMigration.js");
    assert.throws(
      () => computeProductBdtMigration({ basePrice: 999, discountPrice: null, priceCurrency: "USD" }, { baseUsd: 10, discountUsd: null }, 120),
      /no longer matches the audited value/,
      "must refuse to blindly convert unaudited/stale data rather than guessing",
    );
  });

  // Note: migration 0003's real up() is NOT invoked end-to-end here — it
  // iterates 11 hardcoded, dev-database-specific product ids in one
  // sequence and throws immediately on the first one not found, so it
  // cannot run to completion against a generic test database seeded with
  // only some of them. That constraint is exactly why the actual
  // idempotency decision was extracted into lib/bdtMigration.js's pure,
  // DB-free functions above — those ARE the real code 0003 calls per row
  // (confirmed by import path, not a copy), and are what this suite tests
  // directly. 0003's own guard against unaudited/missing rows was
  // exercised for real against the live dev database when it originally
  // ran (see docs/CURRENCY_MIGRATION_PLAN.md's execution record).

  // ---------- 5: duplicate SKU rejected server-side ----------

  test("creating a product with a SKU that already exists is rejected (400), never silently duplicated", async () => {
    const sku = `DUP-SKU-${Date.now()}`;
    const first = await productsPOST(
      requestAs({
        method: "POST",
        url: "http://test/api/products",
        session: await createTestSession(admin._id),
        body: newProductBody({ variants: [{ variantName: "Default", sku, stock: 5 }] }),
      }),
    );
    assert.equal(first.status, 201);
    const { product: firstProduct } = await first.json();

    try {
      const second = await productsPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/products",
          session: await createTestSession(admin._id),
          body: newProductBody({ variants: [{ variantName: "Default", sku, stock: 5 }] }),
        }),
      );
      assert.equal(second.status, 400, "a duplicate SKU must be rejected, not create a second product");

      const dupRows = await rawQuery("SELECT COUNT(*) AS n FROM product_variants WHERE sku = ?", [sku]);
      assert.equal(dupRows[0].n, 1, "exactly one variant must hold this SKU in the database");
    } finally {
      await deleteRows("products", "id", firstProduct._id);
    }
  });

  // ---------- 6: inactive products cannot be purchased via direct server requests ----------

  test("an inactive product is rejected by cart add and by order preview/creation, even via a direct API call", async () => {
    const body = newProductBody();
    const createRes = await productsPOST(
      requestAs({ method: "POST", url: "http://test/api/products", session: await createTestSession(admin._id), body }),
    );
    const { product } = await createRes.json();
    await rawQuery("UPDATE products SET is_active = 0 WHERE id = ?", [product._id]);
    const buyer = await createTestUser({ role: "customer" });

    try {
      const cartRes = await cartPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/cart",
          session: await createTestSession(buyer._id),
          body: { productId: product._id, variantId: product.variants[0]._id, quantity: 1 },
        }),
      );
      assert.equal(cartRes.status, 404);

      const previewRes = await ordersPreviewPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/orders/preview",
          session: await createTestSession(buyer._id),
          body: {
            items: [{ productId: product._id, variantId: product.variants[0]._id, quantity: 1 }],
            shippingAddress: { country: "Bangladesh" },
          },
        }),
      );
      assert.equal(previewRes.status, 400);

      const orderRes = await ordersPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/orders",
          session: await createTestSession(buyer._id),
          body: {
            items: [{ productId: product._id, variantId: product.variants[0]._id, quantity: 1 }],
            shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" },
          },
        }),
      );
      assert.equal(orderRes.status, 400);

      const orderCount = await rawQuery("SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?", [buyer._id]);
      assert.equal(orderCount[0].n, 0, "no order must have been created for the inactive product");
    } finally {
      await deleteRows("products", "id", product._id);
      await deleteRows("customers", "id", buyer._id);
    }
  });
});
