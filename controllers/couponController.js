import asyncHandler from "../middleware/asyncHandler.js";
import Coupon from "../models/couponModel.js";

// @desc    Validate coupon for current cart (no redeem yet)
// @route   POST /api/coupons/validate
// @access  Private
export const validateCoupon = asyncHandler(async (req, res) => {
  const { code, subtotal = 0 } = req.body;
  const coupon = await Coupon.findOne({ code: code?.toUpperCase() });
  if (!coupon) {
    res.status(404);
    throw new Error("Coupon not found");
  }
  const { valid, reason } = coupon.isValid();
  if (!valid) {
    res.status(400);
    throw new Error(reason);
  }
  if (subtotal < coupon.minOrderAmount) {
    res.status(400);
    throw new Error(`Minimum order $${coupon.minOrderAmount} required`);
  }
  let discount =
    coupon.discountType === "percentage"
      ? (subtotal * coupon.discountValue) / 100
      : coupon.discountValue;
  if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  res.json({ success: true, coupon, discount: Math.round(discount) });
});

// ========== ADMIN ==========
export const getAllCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.find().sort("-createdAt");
  res.json({ success: true, count: coupons.length, coupons });
});

export const createCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.create(req.body);
  res.status(201).json({ success: true, coupon });
});

export const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!coupon) {
    res.status(404);
    throw new Error("Coupon not found");
  }
  res.json({ success: true, coupon });
});

export const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) {
    res.status(404);
    throw new Error("Coupon not found");
  }
  res.json({ success: true, message: "Coupon deleted" });
});
