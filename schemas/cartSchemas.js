import { z } from "zod";

import { objectIdSchema, amountSchema } from "./commonSchemas.js";

export const addToCartSchema = z
  .object({
    productId: objectIdSchema,
    variantId: objectIdSchema,
    quantity: amountSchema.optional().default(1),
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
    quantity: z.number().min(0).max(99999),
  })
  .strict();

// POST /api/cart/check — "is what is in my bag still for sale?". Public: a guest's
// bag lives in their browser, so it is sent rather than read from an account.
export const cartCheckSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: objectIdSchema,
            variantId: objectIdSchema,
            quantity: amountSchema,
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
