import { NextResponse } from "next/server";

import { requireUser } from "../../../../../lib/auth.js";
import { codCreate } from "../../../../../services/paymentService.js";
import { withRoute } from "../../../../../lib/http.js";
import { invalidateCacheTags } from "../../../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../../../lib/cacheTags.js";

export const POST = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { orderId } = await params;
  // codCreate() is guarded/atomic against duplicate Payment rows (see
  // services/paymentService.js) but its return value doesn't currently
  // distinguish a genuine new Payment from a replay/duplicate-resolved
  // one — invalidating unconditionally here is a harmless, redundant
  // cache purge on replay, not a correctness issue (see this app's own
  // documented tolerance for that tradeoff over adding complexity to
  // reliably detect it).
  const order = await codCreate(orderId, user._id);
  invalidateCacheTags([CACHE_TAGS.ADMIN_ANALYTICS]);
  return NextResponse.json({ success: true, order });
});
