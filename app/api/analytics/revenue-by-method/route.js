import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { getRevenueByMethod } from "../../../../services/analyticsService.js";
import { withRoute } from "../../../../lib/http.js";

export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.DASHBOARD_VIEW);
  const data = await getRevenueByMethod();
  return NextResponse.json({ success: true, data });
});
