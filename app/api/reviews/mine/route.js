import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/auth.js";
import { getMyReviewProducts } from "../../../../services/reviewService.js";
import { withRoute } from "../../../../lib/http.js";

// Backs the account "Reviews" page's sidebar entry — every product this
// signed-in shopper can review (delivered, not yet rated) and every
// review they've already left, in one request.
export const GET = withRoute(async (request) => {
  const user = await requireUser(request);
  const result = await getMyReviewProducts(user._id);
  return NextResponse.json({ success: true, ...result });
});
