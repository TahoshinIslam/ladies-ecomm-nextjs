import { NextResponse } from "next/server";

import { requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { getAllCoupons, createCoupon } from "../../../services/couponService.js";
import { withRoute } from "../../../lib/http.js";

// GET /api/coupons?search=&status=&sortBy=&sortOrder=&page=&limit=
export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.COUPONS_MANAGE);
  const { searchParams } = new URL(request.url);
  const result = await getAllCoupons({
    page: searchParams.get("page") || 1,
    limit: searchParams.get("limit") || 20,
    search: searchParams.get("search") || undefined,
    status: searchParams.get("status") || undefined,
    sortBy: searchParams.get("sortBy") || undefined,
    sortOrder: searchParams.get("sortOrder") || undefined,
  });
  return NextResponse.json({ success: true, ...result });
});

export const POST = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.COUPONS_MANAGE);
  const body = await request.json();
  const coupon = await createCoupon(body);
  return NextResponse.json({ success: true, coupon }, { status: 201 });
});
