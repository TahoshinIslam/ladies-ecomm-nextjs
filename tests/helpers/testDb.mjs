// Shared fixtures for the DB-backed regression-safety-net tests.
//
// Design constraints (carried over from the original MongoDB-era version
// of this file, adapted for the MySQL migration):
//   - Never touches the app's own DB_NAME. Only ever connects using
//     whatever DB_* vars are in effect when NODE_ENV=test (config/db.js's
//     own pool) — scripts/assertTestDbSafety.mjs enforces this before any
//     test file even runs.
//   - If DB_NAME isn't configured (or doesn't look test-only), every
//     consumer of `dbReady` skips itself instead of failing or silently
//     running against the wrong database.
//   - Route Handlers are called directly as functions (real `Request`
//     objects, no HTTP round-trip, no running Next.js server required) —
//     this repo's Route Handlers only ever read `request.headers`/
//     `request.json()`/`request.url` (see lib/auth.js's getSessionUser),
//     never next/headers' request-scoped cookies()/headers(), so this is
//     safe outside of a real Next.js request lifecycle.

import crypto from "node:crypto";

// Fixtures belong to the organization scripts/setupTestDb.mjs created, which
// is also what STORE_ORGANIZATION_ID names in .env.test. Read from the
// environment rather than hard-coded so the two cannot drift apart: the app
// code under test resolves the same value through lib/tenant.js.
export const testOrganizationId = () => process.env.STORE_ORGANIZATION_ID;

const TEST_DB_NAME_PATTERN = /(_test|_ci)$/i;

export const dbReady =
  process.env.NODE_ENV === "test" && !!process.env.DB_NAME && TEST_DB_NAME_PATTERN.test(process.env.DB_NAME);
export const skipReason = dbReady
  ? undefined
  : "DB_NAME not configured as a test database — set NODE_ENV=test and a DB_NAME ending in \"_test\" (see .env.test.example) to run this suite against a real database";

let connectPromise;
export async function connectTestDb() {
  if (!dbReady) throw new Error(skipReason);
  if (!connectPromise) {
    const { default: connectDB } = await import("../../config/db.js");
    // Second, independent guard beyond scripts/assertTestDbSafety.mjs's
    // pretest check — every test file's cleanup (TRUNCATE/DELETE) runs
    // against whatever this connects to, so refuse to proceed if the
    // configured database name doesn't clearly read as test-only, even if
    // something upstream let a bad DB_NAME through. Checked again here
    // (not just in dbReady above) so a test that imports this file without
    // checking dbReady first still fails closed rather than silently
    // running.
    if (!TEST_DB_NAME_PATTERN.test(process.env.DB_NAME || "")) {
      throw new Error(
        `Refusing to run test fixtures/cleanup against database "${process.env.DB_NAME}" — its name doesn't end in "_test" or "_ci".`,
      );
    }
    connectPromise = connectDB();
  }
  return connectPromise;
}

// Every DB-backed test file's outer `after()` must call this. Without it,
// the open MySQL pool keeps this file's test-runner process alive after
// all assertions have already finished — Node's test runner then waits on
// the process itself, not just the test callbacks, which (with
// `tests/**/*.test.mjs` running many files back-to-back) silently stalls
// every subsequent file until each one individually hits the runner's
// timeout.
export async function disconnectTestDb() {
  const { closePool } = await import("../../config/db.js");
  await closePool();
  connectPromise = undefined;
}

// Generic row-delete helper for test cleanup — replaces the old
// `Model.deleteOne({_id})`/`Model.deleteMany({field: {$in: [...]}})` calls
// scattered across every test file's `finally` block. The new SQL models
// deliberately don't expose a generic Mongo-filter-shaped delete (see
// models/README-migration.md: each model only implements what its real
// service call sites need) — test cleanup goes straight through SQL
// instead of growing every model's public API with test-only methods.
// `column` + `values` (an id or array of ids) covers every cleanup shape
// these test files actually use (`delete this one row` / `delete all rows
// whose column is IN this set`).
export async function deleteRows(table, column, values) {
  const list = Array.isArray(values) ? values : [values];
  if (!list.length) return;
  const { query } = await import("../../config/db.js");
  await query(`DELETE FROM ${table} WHERE ${column} IN (${list.map(() => "?").join(",")})`, list);
}

// Raw SQL escape hatch for test files that need to assert on something no
// model function exposes (an index's existence, a column's raw value,
// etc.) — re-exported here so test files don't each need their own
// `config/db.js` import path.
export async function rawQuery(sql, params) {
  const { query } = await import("../../config/db.js");
  return query(sql, params);
}

// Truncates every table this test suite writes to, in an order that
// respects the schema's ON DELETE CASCADE relationships — a parent
// truncated first would otherwise leave FK errors on the child tables that
// still reference rows about to vanish. Called by individual test files'
// own before()/after() blocks (not automatically) so each file controls
// exactly when its data resets; dbReady/connectTestDb() already refuse to
// run this against anything that isn't clearly a test database.
//
// Four of these were renamed when the storefront moved onto the shared
// schema: users -> customers, sessions -> customer_sessions,
// themes -> storefront_themes, events -> storefront_events.
//
// `organizations` and `branches` are deliberately NOT here. They are not
// fixture data — they are the tenant every fixture hangs off, created once
// by scripts/setupTestDb.mjs. Truncating them would take every fixture with
// them by cascade and leave the next test inserting rows whose
// organization_id references nothing.
const TRUNCATE_ORDER = [
  "order_items", "orders", "cart_items", "carts", "coupon_usages", "coupon_categories", "coupons",
  "payments", "wishlist_items", "wishlists", "notifications", "reviews", "review_helpful_votes",
  "addresses", "customer_sessions", "rate_limit_counters", "storefront_events", "deleted_products",
  "product_attributes", "product_variants", "products",
  "attribute_definition_options", "attribute_definition_label_overrides", "attribute_definition_categories",
  "attribute_definitions", "brands", "categories", "promotions", "storefront_themes", "store_settings",
  "customers",
];

export async function truncateAll() {
  if (!dbReady) throw new Error(skipReason);
  const { query } = await import("../../config/db.js");
  await query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const table of TRUNCATE_ORDER) {
      await query(`TRUNCATE TABLE ${table}`);
    }
  } finally {
    await query("SET FOREIGN_KEY_CHECKS = 1");
  }
}

// Creates a REAL session via lib/session.js — the same function
// login/register use — against the test database, and returns the raw
// {rawToken, rawCsrfToken} pair a real client would receive via Set-Cookie.
// Deliberately not a shortcut/mock: this exercises the actual hashing,
// expiry, and storage logic every real session goes through, not a
// reimplementation of it.
export async function createTestSession(userId) {
  const { createSession } = await import("../../lib/session.js");
  return createSession(userId, { userAgent: "test-suite" });
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
  // POST /api/orders requires an Idempotency-Key header. Tests that don't
  // care about idempotency (the vast majority) get a fresh random one per
  // call for free, so each call still creates its own independent order
  // exactly like before this header existed. A test that DOES care
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

/**
 * A shopper.
 *
 * `role` and `permissions` are still accepted and ignored. They were columns
 * on the old `users` table; `customers` has neither, because a shopper has
 * no role and staff are not in this table at all — they are the dashboard's
 * accounts. Callers that pass `{ role: "employee" }` therefore get a plain
 * customer, which is the honest result: this app can no longer create a
 * staff member. The parameters stay so those call sites keep saying what
 * they meant while they are being retired.
 */
export async function createTestUser({ role, permissions } = {}) {
  void role;
  void permissions;
  const { default: User } = await import("../../models/userModel.js");
  const suffix = unique();
  const user = await User.create({
    name: `Test User ${suffix}`,
    email: `test-${suffix}@example.invalid`,
    password: "TestPassword123!",
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
    description: "Created by the test suite — safe to delete.",
    category: category._id,
    basePrice,
    images: ["https://placehold.co/400x400.png?text=test"],
    variants: [{ variantName: "Default", sku: `TEST-${suffix}`, stock }],
  });
}

export async function createDeliveredOrderFor(userId, productId, variantId) {
  const { default: Order } = await import("../../models/orderModel.js");
  const { withTransaction } = await import("../../lib/db/tx.js");
  return withTransaction((conn) =>
    Order.create(
      {
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
        // Order.create() requires SOME idempotency key hash even outside the
        // real checkout flow, since it's a NOT NULL-free but uniquely
        // indexed column — a random one per fixture keeps the (user,
        // idempotencyKeyHash) unique index happy across repeated fixture
        // creation in the same test file.
        idempotencyKeyHash: unique(),
        idempotencyRequestHash: unique(),
      },
      conn,
    ),
  );
}
