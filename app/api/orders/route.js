import { NextResponse } from "next/server";

import { requireUser, requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { createOrder, getAllOrders } from "../../../services/orderService.js";
import { withRoute } from "../../../lib/http.js";
import { readIdempotencyKey } from "../../../lib/idempotency.js";

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
  // Read/validate the key before touching the body — auth and CSRF/Origin
  // (withRoute) still run first either way, this just fails cheaply on a
  // missing/malformed key before any JSON parsing or DB work happens.
  const idempotencyKey = readIdempotencyKey(request);
  const body = await request.json();
  const { order, replayed } = await createOrder(user._id, body, idempotencyKey);
  return NextResponse.json(
    { success: true, order },
    {
      status: replayed ? 200 : 201,
      headers: replayed ? { "Idempotency-Replayed": "true" } : undefined,
    },
  );
});
