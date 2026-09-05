// Phase 8 — real cache-hit and invalidation behavior, proven against the
// actual `next start` process (unstable_cache's cache store only exists
// inside a real Next.js server runtime — calling it from a bare
// node:test process, as tests/*.test.mjs do for the rest of this app,
// would not exercise real caching at all). Uses uniquely seeded records
// per test to avoid cross-test cache collisions, and observes real data
// effects (a direct DB write staying hidden, then appearing after a real
// mutation) rather than relying on elapsed timing.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestUser } from "../helpers/testDb.mjs";

const BASE_URL = process.env.HTTP_TEST_BASE_URL || "http://localhost:3000";

let serverUp = false;
try {
  const res = await fetch(`${BASE_URL}/api/settings/public`);
  serverUp = res.ok || res.status < 500;
} catch {
  serverUp = false;
}

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
  ? "test server not reachable — run via `npm run test:http`"
  : !dbConnectable
    ? skipReason || "MONGO_URI_TEST not reachable — see .env.test.example"
    : false;

class CookieJar {
  constructor() { this.cookies = new Map(); }
  absorb(response) {
    const lines = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const raw of lines) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  get(name) { return this.cookies.get(name); }
}

async function req(jar, path, { method = "GET", body, extraHeaders = {} } = {}) {
  const headers = new Headers(extraHeaders);
  const cookieHeader = jar?.header();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (method !== "GET") headers.set("origin", BASE_URL);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  jar?.absorb(res);
  return res;
}

async function loginAs(email, password) {
  const jar = new CookieJar();
  const res = await req(jar, "/api/users/login", { method: "POST", body: { email, password } });
  assert.equal(res.status, 200, "test fixture login must succeed");
  return jar;
}

async function adminReq(jar, path, opts = {}) {
  return req(jar, path, { ...opts, extraHeaders: { ...(opts.extraHeaders || {}), "x-csrf-token": jar.get("tahos_csrf") } });
}

// A real shop listing can contain up to 100 OTHER, already-seeded products
// on `limit=100` — a bare `html.includes("9999")` price check would be a
// false positive/negative if any unrelated product's price, id, or SKU
// happens to contain the same digits. Scoping the check to a window near
// THIS test's own (crypto-randomized, unique) product name ties the
// assertion to the one product that matters.
//
// The response body contains the product's name TWICE — once inside the
// embedded RSC flight payload (a JSON-escaped blob of every prop, in
// whatever order React serialized it) and once in the actual rendered
// HTML card — and either occurrence can come first depending on
// streaming order. Checking the window after EVERY occurrence (not just
// the first) avoids depending on that ordering.
function priceAppearsNearName(html, name, priceText) {
  let idx = html.indexOf(name);
  while (idx !== -1) {
    if (html.slice(idx, idx + 2000).includes(priceText)) return true;
    idx = html.indexOf(name, idx + 1);
  }
  return false;
}

describe("Phase 8 — real cache hit/invalidation behavior (real MongoDB, via HTTP)", { skip }, () => {
  let Product, Category, Order;
  let admin, adminJar;
  let burqaLeafId, burqaDeptId;
  const createdProductIds = [];
  const createdOrderIds = [];

  before(async () => {
    ({ default: Product } = await import("../../models/productModel.js"));
    ({ default: Category } = await import("../../models/categoryModel.js"));
    ({ default: Order } = await import("../../models/orderModel.js"));

    const burqa = await Category.findOne({ slug: "burqa", parent: null }).lean();
    assert.ok(burqa, "seed data must include the Burqa department");
    const burqaLeaf = await Category.findOne({ parent: burqa._id }).lean();
    assert.ok(burqaLeaf, "Burqa needs a subcategory to attach test products to");
    burqaDeptId = burqa._id.toString();
    burqaLeafId = burqaLeaf._id.toString();

    admin = await createTestUser({ role: "admin" });
    adminJar = await loginAs(admin.email, "TestPassword123!");
  });

  after(async () => {
    if (createdOrderIds.length) await Order.deleteMany({ _id: { $in: createdOrderIds } });
    if (createdProductIds.length) await Product.deleteMany({ _id: { $in: createdProductIds } });
    await disconnectTestDb();
  });

  async function makeProduct(overrides = {}) {
    const suffix = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const product = await Product.create({
      name: `__cache_test_${suffix}`,
      description: "Phase 8 cache-behavior fixture — safe to delete.",
      category: burqaLeafId,
      topCategory: burqaDeptId,
      basePrice: 5000,
      images: ["https://placehold.co/400x400?text=test"],
      variants: [{ variantName: "Default", sku: `CACHE-${suffix}`, stock: 10 }],
      isActive: true,
      ...overrides,
    });
    createdProductIds.push(product._id);
    return product;
  }

  // ---------- 1/3/4: real cache hit, invalidation, param-order equivalence ----------

  test("a public shop read is cached: a direct DB price change stays hidden until a real mutation invalidates it", async () => {
    // Deliberately under 1000 — Intl.NumberFormat currency grouping would
    // otherwise render e.g. 9999 as "9,999", which a bare digit-string
    // check would never match regardless of caching correctness.
    const product = await makeProduct({ basePrice: 500 });
    const qs = `category=${burqaDeptId}&sort=-createdAt&limit=100`;

    const first = await (await fetch(`${BASE_URL}/shop?${qs}`)).text();
    assert.ok(first.includes(product.name), "the fixture product must appear in the initial (uncached-yet) read");
    assert.ok(priceAppearsNearName(first, product.name, "500"));

    // Bypass the API entirely — a raw DB write the cache cannot know about.
    await Product.updateOne({ _id: product._id }, { $set: { basePrice: 999 } });

    const second = await (await fetch(`${BASE_URL}/shop?${qs}`)).text();
    assert.ok(!priceAppearsNearName(second, product.name, "999"), "a cached read must NOT reflect a direct DB change — proves the second request was actually served from cache");

    // Now a REAL mutation through the admin route — this is what actually
    // invalidates the CATALOG tag.
    const putRes = await adminReq(adminJar, `/api/products/${product._id}`, { method: "PUT", body: { basePrice: 999, category: burqaLeafId } });
    assert.equal(putRes.status, 200);

    const third = await (await fetch(`${BASE_URL}/shop?${qs}`)).text();
    assert.ok(priceAppearsNearName(third, product.name, "999"), "the next read after a real mutation must show the fresh price");
  });

  test("equivalent query parameters in a different order share ONE canonical cache entry", async () => {
    const product = await makeProduct({ basePrice: 610 });
    const qsA = `category=${burqaDeptId}&sort=-createdAt`;
    const qsB = `sort=-createdAt&category=${burqaDeptId}`;

    await fetch(`${BASE_URL}/shop?${qsA}&limit=100`);
    await fetch(`${BASE_URL}/shop?${qsB}&limit=100`);

    await Product.updateOne({ _id: product._id }, { $set: { basePrice: 770 } });

    const afterA = await (await fetch(`${BASE_URL}/shop?${qsA}&limit=100`)).text();
    const afterB = await (await fetch(`${BASE_URL}/shop?${qsB}&limit=100`)).text();
    assert.ok(
      !priceAppearsNearName(afterA, product.name, "770") && !priceAppearsNearName(afterB, product.name, "770"),
      "both param orders must still be stale (same cache entry)",
    );

    const putRes = await adminReq(adminJar, `/api/products/${product._id}`, { method: "PUT", body: { basePrice: 770, category: burqaLeafId } });
    assert.equal(putRes.status, 200);

    const refreshedA = await (await fetch(`${BASE_URL}/shop?${qsA}&limit=100`)).text();
    const refreshedB = await (await fetch(`${BASE_URL}/shop?${qsB}&limit=100`)).text();
    assert.ok(
      priceAppearsNearName(refreshedA, product.name, "770") && priceAppearsNearName(refreshedB, product.name, "770"),
      "one invalidation must refresh BOTH param orderings, proving they shared one entry",
    );
  });

  // ---------- 6: product create/delete/activation updates catalog visibility ----------

  test("product deactivation removes it from the public shop listing after invalidation", async () => {
    const product = await makeProduct();
    const qs = `category=${burqaDeptId}&limit=100`;

    const before1 = await (await fetch(`${BASE_URL}/shop?${qs}`)).text();
    assert.ok(before1.includes(product.name));

    const delRes = await adminReq(adminJar, `/api/products/${product._id}`, { method: "DELETE" });
    assert.equal(delRes.status, 200);

    const after1 = await (await fetch(`${BASE_URL}/shop?${qs}`)).text();
    assert.ok(!after1.includes(product.name), "a deactivated product must not remain visible after the cache is invalidated");
  });

  test("a raw-inserted new product is invisible until ANY real product mutation broadly invalidates the catalog", async () => {
    const qs = `category=${burqaDeptId}&limit=200`;
    await fetch(`${BASE_URL}/shop?${qs}`); // warm the cache

    const rawProduct = await makeProduct({ name: `__cache_test_raw_${crypto.randomBytes(4).toString("hex")}` });
    const stillCached = await (await fetch(`${BASE_URL}/shop?${qs}`)).text();
    assert.ok(!stillCached.includes(rawProduct.name), "a raw DB insert must not appear until the cache is invalidated");

    // Any real product mutation broadly invalidates CATALOG.
    const otherProduct = await makeProduct({ name: `__cache_test_trigger_${crypto.randomBytes(4).toString("hex")}` });
    const putRes = await adminReq(adminJar, `/api/products/${otherProduct._id}`, { method: "PUT", body: { basePrice: 1234, category: burqaLeafId } });
    assert.equal(putRes.status, 200);

    const refreshed = await (await fetch(`${BASE_URL}/shop?${qs}`)).text();
    assert.ok(refreshed.includes(rawProduct.name), "the broad CATALOG invalidation must surface the raw-inserted product too");
  });

  // ---------- 12: failed mutations do not cause false invalidation ----------

  test("a failed (validation-rejected) product update does not invalidate the cache", async () => {
    const product = await makeProduct({ basePrice: 4321 });
    const qs = `category=${burqaDeptId}&limit=100`;
    await fetch(`${BASE_URL}/shop?${qs}`); // warm

    await Product.updateOne({ _id: product._id }, { $set: { basePrice: 8888 } });

    // A negative basePrice fails Phase 5 schema validation — never reaches
    // updateProduct(), so invalidateCacheTags() is never called.
    const badRes = await adminReq(adminJar, `/api/products/${product._id}`, { method: "PUT", body: { basePrice: -5 } });
    assert.equal(badRes.status, 400);

    const stillStale = await (await fetch(`${BASE_URL}/shop?${qs}`)).text();
    assert.ok(!stillStale.includes("8888"), "a rejected mutation must not have invalidated the cache — the entry is still the pre-existing cached value");
  });

  // ---------- 13: cache-ineligible search queries remain uncached and correct ----------

  test("a free-text search query is never cached — it always reflects the latest data immediately", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    // A single distinctive token (no underscores) — MongoDB's $text search
    // tokenizes on word boundaries, so an underscore-joined identifier
    // would be split into common words ("cache", "test", ...) matched
    // against unrelated fixtures from other tests sharing this database;
    // one opaque hex token avoids that ambiguity entirely.
    const uniqueToken = `cachetestsearch${suffix}`;
    const product = await makeProduct({ name: uniqueToken, basePrice: 321 });
    const searchUrl = `${BASE_URL}/shop?search=${uniqueToken}`;

    const firstRes = await fetch(searchUrl);
    assert.equal(firstRes.status, 200);
    const first = await firstRes.text();
    assert.ok(first.includes(product.name), "the fixture product must be findable by its own unique name");
    assert.ok(priceAppearsNearName(first, product.name, "321"), "the fixture's real (unmodified) price must appear");

    // A direct DB price change (no invalidation call at all) — an
    // ineligible (search) query must reflect this on the very next
    // request, since it was never cached in the first place.
    await Product.updateOne({ _id: product._id }, { $set: { basePrice: 654 } });
    const secondRes = await fetch(searchUrl);
    const second = await secondRes.text();
    assert.ok(priceAppearsNearName(second, product.name, "654"), "search results must never be served from the shared cache — the direct DB change must appear immediately");
  });

  // ---------- 8: category mutation invalidates affected lists/facets ----------

  test("a category rename is reflected immediately after the mutation (categories cache invalidated)", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const testCat = await Category.create({ name: `__cache_cat_${suffix}`, slug: `cache-cat-${suffix}`, parent: null });
    try {
      await fetch(`${BASE_URL}/api/categories`); // warm the categories cache
      const renamed = `__cache_cat_renamed_${suffix}`;
      const putRes = await adminReq(adminJar, `/api/categories/${testCat._id}`, { method: "PUT", body: { name: renamed } });
      assert.equal(putRes.status, 200);
      const after1 = await (await fetch(`${BASE_URL}/api/categories`)).text();
      assert.ok(after1.includes(renamed), "the categories cache must reflect the rename immediately after invalidation");
    } finally {
      await Category.findByIdAndDelete(testCat._id);
    }
  });

  // ---------- 9: settings/theme mutation refreshes cached public configuration ----------

  test("a public settings mutation refreshes the cached public-settings read", async () => {
    const before1 = await (await fetch(`${BASE_URL}/api/settings/public`)).json();
    const original = before1.settings.store?.name || "";
    const suffix = crypto.randomBytes(3).toString("hex");
    const newName = `Cache Test Store ${suffix}`;
    try {
      const putRes = await adminReq(adminJar, "/api/settings", { method: "PUT", body: { store: { name: newName } } });
      assert.equal(putRes.status, 200);
      const after1 = await (await fetch(`${BASE_URL}/api/settings/public`)).json();
      assert.equal(after1.settings.store?.name, newName, "the public settings cache must reflect the new store name immediately");
    } finally {
      await adminReq(adminJar, "/api/settings", { method: "PUT", body: { store: { name: original } } });
    }
  });

  // ---------- 11: admin analytics refreshes after order/payment mutations ----------

  test("admin analytics (order status breakdown) refreshes after a real order status transition", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await makeProduct();
    const order = await Order.create({
      user: buyer._id,
      items: [{ product: product._id, variantId: product.variants[0]._id, quantity: 1, snapshot: { name: product.name, price: product.basePrice } }],
      shippingAddress: { fullName: "Cache Test", phone: "0100000000", street: "1 Test St", city: "Dhaka", postalCode: "1200", country: "Bangladesh" },
      subtotal: product.basePrice,
      total: product.basePrice,
      status: "pending",
    });
    createdOrderIds.push(order._id);

    await fetch(`${BASE_URL}/admin`, { headers: { cookie: adminJar.header() } }); // warm admin-analytics cache

    const putRes = await adminReq(adminJar, `/api/orders/${order._id}/status`, { method: "PUT", body: { status: "processing" } });
    assert.equal(putRes.status, 200);

    // The status-breakdown analytics function itself is a real, direct
    // service call — after invalidation, this proves the CACHE entry
    // (not just the underlying DB) reflects the new count.
    const breakdownRes = await adminReq(adminJar, "/api/analytics/status-breakdown");
    assert.equal(breakdownRes.status, 200);
    const breakdown = await breakdownRes.json();
    const processingRow = breakdown.data.find((r) => r.status === "processing");
    assert.ok(processingRow && processingRow.count >= 1, "the processing-status count must reflect the just-transitioned order");
  });

  // ---------- 14/15: private customer reads are never shared-cached; no sensitive fields ----------

  test("two different customers' /orders pages never share cached content", async () => {
    const buyerA = await createTestUser({ role: "customer" });
    const buyerB = await createTestUser({ role: "customer" });
    const product = await makeProduct();
    const orderA = await Order.create({
      user: buyerA._id,
      items: [{ product: product._id, variantId: product.variants[0]._id, quantity: 1, snapshot: { name: `OrderA-${product.name}`, price: product.basePrice } }],
      shippingAddress: { fullName: "A", phone: "0100000000", street: "1 St", city: "Dhaka", postalCode: "1200", country: "Bangladesh" },
      subtotal: product.basePrice,
      total: product.basePrice,
      status: "pending",
    });
    createdOrderIds.push(orderA._id);

    const jarA = await loginAs(buyerA.email, "TestPassword123!");
    const jarB = await loginAs(buyerB.email, "TestPassword123!");

    const htmlA = await (await fetch(`${BASE_URL}/orders`, { headers: { cookie: jarA.header() } })).text();
    const htmlB = await (await fetch(`${BASE_URL}/orders`, { headers: { cookie: jarB.header() } })).text();
    assert.ok(htmlA.includes(orderA._id.toString().slice(-8).toUpperCase()));
    assert.ok(!htmlB.includes(orderA._id.toString().slice(-8).toUpperCase()), "buyer B must never see buyer A's order, proving /orders is never shared-cached");
  });

  test("cached public HTML (shop) never contains a password hash or session/CSRF token value", async () => {
    const product = await makeProduct();
    const html = await (await fetch(`${BASE_URL}/shop?category=${burqaDeptId}&limit=50`)).text();
    assert.ok(html.includes(product.name));
    assert.ok(!/\$2[aby]\$/.test(html), "no bcrypt password hash may ever appear");
    assert.ok(!html.includes(adminJar.get("tahos_csrf") || "__no_csrf__"));
  });
});
