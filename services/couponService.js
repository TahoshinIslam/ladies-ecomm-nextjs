import Coupon from "../models/couponModel.js";
import { HttpError } from "../lib/http.js";

export async function validateCoupon(code, subtotal = 0) {
  const coupon = await Coupon.findOne({ code: code?.toUpperCase() });
  if (!coupon) throw new HttpError(404, "Coupon not found");

  const { valid, reason } = coupon.isValid();
  if (!valid) throw new HttpError(400, reason);

  if (subtotal < coupon.minOrderAmount) {
    // No currency symbol here deliberately — this amount is compared
    // directly against whatever currency the caller's subtotal is already
    // in (BDT or USD, decided by CheckoutPage.jsx), and the Coupon model
    // itself has no currency field, so a hardcoded "$" would be wrong for
    // half of checkout's real customers.
    throw new HttpError(400, `Minimum order of ${coupon.minOrderAmount} required`);
  }

  let discount =
    coupon.discountType === "percentage"
      ? (subtotal * coupon.discountValue) / 100
      : coupon.discountValue;
  if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);

  return { coupon, discount: Math.round(discount) };
}

// ========== ADMIN ==========

const COUPON_SORT_FIELDS = { code: "code", expiresAt: "expiresAt", usedCount: "usedCount", createdAt: "createdAt" };

// status: "active" (enabled and not yet expired) | "paused" (isActive:false,
// regardless of date) | "expired" (past expiresAt, regardless of isActive)
// — the same three-way priority the admin badge already renders with.
export async function getAllCoupons({ page = 1, limit = 20, search, status, sortBy, sortOrder } = {}) {
  const filter = {};
  if (search && String(search).trim()) {
    const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.code = new RegExp(escaped, "i");
  }
  const now = new Date();
  if (status === "active") {
    filter.isActive = true;
    filter.expiresAt = { $gte: now };
  } else if (status === "paused") {
    filter.isActive = false;
  } else if (status === "expired") {
    filter.expiresAt = { $lt: now };
  }

  const sortField = COUPON_SORT_FIELDS[sortBy] || "createdAt";
  const sortDir = sortOrder === "asc" ? 1 : -1;
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Number(limit) || 20);
  const skip = (pageNum - 1) * limitNum;

  const [coupons, total] = await Promise.all([
    Coupon.find(filter).sort({ [sortField]: sortDir }).skip(skip).limit(limitNum),
    Coupon.countDocuments(filter),
  ]);
  return {
    coupons,
    total,
    page: pageNum,
    limit: limitNum,
    pages: Math.max(1, Math.ceil(total / limitNum)),
  };
}

export async function createCoupon(body) {
  return Coupon.create(body);
}

export async function updateCoupon(id, body) {
  const coupon = await Coupon.findByIdAndUpdate(id, body, { new: true, runValidators: true });
  if (!coupon) throw new HttpError(404, "Coupon not found");
  return coupon;
}

export async function deleteCoupon(id) {
  const coupon = await Coupon.findByIdAndDelete(id);
  if (!coupon) throw new HttpError(404, "Coupon not found");
}
