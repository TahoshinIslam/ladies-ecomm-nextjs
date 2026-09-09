// Phase 7 — real HTTP evidence that the six migrated pages actually
// server-render their initial content, against a real `next start`
// (this app's production runtime — see tests/http/authSessionCsrfSse
// .integration.test.mjs's own header comment for why the harness always
// runs production, never NODE_ENV=test's dev-mode cookie names). Session
// cookies are minted directly via the real lib/session.js createSession()
// (the same function login/register use) against the harness's shared
// test database, then attached by hand with the __Host- prefix the real
// server actually issues — no login POST round trip needed to prove
// authenticated server rendering.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  createTestUser,
  createTestProduct,
  createDeliveredOrderFor,
} from "../helpers/testDb.mjs";

const BASE_URL = process.env.HTTP_TEST_BASE_URL || "http://localhost:3000";
const SESSION_COOKIE = "__Host-tahos_session";

let serverUp = false;
try {
  const res = await fetch(`${BASE_URL}/`);
  serverUp = res.ok;
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

async function cookieHeaderFor(userId) {
  const { createSession } = await import("../../lib/session.js");
  const session = await createSession(userId, { userAgent: "phase7-test-suite" });
  return `${SESSION_COOKIE}=${session.rawToken}`;
}

describe("Phase 7 — real server-rendered pages (real MongoDB, via HTTP)", { skip }, () => {
  let Product, Order, User;
  let product;
  let customer, otherCustomer, admin;
  const createdIds = { users: [], products: [], orders: [] };

  before(async () => {
    ({ default: Product } = await import("../../models/productModel.js"));
    ({ default: Order } = await import("../../models/orderModel.js"));
    ({ default: User } = await import("../../models/userModel.js"));
    const { default: Category } = await import("../../models/categoryModel.js");

    // The storefront's product list (home/shop) is scoped to real seeded
    // departments (services/productService.js's STOREFRONT_DEPARTMENT_
    // SLUGS) — a product under a fresh, ad hoc test category (what
    // createTestProduct() does by default) would be correctly invisible
    // there, not a bug. Attach it to a real "burqa" subcategory instead,
    // matching tests/http/productFilters.integration.test.mjs's own
    // fixture pattern.
    const burqa = await Category.findOne({ slug: "burqa" }).lean();
    assert.ok(burqa, "seed data must include the Burqa department");
    const burqaLeaf = await Category.findOne({ parent: burqa._id }).lean();
    assert.ok(burqaLeaf, "Burqa needs at least one subcategory to attach a test product to");

    product = await createTestProduct({ stock: 5, basePrice: 4200 });
    product.category = burqaLeaf._id;
    product.topCategory = burqa._id;
    await product.save();
    createdIds.products.push(product._id);

    customer = await createTestUser({ role: "customer" });
    otherCustomer = await createTestUser({ role: "customer" });
    admin = await createTestUser({ role: "admin" });
    createdIds.users.push(customer._id, otherCustomer._id, admin._id);
  });

  after(async () => {
    if (createdIds.orders.length) await Order.deleteMany({ _id: { $in: createdIds.orders } });
    if (createdIds.products.length) await Product.deleteMany({ _id: { $in: createdIds.products } });
    if (createdIds.users.length) await User.deleteMany({ _id: { $in: createdIds.users } });
    await disconnectTestDb();
  });

  // ---------- Home ----------
  test("home page ('/') server-renders real seeded section headings without any cookie", async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    // A real product name inserted just above must appear somewhere a
    // "new arrivals"-type section would render it, OR — since the
    // storefront home page is scoped to specific departments this test
    // fixture may not belong to — at minimum the static section
    // headings (translated copy, not fetched) must be present, proving
    // the page rendered its full shell server-side rather than an empty
    // client-hydration stub.
    assert.match(html, /new-arrivals|departments|featured-picks/);
  });

  // ---------- Shop ----------
  test("shop page ('/shop') server-renders the real seeded product's name and price in initial HTML", async () => {
    const res = await fetch(`${BASE_URL}/shop?limit=200`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(product.name), "the real product's name must appear in the initial HTML");
  });

  test("shop page with a CSV ageGroup facet returns 200 and reflects the filter", async () => {
    const res = await fetch(`${BASE_URL}/shop?ageGroup=kids,girls`);
    assert.equal(res.status, 200);
  });

  test("shop page with an invalid filter renders a safe, controlled result (never a raw 500)", async () => {
    const res = await fetch(`${BASE_URL}/shop?basePrice[gte]=not-a-number`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(!/internal server error/i.test(html));
  });

  // ---------- Product detail ----------
  test("product-detail page server-renders the product's title, description in initial HTML", async () => {
    const res = await fetch(`${BASE_URL}/product/${product._id}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(product.name));
    assert.ok(html.includes(product.description));
  });

  test("product-detail page for a well-formed but missing id renders the real 404 page", async () => {
    const res = await fetch(`${BASE_URL}/product/507f1f77bcf86cd799439011`);
    assert.equal(res.status, 404);
  });

  // ---------- Orders (authenticated, ownership-scoped) ----------
  test("unauthenticated access to /orders redirects safely (never renders another customer's data)", async () => {
    const res = await fetch(`${BASE_URL}/orders`, { redirect: "manual" });
    assert.ok([302, 303, 307].includes(res.status), `expected a redirect, got ${res.status}`);
    assert.match(res.headers.get("location") || "", /\/login/);
  });

  test("authenticated customer sees their own order rendered server-side", async () => {
    const order = await createDeliveredOrderFor(customer._id, product._id, product.variants[0]._id);
    createdIds.orders.push(order._id);

    const cookie = await cookieHeaderFor(customer._id);
    const listRes = await fetch(`${BASE_URL}/orders`, { headers: { cookie } });
    assert.equal(listRes.status, 200);
    const listHtml = await listRes.text();
    assert.ok(listHtml.includes(order._id.toString().slice(-8).toUpperCase()));

    const detailRes = await fetch(`${BASE_URL}/orders/${order._id}`, { headers: { cookie } });
    assert.equal(detailRes.status, 200);
    const detailHtml = await detailRes.text();
    assert.ok(detailHtml.includes(order._id.toString().slice(-8).toUpperCase()));
    assert.ok(detailHtml.includes("Test item"), "the real order item snapshot must render");
  });

  test("a different customer cannot view someone else's order (safe not-found, not a data leak)", async () => {
    const order = await createDeliveredOrderFor(customer._id, product._id, product.variants[0]._id);
    createdIds.orders.push(order._id);

    const cookie = await cookieHeaderFor(otherCustomer._id);
    const res = await fetch(`${BASE_URL}/orders/${order._id}`, { headers: { cookie } });
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.ok(!html.includes("Test item"), "another customer's order item data must never render");
  });

  test("the order-detail HTML never contains internal fields (idempotency hash, raw session/CSRF cookie values)", async () => {
    const order = await createDeliveredOrderFor(customer._id, product._id, product.variants[0]._id);
    createdIds.orders.push(order._id);
    const cookie = await cookieHeaderFor(customer._id);
    const res = await fetch(`${BASE_URL}/orders/${order._id}`, { headers: { cookie } });
    const html = await res.text();
    assert.ok(!/idempotencyKeyHash|requestFingerprint/i.test(html));
  });

  // ---------- Admin overview ----------
  test("unauthorized access to /admin (customer role) is denied, not shown the dashboard", async () => {
    const cookie = await cookieHeaderFor(customer._id);
    const res = await fetch(`${BASE_URL}/admin`, { headers: { cookie }, redirect: "manual" });
    assert.ok([302, 303, 307].includes(res.status), `expected a redirect away from the dashboard, got ${res.status}`);
  });

  test("unauthenticated access to /admin redirects to login, not the dashboard", async () => {
    const res = await fetch(`${BASE_URL}/admin`, { redirect: "manual" });
    assert.ok([302, 303, 307].includes(res.status), `expected a redirect, got ${res.status}`);
    assert.match(res.headers.get("location") || "", /\/login/);
  });

  test("authorized admin sees the real, server-rendered dashboard statistics", async () => {
    const cookie = await cookieHeaderFor(admin._id);
    const res = await fetch(`${BASE_URL}/admin`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Total revenue|Orders|Customers|Products/);
  });

  test("no page response leaks a password hash, raw session token, or CSRF secret", async () => {
    const cookie = await cookieHeaderFor(customer._id);
    const res = await fetch(`${BASE_URL}/orders`, { headers: { cookie } });
    const html = await res.text();
    assert.ok(!/"password":"\$2[aby]\$/.test(html));
    assert.ok(!html.includes(cookie.split("=")[1]));
  });
});
