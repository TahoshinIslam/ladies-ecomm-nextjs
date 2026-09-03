import { NextResponse } from "next/server";

import { requireUser, requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { createOrder, getAllOrders } from "../../../services/orderService.js";
import { withRoute } from "../../../lib/http.js";

// Admin list — GET /api/orders?status=&search=&sortBy=&sortOrder=&page=&limit=
export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.ORDERS_VIEW);
  const { searchParams } = new URL(request.url);
  const result = await getAllOrders({
    status: searchParams.get("status") || undefined,
    search: searchParams.get("search") || undefined,
    sortBy: searchParams.get("sortBy") || undefined,
    sortOrder: searchParams.get("sortOrder") || undefined,
    page: searchParams.get("page") || 1,
    limit: searchParams.get("limit") || 20,
  });
  return NextResponse.json({ success: true, ...result });
});

export const POST = withRoute(async (request) => {
  const user = await requireUser(request);
  const body = await request.json();
  const order = await createOrder(user._id, body);
  return NextResponse.json({ success: true, order }, { status: 201 });
});
