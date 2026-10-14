import { z } from "../lib/zod.js";

import { requiredString, urlSchema, paginationSchema, searchQuerySchema, sortFieldSchema, sortOrderSchema, objectIdSchema } from "./commonSchemas.js";

// GET /api/reviews/product/[productId] — `limit` is clamped so the list
// query is always bounded.
export const productReviewsQuerySchema = z.object(paginationSchema({ maxLimit: 50, defaultLimit: 10 }).shape).strict();

// GET /api/reviews (admin list) — same unbounded-limit fix
// (listAllReviews()).
export const adminReviewListQuerySchema = z
  .object({
    rating: z.coerce.number().int().min(1).max(5).optional(),
    productId: objectIdSchema.optional(),
    search: searchQuerySchema,
    sortBy: sortFieldSchema(["createdAt", "rating", "helpfulCount"], "createdAt"),
    sortOrder: sortOrderSchema,
  })
  .extend(paginationSchema().shape)
  .strict();

export const createReviewSchema = z
  .object({
    rating: z.number().int().min(1, "rating must be at least 1").max(5, "rating must be at most 5"),
    // No `.default("")` here: `requiredString({min:1})
    // .optional().default("")` re-validates its OWN default value against
    // the wrapped min:1 check, so an omitted title (the normal case —
    // ReviewForm.jsx's title field is explicitly labeled optional and
    // sends `title: undefined` when left blank) would be rejected with
    // "must be at least 1 character", defeating the "optional" label.
    // Plain `.optional()` leaves an absent title as `undefined`, which
    // the review model stores as its '' default.
    title: requiredString({ min: 1, max: 120 }).optional(),
    comment: requiredString({ min: 1, max: 2000 }),
    images: z.array(urlSchema).max(6, "at most 6 images").optional().default([]),
  })
  .strict();

export const updateReviewSchema = createReviewSchema.partial();

export const replyToReviewSchema = z
  .object({
    text: requiredString({ min: 1, max: 2000 }),
  })
  .strict();
