import { NextResponse } from "next/server";

import { requireUser } from "../../../../../lib/auth.js";
import { cancelOrder } from "../../../../../services/orderService.js";
import { withRoute } from "../../../../../lib/http.js";
import { invalidateCacheTags } from "../../../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../../../lib/cacheTags.js";

export const POST = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { id } = await params;
  // cancelOrder() throws (and its transaction rolls back) for any
  // forbidden status transition — reaching the line below means stock was
  // genuinely restored inside a committed transaction.
  const order = await cancelOrder(user._id, user.role, id);
  invalidateCacheTags([CACHE_TAGS.CATALOG, CACHE_TAGS.ADMIN_ANALYTICS]);
  return NextResponse.json({ success: true, order });
});
