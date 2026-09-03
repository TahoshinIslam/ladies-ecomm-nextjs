import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { getOverview } from "../../../../services/analyticsService.js";
import { withRoute } from "../../../../lib/http.js";

export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.DASHBOARD_VIEW);
  const overview = await getOverview();
  return NextResponse.json({ success: true, overview });
});
