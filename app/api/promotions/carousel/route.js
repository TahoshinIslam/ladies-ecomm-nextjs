import { NextResponse } from "next/server";

import { getSessionUser } from "../../../../lib/auth.js";
import { getCachedEligiblePromotions } from "../../../../lib/serverDataCache.js";
import { filterByAudience } from "../../../../services/promotionService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseQuery } from "../../../../lib/validation.js";
import { publicPromotionQuerySchema } from "../../../../schemas/promotionSchemas.js";

// GET /api/promotions/carousel?pageScope=home — public, no permission
// required. The cached read (getCachedEligiblePromotions) is audience-
// blind by design; the session lookup and audience filter below run fresh
// on every request and are never part of the cached value — see
// services/promotionService.js's own comment for why.
export const GET = withRoute(async (request) => {
  const { searchParams } = new URL(request.url);
  const { pageScope } = parseQuery(searchParams, publicPromotionQuerySchema);

  const [user, promotions] = await Promise.all([
    getSessionUser(request),
    getCachedEligiblePromotions("carousel", "home_hero", pageScope),
  ]);

  const eligible = filterByAudience(promotions, Boolean(user));
  return NextResponse.json({ success: true, promotions: eligible });
});
