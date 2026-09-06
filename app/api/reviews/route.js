import { NextResponse } from "next/server";

import { requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { listAllReviews } from "../../../services/reviewService.js";
import { withRoute } from "../../../lib/http.js";
import { parseQuery } from "../../../lib/validation.js";
import { adminReviewListQuerySchema } from "../../../schemas/reviewSchemas.js";

export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.REVIEWS_MANAGE);
  const { searchParams } = new URL(request.url);
  const query = parseQuery(searchParams, adminReviewListQuerySchema);
  const result = await listAllReviews(query);
  return NextResponse.json({ success: true, ...result });
});
