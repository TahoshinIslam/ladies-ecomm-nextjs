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
import jwt from "jsonwebtoken";
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

// A JWT_SECRET must exist for lib/auth.js's userFromToken() to verify
// anything. Tests never invent their own secret — they rely on whatever
// the test environment has configured (.env.test), exactly like production
// code does, so a signing/verification mismatch here would be a real bug,
// not a test-only shortcut.
export function signTestToken(userId) {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET not set in the test environment");
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

export function requestAs({ method = "GET", url, token, body } = {}) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
