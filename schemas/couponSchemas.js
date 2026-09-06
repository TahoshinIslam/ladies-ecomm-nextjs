import { z } from "zod";

import { nonNegativeFiniteNumber, objectIdSchema, requiredString } from "./commonSchemas.js";

// Exported standalone so the admin coupon form (views/admin/CouponsPage.jsx)
// can build its own zod object from the same source instead of hand-copying
// the two literal strings and risking silent drift if a third discount type
// is ever added here.
export const DISCOUNT_TYPES = ["percentage", "flat"];

const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3, "coupon code must be at least 3 characters")
  .max(30, "coupon code must be at most 30 characters")
  .regex(/^[A-Z0-9_-]+$/, "coupon code may only contain letters, digits, hyphens, and underscores");

// Admin create/update — `.strict()` is a deliberate mass-assignment guard.
// Critically, this schema does NOT include `usedCount` at all: that field
// must only ever change via services/orderService.js's atomic, guarded
// $inc at claim time (and its guarded rollback on cancel) — never via a
// direct admin PUT, which today (pre-Phase-5) could set it to anything,
// including a value that desynchronizes it from real order history.
export const createCouponSchema = z
  .object({
    code: couponCodeSchema,
    discountType: z.enum(DISCOUNT_TYPES),
    discountValue: nonNegativeFiniteNumber,
    minOrderAmount: nonNegativeFiniteNumber.optional().default(0),
    maxDiscount: z.union([z.null(), nonNegativeFiniteNumber]).optional(),
    usageLimit: z.union([z.null(), z.number().int().positive()]).optional(),
    perUserLimit: z.union([z.null(), z.number().int().positive()]).optional().default(1),
    applicableCategories: z.array(objectIdSchema).max(100).optional().default([]),
    expiresAt: z.coerce.date(),
    isActive: z.boolean().optional().default(true),
  })
  .strict()
  .refine((data) => data.discountType !== "percentage" || data.discountValue <= 100, {
    message: "a percentage discount cannot exceed 100",
    path: ["discountValue"],
  });

export const validateCouponSchema = z
  .object({
    code: couponCodeSchema,
    subtotal: nonNegativeFiniteNumber,
  })
  .strict();

// Kept separate from createCouponSchema (rather than `.partial()`) because
// the percentage<=100 refine above doesn't compose cleanly with `.partial()`
// when discountType is omitted on a partial update — this repeats the
// field list deliberately for clarity over cleverness.
export const updateCouponSchema = z
  .object({
    code: couponCodeSchema.optional(),
    discountType: z.enum(DISCOUNT_TYPES).optional(),
    discountValue: nonNegativeFiniteNumber.optional(),
    minOrderAmount: nonNegativeFiniteNumber.optional(),
    maxDiscount: z.union([z.null(), nonNegativeFiniteNumber]).optional(),
    usageLimit: z.union([z.null(), z.number().int().positive()]).optional(),
    perUserLimit: z.union([z.null(), z.number().int().positive()]).optional(),
    applicableCategories: z.array(objectIdSchema).max(100).optional(),
    expiresAt: z.coerce.date().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
