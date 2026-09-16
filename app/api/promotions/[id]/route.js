import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { updatePromotion, deletePromotion } from "../../../../services/promotionService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseJsonBody } from "../../../../lib/validation.js";
import { updatePromotionSchema } from "../../../../schemas/promotionSchemas.js";
import { invalidateCacheTags } from "../../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../../lib/cacheTags.js";

const PROMOTION_TAGS = [CACHE_TAGS.PROMOTIONS, CACHE_TAGS.PROMOTIONS_CAROUSEL, CACHE_TAGS.PROMOTIONS_POPUP];

export const PUT = withRoute(async (request, { params }) => {
  const user = await requirePermission(request, PERMISSIONS.PROMOTIONS_MANAGE);
  const { id } = await params;
  const body = await parseJsonBody(request, updatePromotionSchema);
  const promotion = await updatePromotion(id, body, user._id);
  invalidateCacheTags(PROMOTION_TAGS);
  return NextResponse.json({ success: true, promotion });
});

export const DELETE = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.PROMOTIONS_MANAGE);
  const { id } = await params;
  await deletePromotion(id);
  invalidateCacheTags(PROMOTION_TAGS);
  return NextResponse.json({ success: true, message: "Promotion deleted" });
});
