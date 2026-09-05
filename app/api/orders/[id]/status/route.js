import { NextResponse } from "next/server";

import { requirePermission } from "../../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../../lib/permissions.js";
import { updateOrderStatus } from "../../../../../services/orderService.js";
import { withRoute } from "../../../../../lib/http.js";
import { parseJsonBody } from "../../../../../lib/validation.js";
import { updateOrderStatusSchema } from "../../../../../schemas/orderSchemas.js";

export const PUT = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.ORDERS_MANAGE);
  const { id } = await params;
  const body = await parseJsonBody(request, updateOrderStatusSchema);
  const order = await updateOrderStatus(id, body);
  return NextResponse.json({ success: true, order });
});
