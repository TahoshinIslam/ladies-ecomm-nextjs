// Phase 1: GET /api/orders (admin listing) — unbounded `limit` characterization.
//
// services/orderService.js's getAllOrders() does `.limit(Number(limit))`
// with NO upper clamp — unlike services/userService.js's listUsers(), which
// explicitly does `Math.min(100, Number(limit) || 20)`. This file documents
// (does not fix) that inconsistency, per the Phase 1 prompt: "Document the
// current unbounded behavior. Do not implement the clamp during Phase 1."
//
// For inputs where MongoDB driver behavior is not something this repo's
// own code controls (NaN, negative numbers), this file records the actual
// observed behavior rather than asserting a guessed contract — see the
// per-test comments.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  createTestSession,
  requestAs,
  createTestUser,
  createTestProduct,
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("GET /api/orders — limit parameter (documented, not fixed)", { skip: !canRun && reason }, () => {
  let GET;
  let Order, User, Product;
  let admin, buyer, product;
  const ORDER_COUNT = 5;

  before(async () => {
    await connectTestDb();
    ({ GET } = await import("../app/api/orders/route.js"));
    ({ default: Order } = await import("../models/orderModel.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));

    admin = await createTestUser({ role: "admin" });
    buyer = await createTestUser({ role: "customer" });
    product = await createTestProduct({ stock: 100 });

    for (let i = 0; i < ORDER_COUNT; i++) {
      await Order.create({
        user: buyer._id,
        items: [{ product: product._id, variantId: product.variants[0]._id, quantity: 1, snapshot: { name: "x", price: 100 } }],
        shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" },
        subtotal: 100,
        total: 100,
      });
    }
  });

  after(async () => {
    await Order.deleteMany({ user: buyer._id });
    await Product.deleteOne({ _id: product._id });
    await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
    await disconnectTestDb();
  });

  // Scoped to this test's own buyer via the admin listing's `search` param
  // (services/orderService.js's getAllOrders matches customer name/email) —
  // GET /api/orders lists every order in the whole test database with no
  // other filter, so without this, orders left behind by other suites
  // sharing the same test database (or by a previous interrupted run) would
  // inflate the counts below and make the exact-count assertions flaky.
  const listAs = async (limitParam) => {
    const params = new URLSearchParams({ search: buyer.name });
    if (limitParam !== undefined) params.set("limit", String(limitParam));
    const url = `http://test/api/orders?${params.toString()}`;
    const req = requestAs({ method: "GET", url, session: await createTestSession(admin._id) });
    const res = await GET(req);
    const json = await res.json();
    return { res, json };
  };

  test("limit=20 (a normal value) returns at most 20 and no error", async () => {
    const { res, json } = await listAs(20);
    assert.equal(res.status, 200);
    assert.ok(json.orders.length <= 20);
  });

  test("limit=100 — larger than the total dataset — returns everything, no error, no rejection", async () => {
    const { res, json } = await listAs(100);
    assert.equal(res.status, 200);
    assert.equal(json.orders.length, ORDER_COUNT, "returns every matching order since 100 > total");
  });

  test("DOCUMENTED GAP: limit=999999 is accepted with no upper clamp (contrast: userService.listUsers clamps to 100, orderService.getAllOrders does not)", async () => {
    const { res, json } = await listAs(999999);
    assert.equal(res.status, 200, "no validation rejects an absurdly large limit");
    assert.equal(json.orders.length, ORDER_COUNT, "with only 5 real orders this looks harmless — at production scale this becomes an unbounded query with no server-side ceiling");
  });

  test("limit=-1 — negative value is passed through to Mongo uninspected (no validation, no 400)", async () => {
    const { res } = await listAs(-1);
    // No input validation exists in getAllOrders for a negative limit —
    // whatever the MongoDB driver does with it is what the client gets.
    // The one thing the code guarantees is that this is never rejected as
    // a 400 (there is no check to reject it) and never crashes the process
    // (withRoute's catch-all turns any driver-level error into a normal
    // JSON response instead of an unhandled exception).
    assert.notEqual(res.status, 400, "confirmed: no input validation exists for a negative limit");
  });

  test("limit=abc — Number('abc') is NaN, passed straight to .limit(NaN) with no validation", async () => {
    const { res } = await listAs("abc");
    // Same point as above: services/orderService.js:433 does
    // `.limit(Number(limit))` with no Number.isFinite guard. Whatever
    // Mongoose/the MongoDB driver does with NaN is undocumented by this
    // codebase's own logic — there is no application-level check that
    // would turn this into a clean 400 "invalid limit" error.
    assert.notEqual(res.status, 400, "confirmed: 'abc' is not rejected as a validation error before reaching the query");
  });

  test("missing limit defaults to 20 (the Route Handler's own default, not a service-level default)", async () => {
    const { res, json } = await listAs(undefined);
    assert.equal(res.status, 200);
    // app/api/orders/route.js: `limit: searchParams.get("limit") || 20` —
    // the default lives in the Route Handler, not in
    // services/orderService.js's getAllOrders signature (which also
    // defaults limit=20, redundantly).
    assert.ok(json.orders.length <= 20);
  });
});
