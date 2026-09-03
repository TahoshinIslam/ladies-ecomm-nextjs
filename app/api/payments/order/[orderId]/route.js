import { NextResponse } from "next/server";

import { requireUser } from "../../../../../lib/auth.js";
import { getPaymentByOrder } from "../../../../../services/paymentService.js";
import { withRoute } from "../../../../../lib/http.js";

export const GET = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { orderId } = await params;
  const payment = await getPaymentByOrder(orderId, user._id, user.role);
  return NextResponse.json({ success: true, payment });
});
