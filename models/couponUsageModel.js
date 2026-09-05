import mongoose from "mongoose";

// Phase 5 — tracks how many times EACH USER has used EACH coupon, so
// `Coupon.perUserLimit` (defined in models/couponModel.js since Phase 1 but
// never enforced anywhere) can be enforced atomically under concurrency,
// the same way stock decrement already is (services/orderService.js's
// guarded `Product.updateOne` pattern) — a plain "count existing orders
// with this coupon+user, then compare" check-then-act would still race.
//
// The unique compound index below is what makes the atomic claim possible:
// services/orderService.js's coupon-claim step does a guarded
// `findOneAndUpdate({coupon, user, count: {$lt: perUserLimit}}, {$inc:
// {count: 1}}, {upsert: true})` — when a per-user-limited user's existing
// usage row fails that `count < perUserLimit` filter, Mongo's upsert
// attempts to insert a second row for the same (coupon, user) pair, which
// this unique index rejects with a duplicate-key error — the SAME
// "guarded write + catch the race" shape already used for Phase 4's
// idempotency key and Phase 4's COD Payment.order uniqueness, just backed
// by a different index.
const couponUsageSchema = new mongoose.Schema(
  {
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "coupons",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

couponUsageSchema.index({ coupon: 1, user: 1 }, { unique: true });

const CouponUsage = mongoose.models.couponusages || mongoose.model("couponusages", couponUsageSchema);
export default CouponUsage;
