import { NextResponse } from "next/server";

import { getSessionUser } from "../../../../lib/auth.js";
import { getCachedEligiblePromotions } from "../../../../lib/serverDataCache.js";
import { filterByAudience } from "../../../../services/promotionService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseQuery } from "../../../../lib/validation.js";
import { publicPromotionQuerySchema } from "../../../../schemas/promotionSchemas.js";

// GET /api/promotions/popup?pageScope=home — public. Returns AT MOST one
// promotion (never multiple campaign popups at once): the underlying query
// (services/promotionService.js's getEligiblePromotionsBase) already sorts
// by priority desc / startAt desc / _id asc for `type: "popup"`, so the
// first eligible result after this request's own audience filter is the
// single campaign CampaignPopup.jsx may show.
export const GET = withRoute(async (request) => {
  const { searchParams } = new URL(request.url);
  const { pageScope } = parseQuery(searchParams, publicPromotionQuerySchema);

  const [user, promotions] = await Promise.all([
    getSessionUser(request),
    getCachedEligiblePromotions("popup", "storefront_popup", pageScope),
  ]);

  const eligible = filterByAudience(promotions, Boolean(user));
  return NextResponse.json({ success: true, promotion: eligible[0] || null });
});
