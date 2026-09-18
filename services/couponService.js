import Coupon from "../models/couponModel.js";
import { HttpError } from "../lib/http.js";
import { requireObjectIdFormat } from "../lib/validation.js";

export async function validateCoupon(code, subtotal = 0) {
  const coupon = await Coupon.findByCode(code);
  if (!coupon) throw new HttpError(404, "Coupon not found");

  const { valid, reason } = coupon.isValid();
  if (!valid) throw new HttpError(400, reason);

  if (subtotal < coupon.minOrderAmount) {
    throw new HttpError(400, `Minimum order of ${coupon.minOrderAmount} required`);
  }

  let discount =
    coupon.discountType === "percentage" ? (subtotal * coupon.discountValue) / 100 : coupon.discountValue;
  if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);

  return { coupon, discount: Math.round(discount) };
}

// ========== ADMIN ==========

// status: "active" (enabled and not yet expired) | "paused" (isActive:false,
// regardless of date) | "expired" (past expiresAt, regardless of isActive)
// — the same three-way priority the admin badge already renders with.
export async function getAllCoupons({ page = 1, limit = 20, search, status, sortBy, sortOrder } = {}) {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Number(limit) || 20);
  const skip = (pageNum - 1) * limitNum;

  const [coupons, total] = await Promise.all([
    Coupon.findAdminList({ search, status, sortBy, sortOrder, skip, limit: limitNum }),
    Coupon.countAdminList({ search, status }),
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
  requireObjectIdFormat(id, "id");
  // `body` is already schema-validated + `.strict()`-rejected of unknown
  // fields by schemas/couponSchemas.js's updateCouponSchema before this
  // runs — critically, that schema does NOT include `usedCount`, so an
  // admin PUT can never directly set it (it may only ever change via the
  // guarded atomic claim/rollback in services/orderService.js).
  const coupon = await Coupon.update(id, body);
  if (!coupon) throw new HttpError(404, "Coupon not found");
  return coupon;
}

export async function deleteCoupon(id) {
  requireObjectIdFormat(id, "id");
  const deleted = await Coupon.deleteById(id);
  if (!deleted) throw new HttpError(404, "Coupon not found");
}
