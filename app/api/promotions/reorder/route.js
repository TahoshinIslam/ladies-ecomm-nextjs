import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { reorderPromotions } from "../../../../services/promotionService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseJsonBody } from "../../../../lib/validation.js";
import { reorderPromotionSchema } from "../../../../schemas/promotionSchemas.js";
import { invalidateCacheTags } from "../../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../../lib/cacheTags.js";

// POST /api/promotions/reorder  { type, order: [id, id, ...] }
export const POST = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.PROMOTIONS_MANAGE);
  const { type, order } = await parseJsonBody(request, reorderPromotionSchema);
  const promotions = await reorderPromotions(type, order);
  invalidateCacheTags(
    type === "popup"
      ? [CACHE_TAGS.PROMOTIONS, CACHE_TAGS.PROMOTIONS_POPUP]
      : [CACHE_TAGS.PROMOTIONS, CACHE_TAGS.PROMOTIONS_CAROUSEL],
  );
  return NextResponse.json({ success: true, promotions });
});
