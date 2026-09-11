import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { withRoute } from "../../../../lib/http.js";
import { parseQuery } from "../../../../lib/validation.js";
import { salesSeriesQuerySchema } from "../../../../schemas/adminSchemas.js";
import { getCachedSalesSeries } from "../../../../lib/serverDataCache.js";

export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.DASHBOARD_VIEW);
  const { searchParams } = new URL(request.url);
  const { days } = parseQuery(searchParams, salesSeriesQuerySchema);
  const result = await getCachedSalesSeries(days);
  return NextResponse.json({ success: true, ...result });
});
