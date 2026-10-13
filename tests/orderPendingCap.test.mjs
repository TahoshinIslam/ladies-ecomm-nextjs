// A customer can only have a few orders waiting for the store at once.
//
// Every order takes its stock the moment it is placed, and cash on delivery
// costs the shopper nothing up front, so without a ceiling a handful of
// throwaway accounts could make a shop look sold out with orders they never
// mean to accept. See lib/rateLimitConfig.js's ORDER_MAX_PENDING_PER_CUSTOMER
// and services/orderService.js's createOrder().

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  truncateAll,
  createTestSession,
  requestAs,
  createTestUser,
  createTestProduct,
  rawQuery,
} from "./helpers/testDb.mjs";

describe("POST /api/orders — at most N orders waiting per customer", { skip: !dbReady && skipReason }, () => {
  let POST;
  let buyer, buyerSession, other, otherSession, product;

  before(async () => {
    process.env.ORDER_MAX_PENDING_PER_CUSTOMER = "2";
    // The hourly limiter is a different control; keep it out of the way here.
    process.env.RATE_LIMIT_ORDER_CREATE_USER_MAX = "1000";
    await connectTestDb();
    await truncateAll();
    ({ POST } = await import("../app/api/orders/route.js"));
    buyer = await createTestUser({ role: "customer" });
    buyerSession = await createTestSession(buyer._id);
    other = await createTestUser({ role: "customer" });
    otherSession = await createTestSession(other._id);
    product = await createTestProduct({ stock: 1000 });
  });

  after(async () => {
    await rawQuery("DELETE FROM rate_limit_counters");
    await disconnectTestDb();
    delete process.env.ORDER_MAX_PENDING_PER_CUSTOMER;
    delete process.env.RATE_LIMIT_ORDER_CREATE_USER_MAX;
  });

  const body = () => ({
    items: [{ productId: String(product._id), variantId: String(product.variants[0]._id), quantity: 1 }],
    shippingAddress: { fullName: "Test Buyer", phone: "0100000000", street: "1 Test St", city: "Dhaka", postalCode: "1000", country: "Bangladesh" },
  });
  const place = (session, idempotencyKey) =>
    POST(requestAs({ method: "POST", url: "http://test/api/orders", session, body: body(), idempotencyKey }));

  test("orders up to the ceiling go through; the next one is refused with a clear reason", async () => {
    assert.equal((await place(buyerSession)).status, 201);
    assert.equal((await place(buyerSession)).status, 201);

    const refused = await place(buyerSession);
    assert.equal(refused.status, 429);
    const json = await refused.json();
    assert.match(json.message, /orders waiting for the store/);
    assert.equal(json.errors?.code, "too-many-pending-orders");

    const [{ n }] = await rawQuery("SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?", [String(buyer._id)]);
    assert.equal(Number(n), 2, "the refused attempt created no order and took no stock");
  });

  test("another customer is not affected by someone else's pending orders", async () => {
    assert.equal((await place(otherSession)).status, 201);
  });

  test("once the store moves an order on, the customer can order again", async () => {
    const [first] = await rawQuery("SELECT id FROM orders WHERE customer_id = ? ORDER BY created_at LIMIT 1", [String(buyer._id)]);
    await rawQuery("UPDATE orders SET status = 'processing' WHERE id = ?", [first.id]);
    assert.equal((await place(buyerSession)).status, 201);
  });

  test("retrying an order already placed is never refused by the ceiling", async () => {
    const key = "pending-cap-retry-key-0123456789";
    await rawQuery("UPDATE orders SET status = 'processing' WHERE customer_id = ?", [String(buyer._id)]);
    assert.equal((await place(buyerSession, key)).status, 201);
    assert.equal((await place(buyerSession)).status, 201); // now at the ceiling of 2
    const replay = await place(buyerSession, key);
    assert.equal(replay.status, 200, "the same Idempotency-Key replays the existing order");
  });
});
