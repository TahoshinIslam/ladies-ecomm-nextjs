// Phase 1: coupon validation — services/couponService.js's validateCoupon(),
// via the real POST /api/coupons/validate Route Handler, against a real
// replica-set MongoDB. Traced directly from services/couponService.js and
// models/couponModel.js before writing any assertion below.
//
// Validation vs. claim: validateCoupon() is a PURE READ — it computes and
// returns a discount but writes nothing. The actual "claim" (the atomic
// `Coupon.updateOne({_id}, {$inc:{usedCount:1}})`) only happens inside
// services/orderService.js's createOrder(), a different code path. This
// file tests validation only. The one concurrency test in this file fires
// concurrent validation requests (which do not write) and concurrent real
// order-creation requests (which do write, via the guard-less $inc) —
// these are clearly separated below, and only the second is described as
// exercising a real "claim."

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

describe("Coupon validation and claim behavior", { skip: !canRun && reason }, () => {
  let validatePOST, createOrderPOST;
  let Coupon, User, Product, Order;

  before(async () => {
    await connectTestDb();
    ({ POST: validatePOST } = await import("../app/api/coupons/validate/route.js"));
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ default: Coupon } = await import("../models/couponModel.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ default: Order } = await import("../models/orderModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  const future = (days) => new Date(Date.now() + days * 86400000);
  const past = (days) => new Date(Date.now() - days * 86400000);

  async function makeCoupon(overrides = {}) {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return Coupon.create({
      code: `TEST${suffix}`.toUpperCase(),
      discountType: "flat",
      discountValue: 100,
      expiresAt: future(30),
      isActive: true,
      ...overrides,
    });
  }

  async function validateAs(user, code, subtotal) {
    const req = requestAs({
      method: "POST",
      url: "http://test/api/coupons/validate",
      session: user ? await createTestSession(user._id) : undefined,
      body: { code, subtotal },
    });
    const res = await validatePOST(req);
    return { res, json: await res.json() };
  }

  // ===================== 1-2: valid discounts =====================

  test("valid FIXED discount computes exactly", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon({ discountType: "flat", discountValue: 150 });
    try {
      const { res, json } = await validateAs(user, coupon.code, 1000);
      assert.equal(res.status, 200);
      assert.equal(json.discount, 150);
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  test("valid PERCENTAGE discount computes exactly", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon({ discountType: "percentage", discountValue: 10 });
    try {
      const { res, json } = await validateAs(user, coupon.code, 1000);
      assert.equal(res.status, 200);
      assert.equal(json.discount, 100, "10% of 1000 = 100");
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 3: max discount cap =====================

  test("percentage discount is capped at maxDiscount", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon({ discountType: "percentage", discountValue: 50, maxDiscount: 200 });
    try {
      const { json } = await validateAs(user, coupon.code, 1000);
      // 50% of 1000 = 500, capped to 200
      assert.equal(json.discount, 200);
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 4-6: state gates =====================

  test("inactive coupon is rejected", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon({ isActive: false });
    try {
      const { res, json } = await validateAs(user, coupon.code, 1000);
      assert.equal(res.status, 400);
      assert.equal(json.message, "Coupon is inactive");
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  test("expired coupon is rejected", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon({ expiresAt: past(1) });
    try {
      const { res, json } = await validateAs(user, coupon.code, 1000);
      assert.equal(res.status, 400);
      assert.equal(json.message, "Coupon has expired");
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  test("NOT APPLICABLE: there is no 'not-yet-active' / start-date concept in this schema", async () => {
    // models/couponModel.js has no startsAt/activeFrom field at all — only
    // `isActive` (a plain boolean toggle) and `expiresAt` (an end date).
    // A coupon dated in the future is not a supported scenario the code
    // has any awareness of; confirming this by inspection is the correct
    // characterization here, not fabricating a test for a feature that
    // does not exist. A coupon with isActive:true and any future
    // expiresAt validates immediately, regardless of when it was created.
    const user = await createTestUser();
    const coupon = await makeCoupon({ expiresAt: future(60) }); // "starts" arbitrarily far in the future in spirit, but nothing gates on that
    try {
      const { res } = await validateAs(user, coupon.code, 1000);
      assert.equal(res.status, 200, "confirmed: a coupon 'meant' to start later is usable immediately — no such gate exists in the code");
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 7: minimum order =====================

  test("subtotal below minOrderAmount is rejected", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon({ minOrderAmount: 500 });
    try {
      const { res, json } = await validateAs(user, coupon.code, 499);
      assert.equal(res.status, 400);
      assert.equal(json.message, "Minimum order of 500 required");
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 8-9: usage limit =====================

  test("total usage limit: valid while under the limit, rejected once usedCount reaches it", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon({ usageLimit: 2, usedCount: 1 });
    try {
      const { res: okRes } = await validateAs(user, coupon.code, 1000);
      assert.equal(okRes.status, 200, "usedCount(1) < usageLimit(2) — still valid");

      await Coupon.updateOne({ _id: coupon._id }, { $set: { usedCount: 2 } });
      const { res: blockedRes, json } = await validateAs(user, coupon.code, 1000);
      assert.equal(blockedRes.status, 400);
      assert.equal(json.message, "Coupon usage limit reached");
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  test("zero remaining usage (usedCount already at usageLimit) is rejected", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon({ usageLimit: 1, usedCount: 1 });
    try {
      const { res } = await validateAs(user, coupon.code, 1000);
      assert.equal(res.status, 400);
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 10-12: code shape =====================

  test("malformed / nonexistent coupon code returns 404", async () => {
    const user = await createTestUser();
    try {
      const { res, json } = await validateAs(user, "TOTALLY-FAKE-CODE-XYZ", 1000);
      assert.equal(res.status, 404);
      assert.equal(json.message, "Coupon not found");
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("lowercase input is normalized to the stored uppercase code", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon();
    try {
      const { res } = await validateAs(user, coupon.code.toLowerCase(), 1000);
      assert.equal(res.status, 200, "services/couponService.js's validateCoupon() explicitly does code?.toUpperCase() before the lookup");
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  test("leading/trailing whitespace on the code IS effectively trimmed — not by validateCoupon() itself, but by Mongoose's schema-level query casting", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon();
    try {
      const { res } = await validateAs(user, `  ${coupon.code}  `, 1000);
      // Corrected finding: services/couponService.js's validateCoupon()
      // itself never calls .trim() — but models/couponModel.js's `code`
      // field declares `trim: true` in its schema, and Mongoose applies a
      // schema path's setters (trim/uppercase/lowercase) to QUERY filter
      // values for that path by default, not just to documents being
      // saved. So `Coupon.findOne({ code: "  CODE  " })` is cast to
      // `Coupon.findOne({ code: "CODE" })` before it ever reaches MongoDB.
      // Verified here directly rather than assumed — an initial version of
      // this test wrongly asserted the opposite (404) and failed against
      // the real database, which is exactly why this suite runs for real
      // instead of stopping at code-reading.
      assert.equal(res.status, 200, "confirmed: whitespace-padded codes resolve successfully via Mongoose's automatic query-side trim/uppercase casting");
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 13: auth requirement =====================

  test("missing authenticated user is rejected (401) — requireUser gates this endpoint", async () => {
    const coupon = await makeCoupon();
    try {
      const { res } = await validateAs(null, coupon.code, 1000);
      assert.equal(res.status, 401);
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
    }
  });

  // ===================== 14: not found (distinct case) =====================

  test("a syntactically-plausible but never-issued code returns the same 404 as garbage input", async () => {
    const user = await createTestUser();
    try {
      const { res, json } = await validateAs(user, "SUMMER2099SALE", 1000);
      assert.equal(res.status, 404);
      assert.equal(json.message, "Coupon not found");
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 15: repeated validation =====================

  test("repeated validation of the same coupon is idempotent — it's a pure read, usedCount never changes", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon({ discountType: "flat", discountValue: 50 });
    try {
      for (let i = 0; i < 5; i++) {
        const { res, json } = await validateAs(user, coupon.code, 1000);
        assert.equal(res.status, 200);
        assert.equal(json.discount, 50);
      }
      const stored = await Coupon.findById(coupon._id);
      assert.equal(stored.usedCount, 0, "validateCoupon() never writes — repeated calls never consume usage");
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 16: concurrency — validation vs. real claim =====================

  test("concurrent VALIDATION requests are all independently valid (no write occurs, so there's nothing to race)", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon({ usageLimit: 1, usedCount: 0, discountType: "flat", discountValue: 25 });
    try {
      const results = await Promise.all([
        validateAs(user, coupon.code, 1000),
        validateAs(user, coupon.code, 1000),
        validateAs(user, coupon.code, 1000),
      ]);
      for (const { res, json } of results) {
        assert.equal(res.status, 200, "all three succeed — validation reads usedCount but never increments it");
        assert.equal(json.discount, 25);
      }
      const stored = await Coupon.findById(coupon._id);
      assert.equal(stored.usedCount, 0, "confirms no write occurred — this is NOT a claim-safety test");
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  test("FIXED: concurrent REAL claims (order creation) can no longer exceed usageLimit", async () => {
    // services/orderService.js's createOrder() now claims global usage via
    // a GUARDED conditional update — `Coupon.updateOne({_id, $or:[{usageLimit:
    // null},{$expr:{$lt:["$usedCount","$usageLimit"]}}]}, {$inc:{usedCount:1}})`
    // — mirroring the stock-decrement guard exactly, with `modifiedCount`
    // checked to detect a lost race (409). Two concurrent orders against a
    // usageLimit:1 coupon can no longer both succeed.
    const buyer1 = await createTestUser();
    const buyer2 = await createTestUser();
    const product = await createTestProduct({ stock: 10 });
    const coupon = await makeCoupon({ usageLimit: 1, usedCount: 0, discountType: "flat", discountValue: 10, minOrderAmount: 0, perUserLimit: null });
    try {
      const address = { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" };
      const place = async (buyer) =>
        createOrderPOST(
          requestAs({
            method: "POST",
            url: "http://test/api/orders",
            session: await createTestSession(buyer._id),
            body: {
              items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
              shippingAddress: address,
              couponCode: coupon.code,
            },
          }),
        );

      const [res1, res2] = await Promise.all([place(buyer1), place(buyer2)]);
      const statuses = [res1.status, res2.status];
      assert.equal(statuses.filter((s) => s === 201).length, 1, "exactly one concurrent order may claim the last redemption");
      assert.equal(statuses.filter((s) => s === 400 || s === 409).length, 1, "the loser is rejected (400 from the read-time check or 409 from the guarded claim losing the race), never silently allowed");

      const finalCoupon = await Coupon.findById(coupon._id);
      assert.equal(finalCoupon.usedCount, 1, "FIXED: usedCount can never exceed usageLimit under concurrency");

      const successfulCount = await Order.countDocuments({ user: { $in: [buyer1._id, buyer2._id] }, coupon: coupon._id });
      assert.equal(successfulCount, 1, "only the winning order actually references the coupon");
    } finally {
      await Order.deleteMany({ user: { $in: [buyer1._id, buyer2._id] } });
      await Coupon.deleteOne({ _id: coupon._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [buyer1._id, buyer2._id] } });
    }
  });

  test("FIXED: perUserLimit is now enforced — a second order for the SAME user against the same coupon is rejected once the limit is reached", async () => {
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 10 });
    const coupon = await makeCoupon({ usageLimit: null, usedCount: 0, discountType: "flat", discountValue: 10, minOrderAmount: 0, perUserLimit: 1 });
    try {
      const address = { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" };
      const place = async () =>
        createOrderPOST(
          requestAs({
            method: "POST",
            url: "http://test/api/orders",
            session: await createTestSession(buyer._id),
            body: {
              items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
              shippingAddress: address,
              couponCode: coupon.code,
            },
          }),
        );

      const first = await place();
      assert.equal(first.status, 201);
      const second = await place();
      assert.ok([400, 409].includes(second.status), "a second use by the same user past perUserLimit must be rejected");

      const finalCoupon = await Coupon.findById(coupon._id);
      assert.equal(finalCoupon.usedCount, 1, "the rejected second attempt must not have incremented global usedCount either");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Coupon.deleteOne({ _id: coupon._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("FIXED: perUserLimit is scoped per user — a DIFFERENT user can still use the same coupon after the first user reaches their own limit", async () => {
    const buyer1 = await createTestUser();
    const buyer2 = await createTestUser();
    const product = await createTestProduct({ stock: 10 });
    const coupon = await makeCoupon({ usageLimit: null, usedCount: 0, discountType: "flat", discountValue: 10, minOrderAmount: 0, perUserLimit: 1 });
    try {
      const address = { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" };
      const place = async (buyer) =>
        createOrderPOST(
          requestAs({
            method: "POST",
            url: "http://test/api/orders",
            session: await createTestSession(buyer._id),
            body: {
              items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
              shippingAddress: address,
              couponCode: coupon.code,
            },
          }),
        );

      const res1 = await place(buyer1);
      assert.equal(res1.status, 201);
      const res2 = await place(buyer2);
      assert.equal(res2.status, 201, "a different user's own per-user limit is independent");
    } finally {
      await Order.deleteMany({ user: { $in: [buyer1._id, buyer2._id] } });
      await Coupon.deleteOne({ _id: coupon._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [buyer1._id, buyer2._id] } });
    }
  });

  test("FIXED: concurrent orders for the SAME user against a perUserLimit:1 coupon — exactly one succeeds, no duplicate-key 500", async () => {
    const buyer = await createTestUser();
    const productA = await createTestProduct({ stock: 10 });
    const productB = await createTestProduct({ stock: 10 });
    const coupon = await makeCoupon({ usageLimit: null, usedCount: 0, discountType: "flat", discountValue: 10, minOrderAmount: 0, perUserLimit: 1 });
    try {
      const address = { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" };
      const place = async (product) =>
        createOrderPOST(
          requestAs({
            method: "POST",
            url: "http://test/api/orders",
            session: await createTestSession(buyer._id),
            body: {
              items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
              shippingAddress: address,
              couponCode: coupon.code,
            },
          }),
        );

      const [res1, res2] = await Promise.all([place(productA), place(productB)]);
      const statuses = [res1.status, res2.status];
      assert.ok(statuses.every((s) => [201, 400, 409].includes(s)), "no raw duplicate-key 500 may surface");
      assert.equal(statuses.filter((s) => s === 201).length, 1, "exactly one of the two concurrent orders for this user may claim the coupon");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Coupon.deleteOne({ _id: coupon._id });
      await Product.deleteMany({ _id: { $in: [productA._id, productB._id] } });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("FIXED: a failed order transaction rolls back the coupon claim — the same coupon can be used again immediately, global and per-user counts are unchanged", async () => {
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 1 });
    const coupon = await makeCoupon({ usageLimit: null, usedCount: 0, discountType: "flat", discountValue: 10, minOrderAmount: 0, perUserLimit: 1 });
    try {
      const address = { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" };
      // Force the stock guard to fail (order quantity 5 against stock 1) —
      // the whole transaction, including the coupon claim, must roll back.
      const failing = await createOrderPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/orders",
          session: await createTestSession(buyer._id),
          body: {
            items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 5 }],
            shippingAddress: address,
            couponCode: coupon.code,
          },
        }),
      );
      assert.equal(failing.status, 400);

      const afterFailure = await Coupon.findById(coupon._id);
      assert.equal(afterFailure.usedCount, 0, "a failed transaction must not leave a partial coupon claim");
      const { default: CouponUsage } = await import("../models/couponUsageModel.js");
      assert.equal(await CouponUsage.findOne({ coupon: coupon._id, user: buyer._id }), null, "no per-user usage row from a rolled-back transaction");

      // The SAME coupon must still be fully usable afterward.
      const succeeding = await createOrderPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/orders",
          session: await createTestSession(buyer._id),
          body: {
            items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
            shippingAddress: address,
            couponCode: coupon.code,
          },
        }),
      );
      assert.equal(succeeding.status, 201);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Coupon.deleteOne({ _id: coupon._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("FIXED: cancelling an order restores both the global usedCount and the per-user usage count", async () => {
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 10 });
    const coupon = await makeCoupon({ usageLimit: null, usedCount: 0, discountType: "flat", discountValue: 10, minOrderAmount: 0, perUserLimit: 1 });
    try {
      const address = { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" };
      const res = await createOrderPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/orders",
          session: await createTestSession(buyer._id),
          body: {
            items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
            shippingAddress: address,
            couponCode: coupon.code,
          },
        }),
      );
      assert.equal(res.status, 201);
      const { order } = await res.json();

      const { POST: cancelPOST } = await import("../app/api/orders/[id]/cancel/route.js");
      const cancelRes = await cancelPOST(
        requestAs({ method: "POST", url: `http://test/api/orders/${order._id}/cancel`, session: await createTestSession(buyer._id) }),
        { params: Promise.resolve({ id: order._id }) },
      );
      assert.equal(cancelRes.status, 200);

      const afterCancel = await Coupon.findById(coupon._id);
      assert.equal(afterCancel.usedCount, 0, "cancelling restores global usedCount");
      const { default: CouponUsage } = await import("../models/couponUsageModel.js");
      const usage = await CouponUsage.findOne({ coupon: coupon._id, user: buyer._id });
      assert.equal(usage?.count ?? 0, 0, "cancelling restores per-user usage count");

      // Restored usage means the SAME user can use the coupon again.
      const again = await createOrderPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/orders",
          session: await createTestSession(buyer._id),
          body: {
            items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
            shippingAddress: address,
            couponCode: coupon.code,
          },
        }),
      );
      assert.equal(again.status, 201, "restored usage means this user can use the coupon again after cancelling");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Coupon.deleteOne({ _id: coupon._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  // ===================== 17-18: exact math / bounds =====================

  test("exact BDT integer math: percentage discount rounds to the nearest integer (Math.round)", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon({ discountType: "percentage", discountValue: 33 });
    try {
      const { json } = await validateAs(user, coupon.code, 1001);
      // 33% of 1001 = 330.33 -> Math.round -> 330
      assert.equal(json.discount, 330);
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  test("DOCUMENTED LIMITATION: a flat discount is NOT capped to the subtotal — it can exceed the order total", async () => {
    const user = await createTestUser();
    const coupon = await makeCoupon({ discountType: "flat", discountValue: 5000 });
    try {
      const { res, json } = await validateAs(user, coupon.code, 100);
      assert.equal(res.status, 200, "no rejection occurs even though the discount vastly exceeds the subtotal");
      assert.equal(
        json.discount,
        5000,
        "confirmed: services/couponService.js's validateCoupon() only applies maxDiscount (if set) — there is no clamp against the subtotal itself, so a large flat-discount coupon on a small order can produce a negative effective total upstream in orderService.js's calcTotals() (which does floor the final order total at 0 via Math.max(0, ...), but the coupon's own reported `discount` value here is not itself bounded)",
      );
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });
});
