import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/auth.js";
import { validateCoupon } from "../../../../services/couponService.js";
import { withRoute } from "../../../../lib/http.js";
import { enforceRateLimit } from "../../../../lib/rateLimit.js";
import { COUPON_VALIDATE_USER_LIMIT, COUPON_VALIDATE_USER_WINDOW_MS } from "../../../../lib/rateLimitConfig.js";

export const POST = withRoute(async (request) => {
  const user = await requireUser(request);

  // Per authenticated user — the identity here is the user's own _id, not
  // the coupon code itself, so a blocked response never differs based on
  // whether the coupon being probed exists (the limiter runs before
  // validateCoupon() is ever called, and its 429 body carries nothing
  // coupon-specific).
  await enforceRateLimit([{ identity: String(user._id), action: "coupon-validate:user", limit: COUPON_VALIDATE_USER_LIMIT, windowMs: COUPON_VALIDATE_USER_WINDOW_MS }]);

  const { code, subtotal } = await request.json();
  const result = await validateCoupon(code, subtotal);
  return NextResponse.json({ success: true, ...result });
});
