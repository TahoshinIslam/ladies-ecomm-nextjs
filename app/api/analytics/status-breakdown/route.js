import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { withRoute } from "../../../../lib/http.js";
import { getCachedStatusBreakdown } from "../../../../lib/serverDataCache.js";

export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.DASHBOARD_VIEW);
  const data = await getCachedStatusBreakdown();
  return NextResponse.json({ success: true, data });
});
