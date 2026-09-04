// ============================================================================
// KNOWN PRODUCTION DEFECT — regression characterization, NOT a spec.
// ============================================================================
// This file documents CURRENT behavior of POST /api/orders under a
// double-click / browser-retry / network-timeout-retry scenario. It is
// intentionally testing something the Phase 1 investigation identified as
// broken (see "Order idempotency" section of the audit): the endpoint has
// no idempotency key, and models/orderModel.js has no unique constraint
// that could reject a duplicate submission.
//
// The assertions below PASS today because they assert the defect exists.
// If order-request idempotency is implemented in a later phase, THIS FILE
// MUST BE UPDATED to assert the corrected behavior (exactly one order
// created) — a passing run of this file after that fix would mean the fix
// didn't work. Do not treat a green run of this file as "idempotency is
// fine" in either direction; read the test names.
//
// This does NOT test (and does not claim anything about):
//   - transactional stock safety (services/orderService.js's atomic
//     `stock: { $gte: quantity }` guard) — that is verified separately
//     below and is NOT the same guarantee as request-level idempotency.
//   - promo-claim idempotency (claimFirstOrderPromo's atomic
//     findOneAndUpdate) — also verified separately below.
// These three guarantees are independent; conflating them was flagged as a
// mistake in the Phase 0B investigation and is deliberately avoided here.
// ============================================================================

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

describe("POST /api/orders — duplicate-submission characterization (known defect)", { skip: !canRun && reason }, () => {
  let POST;
  let Order, User, Settings, Product;
  let user, product, variantId;
  let priorPromoSetting;

  before(async () => {
    await connectTestDb();
    ({ POST } = await import("../app/api/orders/route.js"));
    ({ default: Order } = await import("../models/orderModel.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Settings } = await import("../models/settingsModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));

    user = await createTestUser({ role: "customer" });
    // Enough stock that every test below (each firing 2 duplicate orders of
    // qty 1) can succeed without hitting the oversell guard — the point of
    // this file is the duplicate-ORDER defect, not the (separately-
    // verified, working) stock guard. This product is shared across all
    // tests in this file, so the total must comfortably cover all of them
    // combined, not just one.
    product = await createTestProduct({ stock: 50 });
    variantId = product.variants[0]._id;

    const settings = await Settings.getSingleton();
    priorPromoSetting = settings.promotions.firstOrderFreeShipping;
    settings.promotions.firstOrderFreeShipping = true;
    await settings.save();
  });

  after(async () => {
    const settings = await Settings.getSingleton();
    settings.promotions.firstOrderFreeShipping = priorPromoSetting;
    await settings.save();
    await Order.deleteMany({ user: user._id });
    await Product.deleteOne({ _id: product._id });
    await User.deleteOne({ _id: user._id });
    await disconnectTestDb();
  });

  const orderPayload = () => ({
    items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
    shippingAddress: {
      fullName: "Test Buyer",
      phone: "0100000000",
      street: "1 Test Street",
      city: "Dhaka",
      postalCode: "1200",
      country: "Bangladesh",
    },
  });

  const fireCreateOrder = async () => {
    const req = requestAs({
      method: "POST",
      url: "http://test/api/orders",
      session: await createTestSession(user._id),
      body: orderPayload(),
    });
    return POST(req);
  };

  test("KNOWN DEFECT: two simultaneous identical order requests create TWO distinct Order documents", async () => {
    const [res1, res2] = await Promise.all([fireCreateOrder(), fireCreateOrder()]);
    const [json1, json2] = await Promise.all([res1.json(), res2.json()]);

    // Both requests succeed — there is nothing in app/api/orders/route.js or
    // services/orderService.js's createOrder() that rejects a duplicate.
    assert.equal(res1.status, 201, "first request should succeed");
    assert.equal(res2.status, 201, "second request currently ALSO succeeds — this is the defect");

    assert.notEqual(
      json1.order._id,
      json2.order._id,
      "DEFECT CONFIRMED: two distinct Order _ids were created from what should be one customer action",
    );

    const ordersForUser = await Order.find({ user: user._id });
    assert.equal(
      ordersForUser.length,
      2,
      "DEFECT CONFIRMED: exactly two Order documents exist in the database for one double-submitted checkout",
    );
  });

  test("stock IS correctly decremented twice, independently, with no oversell (transactional safety works — separate guarantee from idempotency)", async () => {
    const before = await Product.findById(product._id);
    const stockBefore = before.variants[0].stock;

    const [res1, res2] = await Promise.all([fireCreateOrder(), fireCreateOrder()]);
    assert.equal(res1.status, 201);
    assert.equal(res2.status, 201);

    const after_ = await Product.findById(product._id);
    const stockAfter = after_.variants[0].stock;

    assert.equal(
      stockAfter,
      stockBefore - 2,
      "each of the two (duplicate) orders correctly decremented stock by 1 — the atomic guard prevents corruption, it does not prevent the duplicate order itself",
    );
    assert.ok(stockAfter >= 0, "stock must never go negative even under this duplicate-request scenario");
  });

  test("only ONE of the two duplicate orders is awarded the first-order promo (promo-claim idempotency works — separate guarantee from order idempotency)", async () => {
    const fresh = await createTestUser({ role: "customer" });
    // Deliberately a cheap product (basePrice 1 USD -> 120 BDT) — the
    // shared `product` fixture used by the other tests in this file is
    // 1000 USD -> 120,000 BDT, already well above the default
    // settings.shippingZones "Inside Dhaka" tier's freeAbove=2000
    // threshold, which would make shipping free on its own and never
    // actually exercise the promo-claim code path (services/orderService.js's
    // `ship.cost > 0` guard) — see the identical fix in
    // tests/orderTransactions.test.mjs's own promo test.
    const cheapProduct = await createTestProduct({ stock: 10, basePrice: 1 });
    try {
      const buildReq = async () =>
        requestAs({
          method: "POST",
          url: "http://test/api/orders",
          session: await createTestSession(fresh._id),
          body: {
            items: [{ productId: cheapProduct._id.toString(), variantId: cheapProduct.variants[0]._id.toString(), quantity: 1 }],
            shippingAddress: {
              fullName: "Test Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh",
            },
          },
        });

      // Both requests (including their own session creation) are fully
      // built BEFORE either POST() call starts, so Promise.all below fires
      // them genuinely concurrently — building would otherwise serialize
      // ahead of the actual order-creation race this test exists to prove.
      const [req1, req2] = await Promise.all([buildReq(), buildReq()]);
      const [res1, res2] = await Promise.all([POST(req1), POST(req2)]);
      const [json1, json2] = await Promise.all([res1.json(), res2.json()]);

      assert.equal(res1.status, 201);
      assert.equal(res2.status, 201);

      // shippingCost === 0 is how services/orderService.js's
      // claimFirstOrderPromo winner is expressed on the Order document.
      const freeShippingCount = [json1.order.shippingCost, json2.order.shippingCost].filter((c) => c === 0).length;

      assert.equal(
        freeShippingCount,
        1,
        "exactly one of the two duplicate orders should get free shipping — claimFirstOrderPromo's atomic findOneAndUpdate prevents both from winning, even though BOTH orders themselves still (defectively) exist",
      );

      const updatedUser = await User.findById(fresh._id);
      assert.equal(updatedUser.firstOrderPromoUsed, true, "the promo flag is still correctly consumed exactly once");
    } finally {
      await Order.deleteMany({ user: fresh._id });
      await User.deleteOne({ _id: fresh._id });
      await Product.deleteOne({ _id: cheapProduct._id });
    }
  });
});
