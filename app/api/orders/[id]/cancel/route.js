import { NextResponse } from "next/server";

import { requireUser } from "../../../../../lib/auth.js";
import { cancelOrder } from "../../../../../services/orderService.js";
import { withRoute } from "../../../../../lib/http.js";

export const POST = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { id } = await params;
  const order = await cancelOrder(user._id, user.role, id);
  return NextResponse.json({ success: true, order });
});
