import { NextResponse } from "next/server";

import { requireUser } from "../../../../../lib/auth.js";
import { codCreate } from "../../../../../services/paymentService.js";
import { withRoute } from "../../../../../lib/http.js";

export const POST = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { orderId } = await params;
  const order = await codCreate(orderId, user._id);
  return NextResponse.json({ success: true, order });
});
