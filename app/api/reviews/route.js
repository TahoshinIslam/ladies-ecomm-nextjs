import { NextResponse } from "next/server";

import { requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { listAllReviews } from "../../../services/reviewService.js";
import { withRoute } from "../../../lib/http.js";

export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.REVIEWS_MANAGE);
  const { searchParams } = new URL(request.url);
  const result = await listAllReviews({
    page: searchParams.get("page") || undefined,
    limit: searchParams.get("limit") || undefined,
    rating: searchParams.get("rating") || undefined,
    productId: searchParams.get("productId") || undefined,
    search: searchParams.get("search") || undefined,
    sortBy: searchParams.get("sortBy") || undefined,
    sortOrder: searchParams.get("sortOrder") || undefined,
  });
  return NextResponse.json({ success: true, ...result });
});
