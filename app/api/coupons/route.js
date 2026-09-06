import { NextResponse } from "next/server";

import { requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { getAllCoupons, createCoupon } from "../../../services/couponService.js";
import { withRoute } from "../../../lib/http.js";
import { parseJsonBody, parseQuery, z } from "../../../lib/validation.js";
import { createCouponSchema } from "../../../schemas/couponSchemas.js";
import { paginationSchema, searchQuerySchema, sortFieldSchema, sortOrderSchema } from "../../../schemas/commonSchemas.js";

const couponListQuerySchema = z
  .object({
    search: searchQuerySchema,
    status: z.enum(["active", "paused", "expired"]).optional(),
    sortBy: sortFieldSchema(["createdAt", "expiresAt", "usedCount", "code"], "createdAt"),
    sortOrder: sortOrderSchema,
  })
  .extend(paginationSchema().shape)
  .strict();

// GET /api/coupons?search=&status=&sortBy=&sortOrder=&page=&limit=
export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.COUPONS_MANAGE);
  const { searchParams } = new URL(request.url);
  const query = parseQuery(searchParams, couponListQuerySchema);
  const result = await getAllCoupons(query);
  return NextResponse.json({ success: true, ...result });
});

export const POST = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.COUPONS_MANAGE);
  const body = await parseJsonBody(request, createCouponSchema);
  const coupon = await createCoupon(body);
  return NextResponse.json({ success: true, coupon }, { status: 201 });
});
