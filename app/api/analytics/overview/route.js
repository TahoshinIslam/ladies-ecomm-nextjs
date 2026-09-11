import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { withRoute } from "../../../../lib/http.js";
import { getCachedOverview } from "../../../../lib/serverDataCache.js";

export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.DASHBOARD_VIEW);
  // Cached (45s TTL, invalidated on every order create/cancel/status-change/
  // COD-payment) — the admin dashboard's own landing-page numbers were
  // hitting several real aggregation queries fresh on every single load,
  // same avoidable-cache-miss pattern already fixed for the storefront.
  const overview = await getCachedOverview();
  return NextResponse.json({ success: true, overview });
});
