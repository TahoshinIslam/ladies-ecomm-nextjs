import Coupon from "../models/couponModel.js";
import { HttpError } from "../lib/http.js";
import { requireObjectIdFormat } from "../lib/validation.js";
import { couponDiscount } from "./orderService.js";

/**
 * Subtotal-only check, for callers that do not send the cart. It cannot know
 * which lines a category-limited coupon covers, so it refuses to price one
 * (the checkout sends its items and is answered by orderService.quoteCoupon,
 * which prices exactly as the order will). The discount is capped at the
 * subtotal: a coupon reduces the price of goods, never shipping or tax.
 */
export async function validateCoupon(code, subtotal = 0) {
  const coupon = await Coupon.findByCode(code);
  if (!coupon) throw new HttpError(404, "Coupon not found");

  const { valid, reason } = coupon.isValid();
  if (!valid) throw new HttpError(400, reason);

  if (subtotal < coupon.minOrderAmount) {
    throw new HttpError(400, `Minimum order of ${coupon.minOrderAmount} required`);
  }
  if (coupon.applicableCategories?.length) {
    throw new HttpError(400, "This coupon applies to some categories only — send the cart items to price it");
  }

  return { coupon, discount: couponDiscount(coupon, subtotal) };
}

// ========== ADMIN ==========





