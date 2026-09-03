import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { getSalesSeries } from "../../../../services/analyticsService.js";
import { withRoute } from "../../../../lib/http.js";

export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.DASHBOARD_VIEW);
  const { searchParams } = new URL(request.url);
  const result = await getSalesSeries(searchParams.get("days"));
  return NextResponse.json({ success: true, ...result });
});
