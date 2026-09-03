import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/auth.js";
import { getMyOrders } from "../../../../services/orderService.js";
import { withRoute } from "../../../../lib/http.js";

export const GET = withRoute(async (request) => {
  const user = await requireUser(request);
  const orders = await getMyOrders(user._id);
  return NextResponse.json({ success: true, count: orders.length, orders });
});
