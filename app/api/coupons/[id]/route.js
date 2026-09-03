import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { updateCoupon, deleteCoupon } from "../../../../services/couponService.js";
import { withRoute } from "../../../../lib/http.js";

export const PUT = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.COUPONS_MANAGE);
  const { id } = await params;
  const body = await request.json();
  const coupon = await updateCoupon(id, body);
  return NextResponse.json({ success: true, coupon });
});

export const DELETE = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.COUPONS_MANAGE);
  const { id } = await params;
  await deleteCoupon(id);
  return NextResponse.json({ success: true, message: "Coupon deleted" });
});
