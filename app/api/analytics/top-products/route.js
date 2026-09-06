import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { getTopProducts } from "../../../../services/analyticsService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseQuery } from "../../../../lib/validation.js";
import { topProductsQuerySchema } from "../../../../schemas/adminSchemas.js";

export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.DASHBOARD_VIEW);
  const { searchParams } = new URL(request.url);
  const { limit } = parseQuery(searchParams, topProductsQuerySchema);
  const products = await getTopProducts(limit);
  return NextResponse.json({ success: true, count: products.length, products });
});
