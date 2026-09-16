import { NextResponse } from "next/server";

import { requirePermission } from "../../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../../lib/permissions.js";
import { duplicatePromotion } from "../../../../../services/promotionService.js";
import { withRoute } from "../../../../../lib/http.js";
import { invalidateCacheTags } from "../../../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../../../lib/cacheTags.js";

// POST /api/promotions/[id]/duplicate — clones as a draft (never
// auto-activates a copy), always ends its own review cycle before going
// live. No cache invalidation needed on its own since a new draft is never
// publicly eligible — kept anyway, harmless, in case a future change ever
// lets a duplicate carry over `active` status.
export const POST = withRoute(async (request, { params }) => {
  const user = await requirePermission(request, PERMISSIONS.PROMOTIONS_MANAGE);
  const { id } = await params;
  const promotion = await duplicatePromotion(id, user._id);
  invalidateCacheTags([CACHE_TAGS.PROMOTIONS, CACHE_TAGS.PROMOTIONS_CAROUSEL, CACHE_TAGS.PROMOTIONS_POPUP]);
  return NextResponse.json({ success: true, promotion }, { status: 201 });
});
