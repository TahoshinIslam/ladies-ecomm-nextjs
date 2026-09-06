// Phase 5 rewrite — GET /api/orders (admin listing) `limit` parameter is
// now bounded.
//
// Previously services/orderService.js's getAllOrders() did
// `.limit(Number(limit))` with NO upper clamp — unlike
// services/userService.js's listUsers(), which explicitly does
// `Math.min(100, Number(limit) || 20)`. Phase 5 adds
// schemas/orderSchemas.js's adminOrderListQuerySchema (a shared bounded-
// pagination schema, see schemas/commonSchemas.js's boundedIntParam),
// validated in app/api/orders/route.js's GET handler BEFORE getAllOrders()
// ever runs — an out-of-range/malformed `limit` (or `page`) is now a clean
// 400, not a silently-accepted unbounded query.

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

describe("GET /api/orders — limit parameter is bounded (Phase 5 fix)", { skip: !canRun && reason }, () => {
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

  test("limit=100 (the documented maximum) — larger than the total dataset — returns everything, no error", async () => {
    const { res, json } = await listAs(100);
    assert.equal(res.status, 200);
    assert.equal(json.orders.length, ORDER_COUNT, "returns every matching order since 100 > total");
  });

  test("FIXED: limit=999999 is now REJECTED (400), not silently accepted with no upper clamp", async () => {
    const { res } = await listAs(999999);
    assert.equal(res.status, 400, "an out-of-range limit is now a clean validation error, not an unbounded query");
  });

  test("FIXED: limit=-1 (negative) is rejected (400)", async () => {
    const { res } = await listAs(-1);
    assert.equal(res.status, 400);
  });

  test("FIXED: limit=abc (non-numeric) is rejected (400), not silently passed as NaN to .limit()", async () => {
    const { res } = await listAs("abc");
    assert.equal(res.status, 400);
  });

  test("FIXED: limit=0 is rejected (400)", async () => {
    const { res } = await listAs(0);
    assert.equal(res.status, 400);
  });

  test("FIXED: limit=1.5 (decimal) is rejected (400)", async () => {
    const { res } = await listAs(1.5);
    assert.equal(res.status, 400);
  });

  test("FIXED: an extremely long numeric string is rejected (400), not silently accepted as Infinity", async () => {
    const { res } = await listAs("9".repeat(400));
    assert.equal(res.status, 400);
  });

  test("FIXED: a repeated limit query param (ambiguous) is rejected (400)", async () => {
    const params = new URLSearchParams({ search: buyer.name });
    params.append("limit", "10");
    params.append("limit", "20");
    const url = `http://test/api/orders?${params.toString()}`;
    const req = requestAs({ method: "GET", url, session: await createTestSession(admin._id) });
    const res = await GET(req);
    assert.equal(res.status, 400, "an ambiguous repeated limit value must not be silently resolved by picking one");
  });

  test("missing limit defaults to 20", async () => {
    const { res, json } = await listAs(undefined);
    assert.equal(res.status, 200);
    assert.ok(json.orders.length <= 20);
  });

  test("FIXED: page=0 and negative page are rejected (400)", async () => {
    const params0 = new URLSearchParams({ search: buyer.name, page: "0" });
    const resZero = await GET(requestAs({ method: "GET", url: `http://test/api/orders?${params0.toString()}`, session: await createTestSession(admin._id) }));
    assert.equal(resZero.status, 400);

    const paramsNeg = new URLSearchParams({ search: buyer.name, page: "-1" });
    const resNeg = await GET(requestAs({ method: "GET", url: `http://test/api/orders?${paramsNeg.toString()}`, session: await createTestSession(admin._id) }));
    assert.equal(resNeg.status, 400);
  });
});
