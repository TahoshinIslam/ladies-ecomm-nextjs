import { NextResponse } from "next/server";

import { requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { listPromotionsAdmin, createPromotion } from "../../../services/promotionService.js";
import { withRoute } from "../../../lib/http.js";
import { parseJsonBody, parseQuery } from "../../../lib/validation.js";
import { createPromotionSchema, promotionListQuerySchema } from "../../../schemas/promotionSchemas.js";
import { invalidateCacheTags } from "../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../lib/cacheTags.js";

// GET /api/promotions?type=&status=  (admin list — both tabs read this)
export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.PROMOTIONS_MANAGE);
  const { searchParams } = new URL(request.url);
  const query = parseQuery(searchParams, promotionListQuerySchema);
  const promotions = await listPromotionsAdmin(query);
  return NextResponse.json({ success: true, promotions });
});

export const POST = withRoute(async (request) => {
  const user = await requirePermission(request, PERMISSIONS.PROMOTIONS_MANAGE);
  const body = await parseJsonBody(request, createPromotionSchema);
  const promotion = await createPromotion(body, user._id);
  invalidateCacheTags([CACHE_TAGS.PROMOTIONS, CACHE_TAGS.PROMOTIONS_CAROUSEL, CACHE_TAGS.PROMOTIONS_POPUP]);
  return NextResponse.json({ success: true, promotion }, { status: 201 });
});
