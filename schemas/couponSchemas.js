import { z } from "../lib/zod.js";

import { nonNegativeFiniteNumber } from "./commonSchemas.js";
import { orderItemsSchema } from "./orderSchemas.js";

const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3, "coupon code must be at least 3 characters")
  .max(30, "coupon code must be at most 30 characters")
  .regex(/^[A-Z0-9_-]+$/, "coupon code may only contain letters, digits, hyphens, and underscores");

// `items` (the cart) lets the coupon be priced exactly as the order will be,
// category limits included; `subtotal` alone is the older, cart-less form.
export const validateCouponSchema = z
  .object({
    code: couponCodeSchema,
    subtotal: nonNegativeFiniteNumber.optional().default(0),
    items: orderItemsSchema.optional(),
  })
  .strict();
