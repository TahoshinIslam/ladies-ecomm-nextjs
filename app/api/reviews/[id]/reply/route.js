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
  const review = await replyToReview(id, admin._id, text);
  return NextResponse.json({ success: true, review });
});
