import { NextResponse } from "next/server";

import { requirePermission } from "../../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../../lib/permissions.js";
import { replyToReview } from "../../../../../services/reviewService.js";
import { withRoute } from "../../../../../lib/http.js";
import { parseJsonBody } from "../../../../../lib/validation.js";
import { replyToReviewSchema } from "../../../../../schemas/reviewSchemas.js";

export const POST = withRoute(async (request, { params }) => {
  const admin = await requirePermission(request, PERMISSIONS.REVIEWS_MANAGE);
  const { id } = await params;
  const { text } = await parseJsonBody(request, replyToReviewSchema);
  // No cache invalidation here on purpose: a staff reply changes neither
  // the product's rating/numReviews (models/reviewModel.js's
  // calcAverageRating only runs on review save/delete of the review
  // itself, not its adminReply) nor anything else this cache layer
  // holds — this app has no separate cached review-list read (the
  // storefront's review list is fetched client-side, uncached, out of
  // Phase 8's scope). Considered and intentionally a no-op, not an
  // oversight.
  const review = await replyToReview(id, admin._id, text);
  return NextResponse.json({ success: true, review });
});
