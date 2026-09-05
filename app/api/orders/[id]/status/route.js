import { NextResponse } from "next/server";

import { requirePermission } from "../../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../../lib/permissions.js";
import { updateOrderStatus } from "../../../../../services/orderService.js";
import { withRoute } from "../../../../../lib/http.js";
import { parseJsonBody } from "../../../../../lib/validation.js";
import { updateOrderStatusSchema } from "../../../../../schemas/orderSchemas.js";
import { invalidateCacheTags } from "../../../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../../../lib/cacheTags.js";

export const PUT = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.ORDERS_MANAGE);
  const { id } = await params;
  const body = await parseJsonBody(request, updateOrderStatusSchema);
  const order = await updateOrderStatus(id, body);
  // A status transition always affects order-status-breakdown analytics;
  // it does not touch stock itself (cancellation-with-stock-restoration
  // has its own dedicated route/service — cancelOrder() — this one is a
  // pure status-machine move, see services/orderService.js).
  invalidateCacheTags([CACHE_TAGS.ADMIN_ANALYTICS]);
  return NextResponse.json({ success: true, order });
});
