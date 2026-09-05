import { NextResponse } from "next/server";

import { requireUser, requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { createOrder, getAllOrders } from "../../../services/orderService.js";
import { withRoute } from "../../../lib/http.js";
import { readIdempotencyKey } from "../../../lib/idempotency.js";
import { parseJsonBody, parseQuery } from "../../../lib/validation.js";
import { adminOrderListQuerySchema, createOrderSchema } from "../../../schemas/orderSchemas.js";

// Admin list — GET /api/orders?status=&search=&sortBy=&sortOrder=&page=&limit=
export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.ORDERS_VIEW);
  const { searchParams } = new URL(request.url);
  const query = parseQuery(searchParams, adminOrderListQuerySchema);
  const result = await getAllOrders(query);
  return NextResponse.json({ success: true, ...result });
});

export const POST = withRoute(async (request) => {
  const user = await requireUser(request);
  // Read/validate the key before touching the body — auth and CSRF/Origin
  // (withRoute) still run first either way, this just fails cheaply on a
  // missing/malformed key before any JSON parsing or DB work happens.
  const idempotencyKey = readIdempotencyKey(request);
  // Phase 5 idempotency integration (section I): the body is validated and
  // NORMALIZED here (trimmed strings, coupon code uppercased, defaults
  // applied) before it ever reaches createOrder() — the Phase 4 request
  // fingerprint is computed from this same normalized shape, so two
  // semantically-equivalent requests (e.g. differing only in incidental
  // whitespace) hash identically, while a genuinely different order still
  // produces a different fingerprint. An invalid body throws here, before
  // any idempotency lookup/creation ever runs.
  const body = await parseJsonBody(request, createOrderSchema);
  const { order, replayed } = await createOrder(user._id, body, idempotencyKey);
  return NextResponse.json(
    { success: true, order },
    {
      status: replayed ? 200 : 201,
      headers: replayed ? { "Idempotency-Replayed": "true" } : undefined,
    },
  );
});
