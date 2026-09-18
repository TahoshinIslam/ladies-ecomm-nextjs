// Confirmed audit finding, fixed: POST /api/orders (order creation) had no
// rate limit at all, unlike login/register/forgot-password/reset-password/
// coupon-validate. See services/orderService.js's createOrder() and
// lib/rateLimitConfig.js's ORDER_CREATE_USER_LIMIT.
//
// Critically: the limiter is checked AFTER the sequential-replay
// idempotency fast path, so retrying/resubmitting the exact same checkout
// (same Idempotency-Key) must NEVER be blocked by it — only genuinely new
// order attempts consume a slot. This file proves both halves against the
// real limiter/DB, not a mock.

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

const canRun = dbReady;
const reason = skipReason;

describe("POST /api/orders — order creation is rate limited (confirmed audit fix)", { skip: !canRun && reason }, () => {
  let POST;
  let buyer, session, product;

  before(async () => {
    // Deliberately tiny limit for this test run only, so the test doesn't
    // need to fire real production-sized bursts to prove the behavior.
    process.env.RATE_LIMIT_ORDER_CREATE_USER_MAX = "3";
    await connectTestDb();
    await truncateAll();
    ({ POST } = await import("../app/api/orders/route.js"));
    buyer = await createTestUser({ role: "customer" });
    session = await createTestSession(buyer._id);
    product = await createTestProduct({ stock: 1000 });
  });

  after(async () => {
    await rawQuery("DELETE FROM rate_limit_counters");
    await disconnectTestDb();
    delete process.env.RATE_LIMIT_ORDER_CREATE_USER_MAX;
  });

  function orderBody() {
    return {
      items: [{ productId: String(product._id), variantId: String(product.variants[0]._id), quantity: 1 }],
      shippingAddress: { fullName: "Test Buyer", phone: "0100000000", street: "1 Test St", city: "Dhaka", postalCode: "1000", country: "Bangladesh" },
    };
  }

  function placeOrder(idempotencyKey) {
    return POST(requestAs({ method: "POST", url: "http://test/api/orders", session, body: orderBody(), idempotencyKey }));
  }

  test("genuinely new order attempts are blocked once the per-user limit is exceeded", async () => {
    await rawQuery("DELETE FROM rate_limit_counters");
    let blockedRes;
    for (let i = 0; i < 4; i++) {
      // Each call gets its own fresh Idempotency-Key (undefined -> requestAs
      // generates a random one) — these are 4 DISTINCT order attempts.
      blockedRes = await placeOrder();
    }
    assert.equal(blockedRes.status, 429, "the 4th distinct order attempt (limit is 3) must be blocked");
    const json = await blockedRes.json();
    assert.match(json.message, /too many requests/i);
  });

  test("retrying the SAME order (same Idempotency-Key) never consumes a rate-limit slot", async () => {
    await rawQuery("DELETE FROM rate_limit_counters");
    const key = "same-key-retry-test-0123456789";

    // First call actually creates the order.
    const first = await placeOrder(key);
    assert.equal(first.status, 201);
    const firstOrderId = (await first.json()).order._id;

    // Replaying the SAME key many more times than the limit must still
    // succeed every time (sequential-replay fast path, checked BEFORE the
    // rate limiter) — proving retries/resubmits of one checkout are never
    // penalized by this fix.
    for (let i = 0; i < 10; i++) {
      const replay = await placeOrder(key);
      assert.equal(replay.status, 200, `replay #${i} of the same Idempotency-Key must succeed, not be rate-limited`);
      const json = await replay.json();
      assert.equal(json.order._id, firstOrderId);
    }
  });
});
