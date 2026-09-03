import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Coupon code is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    discountType: {
      type: String,
      enum: ["percentage", "flat"],
      required: [true, "Discount type is required"],
    },
    discountValue: {
      type: Number,
      required: [true, "Discount value is required"],
      min: [0, "Discount value cannot be negative"],
    },
    minOrderAmount: {
      type: Number,
      default: 0,
    },
    maxDiscount: {
      // cap for percentage-based coupons
      type: Number,
      default: null,
    },
    usageLimit: {
      // max total redemptions allowed (null = unlimited)
      type: Number,
      default: null,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    perUserLimit: {
      // max times one user can use this coupon
      type: Number,
      default: 1,
    },
    applicableCategories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "categories",
      },
    ],
    expiresAt: {
      type: Date,
      required: [true, "Expiry date is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// Check if coupon is still valid
couponSchema.methods.isValid = function () {
  const now = new Date();
  if (!this.isActive) return { valid: false, reason: "Coupon is inactive" };
  if (this.expiresAt < now)
    return { valid: false, reason: "Coupon has expired" };
  if (this.usageLimit !== null && this.usedCount >= this.usageLimit)
    return { valid: false, reason: "Coupon usage limit reached" };
  return { valid: true };
};

const couponModel = mongoose.model("coupons", couponSchema);
export default couponModel;
