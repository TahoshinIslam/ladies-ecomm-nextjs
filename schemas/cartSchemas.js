import { z } from "zod";

import { objectIdSchema, quantitySchema } from "./commonSchemas.js";

export const addToCartSchema = z
  .object({
    productId: objectIdSchema,
    variantId: objectIdSchema,
    quantity: quantitySchema.optional().default(1),
  })
  .strict();

// services/cartService.js's updateCartItem() treats quantity <= 0 as
// "remove this item" (an idempotent delete) — 0 is a legitimate,
// intentional value here, unlike everywhere else quantitySchema is used.
// Negative values are NOT preserved as meaningful (0 already means
// "remove") and are rejected as a deliberate tightening.
export const updateCartItemSchema = z
  .object({
    productId: objectIdSchema,
    variantId: objectIdSchema,
    quantity: z.number().int().min(0).max(999),
  })
  .strict();
