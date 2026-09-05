import { z } from "zod";

import { objectIdSchema, quantitySchema, requiredString, paginationSchema, searchQuerySchema, sortFieldSchema, sortOrderSchema } from "./commonSchemas.js";
import { shippingAddressFields } from "./addressSchemas.js";

export const ORDER_STATUSES = ["pending", "paid", "processing", "shipped", "delivered", "cancelled", "refunded"];

// PUT /api/orders/[id]/status (admin) — `.strict()` since this directly
// writes model fields; an admin should only ever be able to set exactly
// these two.
export const updateOrderStatusSchema = z
  .object({
    status: z.enum(ORDER_STATUSES),
    trackingNumber: z.string().trim().max(100).optional(),
  })
  .strict();

// GET /api/orders (admin list) — Phase 5 fix for the confirmed
// `?limit=999999` unbounded-query defect (services/orderService.js's
// getAllOrders() passed `Number(limit)` straight into Mongoose's
// `.limit()` with no upper bound at all).
export const adminOrderListQuerySchema = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    search: searchQuerySchema,
    sortBy: sortFieldSchema(["createdAt", "total", "status"], "createdAt"),
    sortOrder: sortOrderSchema,
  })
  .extend(paginationSchema().shape)
  .strict();

// Deliberately NOT `.strict()` anywhere in this file (unlike most other
// schemas/*.js files): a client-submitted `price`/`total`/`subtotal`/
// `status`/`userId` field is silently STRIPPED, not rejected — this is an
// established, tested contract (tests/orderTransactions.test.mjs's
// "server-side price recalculation" test), since every price and the
// order's status are always server-computed by calcTotals()/createOrder()
// regardless of anything the client sends. There is nothing to protect
// here the way `.strict()` protects e.g. schemas/authSchemas.js's
// updateMeSchema against role/permission mass-assignment — an extra field
// on an order body is simply never read.
const orderItemSchema = z.object({
  productId: objectIdSchema,
  variantId: objectIdSchema,
  quantity: quantitySchema,
});

// A real cart/order has no legitimate reason to carry hundreds of distinct
// line items — bounded to stop a single request from forcing calcTotals()
// to loop over an unbounded array of Product lookups.
const orderItemsSchema = z.array(orderItemSchema).min(1, "at least one item is required").max(100, "too many items");

export const createOrderSchema = z.object({
  items: orderItemsSchema,
  shippingAddress: z.object(shippingAddressFields),
  shippingTier: z.string().trim().max(100).optional().default(""),
  couponCode: z
    .union([z.literal(""), z.string().trim().max(30)])
    .optional()
    .transform((v) => (v ? v.toUpperCase() : undefined)),
  notes: requiredString({ min: 0, max: 1000 }).optional().default(""),
});

// Preview only needs a country to compute region/shipping/tax — the full
// address isn't required yet (mirrors services/orderService.js's
// previewOrder(), which only checks `shippingAddress?.country`).
export const previewOrderSchema = z.object({
  items: orderItemsSchema,
  shippingAddress: z
    .object(shippingAddressFields)
    .partial()
    .refine((addr) => !!addr.country, { message: "country is required", path: ["country"] }),
  shippingTier: z.string().trim().max(100).optional().default(""),
  couponCode: z
    .union([z.literal(""), z.string().trim().max(30)])
    .optional()
    .transform((v) => (v ? v.toUpperCase() : undefined)),
});
