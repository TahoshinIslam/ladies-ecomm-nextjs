import { z } from "zod";

import { requiredString, urlSchema, paginationSchema, searchQuerySchema, sortFieldSchema, sortOrderSchema, objectIdSchema } from "./commonSchemas.js";

// GET /api/reviews/product/[productId] — Phase 5 fix for the confirmed
// unclamped `limit` (services/reviewService.js's getProductReviews()
// passed `Number(limit)` straight into `.limit()`).
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
    title: requiredString({ min: 1, max: 120 }).optional().default(""),
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
