// Phase 4/4B — REAL HTTP integration tests for order-request and COD
// idempotency, run through the actual `next start` process the tests/http
// harness (scripts/httpTestServer.mjs) spins up. Every request here goes
// over real Node fetch() to a real listening HTTP server with real cookie
// authentication, real CSRF, and the real Idempotency-Key header — not a
// direct Route Handler call. See
// tests/http/authSessionCsrfSse.integration.test.mjs for why this class of
// test exists in addition to tests/orderDuplicateRegression.test.mjs and
// tests/codPayment.test.mjs (which call Route Handlers directly and prove
// the LOGIC, not the real HTTP layer).
//
// Each test below is deliberately named/numbered to match one line of the
// Phase 4B closure's real-HTTP requirement matrix 1:1 — see that report's
// section 9 for the full mapping (a few genuinely inseparable pairs, e.g.
// "200 status" + "Idempotency-Replayed header", stay in one test; nothing
// bundles unrelated requirements together for convenience).
//
// Requirement 17 ("existing rate limiting remains operational") is NOT
// re-tested in this file — POST /api/orders and POST /api/payments/cod
// never had rate limiting applied in the first place (confirmed in the
// Phase 4 research pass), so there is nothing Phase 4 could have disturbed
// there. The routes that DO carry rate limiting (login/register/etc.) are
// exhaustively covered by tests/rateLimit.test.mjs and
// tests/http/clientIpTrust.integration.test.mjs, both untouched by this
// phase and still green in the same test:core/test:http runs this file is
// part of — that is requirement 17's evidence.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestProduct } from "../helpers/testDb.mjs";

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
  constructor() {
    this.cookies = new Map();
  }
  absorb(response) {
    const lines = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const raw of lines) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  get(name) {
    return this.cookies.get(name);
  }
}

async function req(jar, path, { method = "GET", body, extraHeaders = {} } = {}) {
  const headers = new Headers(extraHeaders);
  const cookieHeader = jar.header();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (method !== "GET") headers.set("origin", BASE_URL);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  jar.absorb(res);
  return res;
}

async function registerNewUser() {
  const jar = new CookieJar();
  const suffix = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const email = `httpidem_${suffix}@example.invalid`;
  const fakeClientIp = `198.51.100.${crypto.randomInt(1, 255)}`;
  const res = await req(jar, "/api/users/register", {
    method: "POST",
    body: { name: `HTTP Idempotency Test ${suffix}`, email, password: "RealHttpTest123!" },
    extraHeaders: { "x-forwarded-for": fakeClientIp },
  });
  const json = await res.json();
  return { jar, email, userId: json.user._id };
}

function freshKey() {
  return crypto.randomBytes(16).toString("hex");
}

function orderBody(product, overrides = {}) {
  return {
    items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
    shippingAddress: { fullName: "HTTP Test Buyer", phone: "0100000000", street: "1 Test St", city: "Dhaka", postalCode: "1200", country: "Bangladesh" },
    ...overrides,
  };
}

async function createOrderReq(jar, product, { idempotencyKey, body, omitKey = false } = {}) {
  const headers = {};
  if (!omitKey) headers["idempotency-key"] = idempotencyKey || freshKey();
  return req(jar, "/api/orders", {
    method: "POST",
    body: body || orderBody(product),
    extraHeaders: { "x-csrf-token": jar.get("tahos_csrf"), ...headers },
  });
}

describe("Phase 4B closure — real HTTP: order-request and COD idempotency requirement matrix", { skip }, () => {
  let User, Order, Payment, Product;

  before(async () => {
    ({ default: User } = await import("../../models/userModel.js"));
    ({ default: Order } = await import("../../models/orderModel.js"));
    ({ default: Payment } = await import("../../models/paymentModel.js"));
    ({ default: Product } = await import("../../models/productModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  // ---- 1: missing Idempotency-Key -> 400 ----
  test("1. real HTTP: missing Idempotency-Key -> 400", async () => {
    const { jar, email } = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const res = await createOrderReq(jar, product, { omitKey: true });
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ email });
      await Product.deleteOne({ _id: product._id });
    }
  });

  // ---- 2: malformed Idempotency-Key -> 400 ----
  test("2. real HTTP: malformed Idempotency-Key -> 400", async () => {
    const { jar, email } = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const res = await createOrderReq(jar, product, { idempotencyKey: "too short" });
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ email });
      await Product.deleteOne({ _id: product._id });
    }
  });

  // ---- 3: first valid request succeeds ----
  test("3. real HTTP: first valid request succeeds (201)", async () => {
    const { jar, email } = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const res = await createOrderReq(jar, product, { idempotencyKey: freshKey() });
      assert.equal(res.status, 201);
    } finally {
      const user = await User.findOne({ email });
      if (user) await Order.deleteMany({ user: user._id });
      await User.deleteOne({ email });
      await Product.deleteOne({ _id: product._id });
    }
  });

  // ---- 4/5/7/11: same-key replay -> same Order ID, 200 + Idempotency-Replayed:true, stock once, no internal fields ----
  test("4/5/7/11. real HTTP: a same-key replay returns the same Order ID with 200 + Idempotency-Replayed:true, stock decremented only once, no internal fields leak", async () => {
    const { jar, email } = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const key = freshKey();
      const body = orderBody(product);

      const res1 = await createOrderReq(jar, product, { idempotencyKey: key, body });
      assert.equal(res1.status, 201);
      const json1 = await res1.json();
      assert.ok(!("idempotencyKeyHash" in json1.order));
      assert.ok(!("idempotencyRequestHash" in json1.order));

      const res2 = await createOrderReq(jar, product, { idempotencyKey: key, body });
      assert.equal(res2.status, 200, "requirement 5: a same-key replay over real HTTP returns 200, not 201");
      assert.equal(res2.headers.get("idempotency-replayed"), "true", "requirement 5: Idempotency-Replayed:true");
      const json2 = await res2.json();
      assert.equal(String(json2.order._id), String(json1.order._id), "requirement 4: same Order ID");
      assert.ok(!("idempotencyKeyHash" in json2.order) && !("idempotencyRequestHash" in json2.order), "requirement 11: no internal fields in the replay either");

      const p = await Product.findById(product._id);
      assert.equal(p.variants[0].stock, 4, "requirement 7: stock decremented exactly once across the real request + its replay");
    } finally {
      const registeredUser = await User.findOne({ email });
      if (registeredUser) await Order.deleteMany({ user: registeredUser._id });
      await User.deleteOne({ email });
      await Product.deleteOne({ _id: product._id });
    }
  });

  // ---- 6: concurrent same-key requests create one Order ----
  test("6. real HTTP: concurrent same-key requests create exactly one Order", async () => {
    const { jar, email } = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const key = freshKey();
      const body = orderBody(product);
      const [res1, res2] = await Promise.all([
        createOrderReq(jar, product, { idempotencyKey: key, body }),
        createOrderReq(jar, product, { idempotencyKey: key, body }),
      ]);
      assert.ok([res1.status, res2.status].every((s) => s === 200 || s === 201));
      const [json1, json2] = await Promise.all([res1.json(), res2.json()]);
      assert.equal(String(json1.order._id), String(json2.order._id));

      const user = await User.findOne({ email });
      assert.equal(await Order.countDocuments({ user: user._id }), 1);
    } finally {
      const user = await User.findOne({ email });
      if (user) await Order.deleteMany({ user: user._id });
      await User.deleteOne({ email });
      await Product.deleteOne({ _id: product._id });
    }
  });

  // ---- 8: same key with changed payload -> 422 ----
  test("8. real HTTP: the same key with a changed body -> 422", async () => {
    const { jar, email } = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const key = freshKey();
      const res1 = await createOrderReq(jar, product, { idempotencyKey: key, body: orderBody(product) });
      assert.equal(res1.status, 201);

      const res2 = await createOrderReq(jar, product, {
        idempotencyKey: key,
        body: orderBody(product, { notes: "a materially different note changing the fingerprint" }),
      });
      assert.equal(res2.status, 422);
    } finally {
      const user = await User.findOne({ email });
      if (user) await Order.deleteMany({ user: user._id });
      await User.deleteOne({ email });
      await Product.deleteOne({ _id: product._id });
    }
  });

  // ---- 9: different key creates a distinct Order ----
  test("9. real HTTP: a different key creates a distinct, legitimate Order", async () => {
    const { jar, email } = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const res1 = await createOrderReq(jar, product, { idempotencyKey: freshKey() });
      const res2 = await createOrderReq(jar, product, { idempotencyKey: freshKey() });
      assert.equal(res1.status, 201);
      assert.equal(res2.status, 201);
      const [json1, json2] = await Promise.all([res1.json(), res2.json()]);
      assert.notEqual(json1.order._id, json2.order._id);
    } finally {
      const user = await User.findOne({ email });
      if (user) await Order.deleteMany({ user: user._id });
      await User.deleteOne({ email });
      await Product.deleteOne({ _id: product._id });
    }
  });

  // ---- 10: same key for two users is independently scoped ----
  test("10. real HTTP: the same raw key value used by two different real accounts creates two independent orders", async () => {
    const buyerA = await registerNewUser();
    const buyerB = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const sharedKey = freshKey();
      const resA = await createOrderReq(buyerA.jar, product, { idempotencyKey: sharedKey });
      const resB = await createOrderReq(buyerB.jar, product, { idempotencyKey: sharedKey });
      assert.equal(resA.status, 201);
      assert.equal(resB.status, 201, "a different real account reusing the same raw key gets an independent order, not a 422/replay");
      const [jsonA, jsonB] = await Promise.all([resA.json(), resB.json()]);
      assert.notEqual(jsonA.order._id, jsonB.order._id);
    } finally {
      for (const { email } of [buyerA, buyerB]) {
        const user = await User.findOne({ email });
        if (user) await Order.deleteMany({ user: user._id });
        await User.deleteOne({ email });
      }
      await Product.deleteOne({ _id: product._id });
    }
  });

  // ---- 12/13: CSRF still required, security headers still present ----
  test("12/13. real HTTP: CSRF remains mandatory for order creation, and existing security headers remain present", async () => {
    const { jar, email } = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const withCsrf = await createOrderReq(jar, product, { idempotencyKey: freshKey() });
      assert.equal(withCsrf.status, 201);
      assert.ok(withCsrf.headers.get("content-security-policy"), "requirement 13: existing security headers remain present");

      const noCsrf = await req(jar, "/api/orders", {
        method: "POST",
        body: orderBody(product),
        extraHeaders: { "idempotency-key": freshKey() },
      });
      assert.equal(noCsrf.status, 403, "requirement 12: CSRF remains mandatory for order creation");
    } finally {
      const user = await User.findOne({ email });
      if (user) await Order.deleteMany({ user: user._id });
      await User.deleteOne({ email });
      await Product.deleteOne({ _id: product._id });
    }
  });

  // ---- 14: COD duplicate returns the same Payment ----
  test("14. real HTTP: a duplicate COD request returns the same Payment, not a second row", async () => {
    const { jar, email } = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const orderRes = await createOrderReq(jar, product, { idempotencyKey: freshKey() });
      assert.equal(orderRes.status, 201);
      const { order } = await orderRes.json();

      const codReq = () => req(jar, `/api/payments/cod/${order._id}`, { method: "POST", extraHeaders: { "x-csrf-token": jar.get("tahos_csrf") } });

      const cod1 = await codReq();
      assert.equal(cod1.status, 200);
      const cod1Json = await cod1.json();
      assert.equal(cod1Json.order.status, "processing");

      const cod2 = await codReq();
      assert.equal(cod2.status, 200);
      const cod2Json = await cod2.json();
      assert.equal(String(cod2Json.order._id), String(cod1Json.order._id));

      const payments = await Payment.find({ order: order._id });
      assert.equal(payments.length, 1, "exactly one Payment row over real HTTP duplicate COD requests");
    } finally {
      const user = await User.findOne({ email });
      if (user) {
        await Order.deleteMany({ user: user._id });
        await Payment.deleteMany({ user: user._id });
      }
      await User.deleteOne({ email });
      await Product.deleteOne({ _id: product._id });
    }
  });

  // ---- 15: COD concurrent requests leave one Payment ----
  test("15. real HTTP: concurrent duplicate COD requests for the same order leave exactly one Payment, no duplicate-key 500", async () => {
    const { jar, email } = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const orderRes = await createOrderReq(jar, product, { idempotencyKey: freshKey() });
      const { order } = await orderRes.json();

      const codReq = () => req(jar, `/api/payments/cod/${order._id}`, { method: "POST", extraHeaders: { "x-csrf-token": jar.get("tahos_csrf") } });
      const [c1, c2] = await Promise.all([codReq(), codReq()]);
      assert.ok([c1.status, c2.status].every((s) => s === 200), "no raw duplicate-key 500 over real HTTP concurrency");

      const payments = await Payment.find({ order: order._id });
      assert.equal(payments.length, 1);
    } finally {
      const user = await User.findOne({ email });
      if (user) {
        await Order.deleteMany({ user: user._id });
        await Payment.deleteMany({ user: user._id });
      }
      await User.deleteOne({ email });
      await Product.deleteOne({ _id: product._id });
    }
  });

  // ---- 16: delivered/shipped status never regresses ----
  test("16. real HTTP: delivered and shipped orders never regress to processing on a COD retry", async () => {
    const { jar, email } = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const orderRes = await createOrderReq(jar, product, { idempotencyKey: freshKey() });
      const { order } = await orderRes.json();
      const codReq = () => req(jar, `/api/payments/cod/${order._id}`, { method: "POST", extraHeaders: { "x-csrf-token": jar.get("tahos_csrf") } });
      await codReq();

      await Order.updateOne({ _id: order._id }, { $set: { status: "shipped" } });
      const shippedRetry = await codReq();
      assert.equal(shippedRetry.status, 200);
      assert.equal((await shippedRetry.json()).order.status, "shipped", "shipped must never regress to processing");

      await Order.updateOne({ _id: order._id }, { $set: { status: "delivered", deliveredAt: new Date() } });
      const deliveredRetry = await codReq();
      assert.equal(deliveredRetry.status, 200);
      assert.equal((await deliveredRetry.json()).order.status, "delivered", "delivered must never regress to processing");
    } finally {
      const user = await User.findOne({ email });
      if (user) {
        await Order.deleteMany({ user: user._id });
        await Payment.deleteMany({ user: user._id });
      }
      await User.deleteOne({ email });
      await Product.deleteOne({ _id: product._id });
    }
  });
});
