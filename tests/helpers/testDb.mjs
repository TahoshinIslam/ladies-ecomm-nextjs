// Shared fixtures for the Phase 1 regression-safety-net tests
// (reviewOwnership, orderDuplicateRegression, adminOrderLimit).
//
// Design constraints (see the Phase 1 CI-environment requirements):
//   - Never touches MONGO_URI. Only ever connects via MONGO_URI_TEST, and
//     only when NODE_ENV=test (config/db.js's own branching — see
//     config/db.js:24). scripts/assertTestDbSafety.mjs enforces this before
//     any test file even runs.
//   - If MONGO_URI_TEST isn't configured, every consumer of `dbReady` skips
//     itself instead of failing or silently falling back to MONGO_URI —
//     the same pattern tests/relatedProducts.integration.test.mjs already
//     uses for "dev server not reachable".
//   - Route Handlers are called directly as functions (real `Request`
//     objects, no HTTP round-trip, no running Next.js server required) —
//     this repo's Route Handlers only ever read `request.headers`/
//     `request.json()`/`request.url` (see lib/auth.js's getSessionUser),
//     never next/headers' request-scoped cookies()/headers(), so this is
//     safe outside of a real Next.js request lifecycle.

import crypto from "node:crypto";
import mongoose from "mongoose";

export const dbReady = process.env.NODE_ENV === "test" && !!process.env.MONGO_URI_TEST;
export const skipReason = dbReady
  ? undefined
  : "MONGO_URI_TEST not configured — set NODE_ENV=test and MONGO_URI_TEST (see .env.test.example) to run this suite against a real database";

let connectPromise;
export async function connectTestDb() {
  if (!dbReady) throw new Error(skipReason);
  if (!connectPromise) {
    const { default: connectDB } = await import("../../config/db.js");
    connectPromise = connectDB().then((conn) => {
      // Second, independent guard beyond scripts/assertTestDbSafety.mjs's
      // pretest check — every test file's cleanup (deleteMany/deleteOne)
      // runs against whatever this connects to, so refuse to proceed if the
      // live database name doesn't clearly read as test-only, even if
      // something upstream let a bad MONGO_URI_TEST through.
      const dbName = conn.connection?.db?.databaseName || conn.connections?.[0]?.name;
      if (!dbName || !/test/i.test(dbName)) {
        throw new Error(
          `Refusing to run test fixtures/cleanup against database "${dbName}" — its name doesn't contain "test".`,
        );
      }
      return conn;
    });
  }
  return connectPromise;
}

// Every DB-backed test file's outer `after()` must call this. Without it,
// the open MongoDB socket keeps this file's test-runner process alive
// after all assertions have already finished — Node's test runner then
// waits on the process itself, not just the test callbacks, which (with
// `tests/**/*.test.mjs` running many files back-to-back) silently stalls
// every subsequent file until each one individually hits the runner's
// timeout. Same reasoning tests/relatedProducts.integration.test.mjs's
// `after()` already documents for its own `Product.db.close()` call.
export async function disconnectTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  connectPromise = undefined;
}

// Phase 2: creates a REAL session via lib/session.js — the same function
// login/register use — against the test database, and returns the raw
// {rawToken, rawCsrfToken} pair a real client would receive via Set-Cookie.
// Deliberately not a shortcut/mock: this exercises the actual hashing,
// expiry, and storage logic every real session goes through, not a
// reimplementation of it.
export async function createTestSession(userId) {
  const { createSession } = await import("../../lib/session.js");
  return createSession(userId, { userAgent: "phase2-test-suite" });
}

// Builds the `Cookie` header a browser would send for a given session —
// shared by requestAs() below and any test file that needs to construct a
// Request by hand (e.g. tests/uploads.test.mjs's multipart/form-data
// requests, which can't go through requestAs()'s JSON-body shape).
export function sessionCookieHeader(session) {
  if (!session) return null;
  return `tahos_session=${session.rawToken}; tahos_csrf=${session.rawCsrfToken}`;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * `session` is the {rawToken, rawCsrfToken} object from createTestSession()
 * (or undefined/null for an unauthenticated request). For unsafe methods,
 * the X-CSRF-Token header is attached automatically from the session's own
 * CSRF value, matching what store/apiSlice.js's real client code does —
 * pass `omitCsrfHeader: true` to deliberately test the CSRF-rejection path
 * instead. `originOverride` lets a test simulate a cross-origin request by
 * setting a different Origin header than the request's own URL.
 */
export function requestAs({
  method = "GET",
  url,
  session,
  body,
  omitCsrfHeader = false,
  originOverride,
  signal,
  idempotencyKey,
} = {}) {
  const headers = new Headers();
  const cookie = sessionCookieHeader(session);
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (session && UNSAFE_METHODS.has(method) && !omitCsrfHeader) {
    headers.set("x-csrf-token", session.rawCsrfToken);
  }
  // Phase 4: POST /api/orders requires an Idempotency-Key header. Tests that
  // don't care about idempotency (the vast majority) get a fresh random one
  // per call for free, so each call still creates its own independent
  // order exactly like before this header existed. A test that DOES care
  // (replay/dedup/conflict scenarios) passes `idempotencyKey` explicitly —
  // the same string across calls to exercise replay, or `idempotencyKey:
  // null` to deliberately test the missing-header (400) path.
  if (method === "POST" && new URL(url).pathname === "/api/orders") {
    if (idempotencyKey !== null) {
      headers.set("idempotency-key", idempotencyKey || crypto.randomBytes(16).toString("hex"));
    }
  } else if (idempotencyKey) {
    headers.set("idempotency-key", idempotencyKey);
  }
  // lib/csrf.js's Origin-validation Layer 1 needs an Origin (or
  // Sec-Fetch-Site) header on unsafe requests to pass — a real browser
  // always sends one for a same-origin fetch/XHR. Defaults to matching the
  // request's own URL (same-origin), which is what canonicalOrigin()'s
  // no-APP_ORIGIN-configured fallback also expects in this test
  // environment (see lib/csrf.js).
  if (UNSAFE_METHODS.has(method)) {
    headers.set("origin", originOverride ?? new URL(url).origin);
  }
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
}

const unique = () => crypto.randomBytes(6).toString("hex");

export async function createTestUser({ role = "customer", permissions = [] } = {}) {
  const { default: User } = await import("../../models/userModel.js");
  const suffix = unique();
  const user = await User.create({
    name: `Test User ${suffix}`,
    email: `test-${suffix}@example.invalid`,
    password: "TestPassword123!",
    role,
    permissions,
    isVerified: true,
  });
  return user;
}

export async function createTestCategory() {
  const { default: Category } = await import("../../models/categoryModel.js");
  const suffix = unique();
  return Category.create({ name: `Test Category ${suffix}`, slug: `test-category-${suffix}` });
}

export async function createTestProduct({ stock = 10, basePrice = 1000 } = {}) {
  const { default: Product } = await import("../../models/productModel.js");
  const category = await createTestCategory();
  const suffix = unique();
  return Product.create({
    name: `Test Product ${suffix}`,
    description: "Created by the Phase 1 test suite — safe to delete.",
    category: category._id,
    basePrice,
    images: ["https://placehold.co/400x400?text=test"],
    variants: [{ variantName: "Default", sku: `TEST-${suffix}`, stock }],
  });
}

export async function createDeliveredOrderFor(userId, productId, variantId) {
  const { default: Order } = await import("../../models/orderModel.js");
  return Order.create({
    user: userId,
    items: [
      {
        product: productId,
        variantId,
        quantity: 1,
        snapshot: { name: "Test item", price: 1000 },
      },
    ],
    shippingAddress: {
      fullName: "Test Buyer",
      phone: "0100000000",
      street: "1 Test Street",
      city: "Dhaka",
      postalCode: "1200",
      country: "Bangladesh",
    },
    subtotal: 1000,
    total: 1000,
    status: "delivered",
  });
}

const createdModelDocs = [];
export function trackForCleanup(doc, Model) {
  createdModelDocs.push({ doc, Model });
  return doc;
}

export async function cleanupTracked() {
  for (const { doc, Model } of createdModelDocs.splice(0)) {
    await Model.deleteOne({ _id: doc._id }).catch(() => {});
  }
}
