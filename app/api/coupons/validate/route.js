import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/auth.js";
import { validateCoupon } from "../../../../services/couponService.js";
import { withRoute } from "../../../../lib/http.js";

export const POST = withRoute(async (request) => {
  await requireUser(request);
  const { code, subtotal } = await request.json();
  const result = await validateCoupon(code, subtotal);
  return NextResponse.json({ success: true, ...result });
});
