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

  test("KNOWN DEFECT: concurrent REAL claims (order creation) can exceed usageLimit — the $inc has no guard condition", async () => {
    // This is the actual write/claim path: services/orderService.js's
    // createOrder() -> calcTotals() reads the coupon (checking usageLimit
    // vs usedCount AT READ TIME), then, inside the transaction, does
    // `Coupon.updateOne({_id}, {$inc:{usedCount:1}})` — an INCREMENT WITH
    // NO GUARD (unlike the stock decrement, which guards with
    // `stock: {$gte: quantity}`). Two concurrent orders can both read
    // usedCount=0 as valid against usageLimit=1, and both then
    // unconditionally increment, ending at usedCount=2 — one MORE
    // redemption than the coupon allows. This is a real, previously
    // undocumented finding, not a guess.
    const buyer1 = await createTestUser();
    const buyer2 = await createTestUser();
    const product = await createTestProduct({ stock: 10 });
    const coupon = await makeCoupon({ usageLimit: 1, usedCount: 0, discountType: "flat", discountValue: 10, minOrderAmount: 0 });
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
      assert.equal(res1.status, 201);
      assert.equal(res2.status, 201, "BOTH concurrent orders succeed in claiming the coupon");

      const finalCoupon = await Coupon.findById(coupon._id);
      assert.equal(
        finalCoupon.usedCount,
        2,
        "DEFECT CONFIRMED: usedCount is 2 despite usageLimit being 1 — the coupon was over-redeemed under concurrency",
      );
    } finally {
      await Order.deleteMany({ user: { $in: [buyer1._id, buyer2._id] } });
      await Coupon.deleteOne({ _id: coupon._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [buyer1._id, buyer2._id] } });
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
