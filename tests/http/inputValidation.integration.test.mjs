// Phase 5 — REAL HTTP integration tests for the shared validation
// architecture, run through the actual `next start` process the
// tests/http harness (scripts/httpTestServer.mjs) spins up. Representative
// coverage across several route categories, not exhaustive — see the
// Phase 5 report's coverage accounting for the full route-by-route
// breakdown.

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

async function req(jar, path, { method = "GET", body, rawBody, contentType, extraHeaders = {} } = {}) {
  const headers = new Headers(extraHeaders);
  const cookieHeader = jar.header();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (contentType !== undefined) headers.set("content-type", contentType);
  if (method !== "GET") headers.set("origin", BASE_URL);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  jar.absorb(res);
  return res;
}

async function registerNewUser() {
  const jar = new CookieJar();
  const suffix = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const email = `httpvalid_${suffix}@example.invalid`;
  const fakeClientIp = `198.51.100.${crypto.randomInt(1, 255)}`;
  const res = await req(jar, "/api/users/register", {
    method: "POST",
    body: { name: `HTTP Validation Test ${suffix}`, email, password: "RealHttpTest123!" },
    extraHeaders: { "x-forwarded-for": fakeClientIp },
  });
  const json = await res.json();
  return { jar, email, userId: json.user?._id };
}

describe("Phase 5 closure — real HTTP: shared validation architecture", { skip }, () => {
  let User, Order, Product;

  before(async () => {
    ({ default: User } = await import("../../models/userModel.js"));
    ({ default: Order } = await import("../../models/orderModel.js"));
    ({ default: Product } = await import("../../models/productModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  test("real HTTP: malformed JSON body -> 400, not a crash", async () => {
    const { jar, email } = await registerNewUser();
    try {
      const res = await req(jar, "/api/cart", {
        method: "POST",
        rawBody: "{not valid json,,,",
        contentType: "application/json",
        extraHeaders: { "x-csrf-token": jar.get("tahos_csrf") },
      });
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ email });
    }
  });

  test("real HTTP: wrong Content-Type on a JSON-required route -> 415", async () => {
    const { jar, email } = await registerNewUser();
    try {
      const res = await req(jar, "/api/cart", {
        method: "POST",
        rawBody: "productId=1&variantId=2&quantity=1",
        contentType: "application/x-www-form-urlencoded",
        extraHeaders: { "x-csrf-token": jar.get("tahos_csrf") },
      });
      assert.equal(res.status, 415);
    } finally {
      await User.deleteOne({ email });
    }
  });

  test("real HTTP: GET /api/orders?limit=999999 as admin -> 400 (bounded pagination), not an unbounded query", async () => {
    const suffix = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const admin = await User.create({ name: "HTTP Validation Admin", email: `httpvalid-admin-${suffix}@example.invalid`, password: "RealHttpTest123!", role: "admin", isVerified: true });
    const jar = new CookieJar();
    try {
      const loginRes = await req(jar, "/api/users/login", { method: "POST", body: { email: admin.email, password: "RealHttpTest123!" } });
      assert.equal(loginRes.status, 200);
      const res = await req(jar, "/api/orders?limit=999999");
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("real HTTP: a malformed ObjectId path param on the COD route -> 400, not a raw CastError-derived 500", async () => {
    const { jar, email } = await registerNewUser();
    try {
      const res = await req(jar, "/api/payments/cod/not-a-valid-object-id", {
        method: "POST",
        extraHeaders: { "x-csrf-token": jar.get("tahos_csrf") },
      });
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ email });
    }
  });

  test("real HTTP: a Mongo-operator-shaped cart body ($gt) is rejected (400), never reaches the database query", async () => {
    const { jar, email } = await registerNewUser();
    try {
      const res = await req(jar, "/api/cart", {
        method: "POST",
        body: { productId: { $gt: "" }, variantId: "507f1f77bcf86cd799439011", quantity: 1 },
        extraHeaders: { "x-csrf-token": jar.get("tahos_csrf") },
      });
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ email });
    }
  });

  test("real HTTP: existing security headers and CSRF enforcement remain intact on a validated route", async () => {
    const { jar, email } = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const withCsrf = await req(jar, "/api/cart", {
        method: "POST",
        body: { productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 },
        extraHeaders: { "x-csrf-token": jar.get("tahos_csrf") },
      });
      assert.equal(withCsrf.status, 200);
      assert.ok(withCsrf.headers.get("content-security-policy"));

      const noCsrf = await req(jar, "/api/cart", {
        method: "POST",
        body: { productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 },
      });
      assert.equal(noCsrf.status, 403, "CSRF remains mandatory even on a newly-validated route");
    } finally {
      await User.deleteOne({ email });
      await Product.deleteOne({ _id: product._id });
    }
  });

  test("real HTTP (Phase 5B): POST /api/products with a negative basePrice is rejected (400), never reaches Mongoose", async () => {
    const suffix = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const admin = await User.create({ name: "HTTP Validation Admin 2", email: `httpvalid-admin2-${suffix}@example.invalid`, password: "RealHttpTest123!", role: "admin", isVerified: true });
    const jar = new CookieJar();
    try {
      const loginRes = await req(jar, "/api/users/login", { method: "POST", body: { email: admin.email, password: "RealHttpTest123!" } });
      assert.equal(loginRes.status, 200);
      const res = await req(jar, "/api/products", {
        method: "POST",
        body: { name: "x", description: "x", category: "507f1f77bcf86cd799439011", basePrice: -1, images: ["https://example.test/a.jpg"], variants: [{ variantName: "x", sku: "x", stock: 1 }] },
        extraHeaders: { "x-csrf-token": jar.get("tahos_csrf") },
      });
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("real HTTP (Phase 5B): PUT /api/orders/[id]/status rejects a forbidden regression (409) and a malformed status (400)", async () => {
    const suffix = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const admin = await User.create({ name: "HTTP Validation Admin 3", email: `httpvalid-admin3-${suffix}@example.invalid`, password: "RealHttpTest123!", role: "admin", isVerified: true });
    const { jar: buyerJar, email: buyerEmail } = await registerNewUser();
    const adminJar = new CookieJar();
    const product = await createTestProduct({ stock: 5 });
    try {
      const loginRes = await req(adminJar, "/api/users/login", { method: "POST", body: { email: admin.email, password: "RealHttpTest123!" } });
      assert.equal(loginRes.status, 200);

      const orderRes = await req(buyerJar, "/api/orders", {
        method: "POST",
        body: { items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }], shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" } },
        extraHeaders: { "idempotency-key": crypto.randomBytes(16).toString("hex"), "x-csrf-token": buyerJar.get("tahos_csrf") },
      });
      assert.equal(orderRes.status, 201);
      const { order } = await orderRes.json();

      const malformed = await req(adminJar, `/api/orders/${order._id}/status`, { method: "PUT", body: { status: "not-a-real-status" }, extraHeaders: { "x-csrf-token": adminJar.get("tahos_csrf") } });
      assert.equal(malformed.status, 400);

      const toCancelled = await req(adminJar, `/api/orders/${order._id}/status`, { method: "PUT", body: { status: "cancelled" }, extraHeaders: { "x-csrf-token": adminJar.get("tahos_csrf") } });
      assert.equal(toCancelled.status, 200);

      const regression = await req(adminJar, `/api/orders/${order._id}/status`, { method: "PUT", body: { status: "processing" }, extraHeaders: { "x-csrf-token": adminJar.get("tahos_csrf") } });
      assert.equal(regression.status, 409, "a cancelled order must never be moved to another status");
    } finally {
      const buyer = await User.findOne({ email: buyerEmail });
      if (buyer) await Order.deleteMany({ user: buyer._id });
      await User.deleteOne({ _id: admin._id });
      await User.deleteOne({ email: buyerEmail });
      await Product.deleteOne({ _id: product._id });
    }
  });
});
