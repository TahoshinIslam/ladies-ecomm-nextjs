import { NextResponse } from "next/server";

import { requireUser } from "../../../../../lib/auth.js";
import { markHelpful } from "../../../../../services/reviewService.js";
import { withRoute } from "../../../../../lib/http.js";

export const POST = withRoute(async (request, { params }) => {
  await requireUser(request);
  const { id } = await params;
  // No cache invalidation: helpfulCount isn't part of the cached product
  // document or any other Phase 8 cache entry — considered, intentional
  // no-op, not an oversight (see the reply route's identical reasoning).
  const helpfulCount = await markHelpful(id);
  return NextResponse.json({ success: true, helpfulCount });
});
