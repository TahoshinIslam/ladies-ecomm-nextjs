import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/auth.js";
import { updateReview, deleteReview } from "../../../../services/reviewService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseJsonBody } from "../../../../lib/validation.js";
import { updateReviewSchema } from "../../../../schemas/reviewSchemas.js";

export const PUT = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { id } = await params;
  const body = await parseJsonBody(request, updateReviewSchema);
  const review = await updateReview(id, user, body);
  return NextResponse.json({ success: true, review });
});

export const DELETE = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { id } = await params;
  await deleteReview(id, user);
  return NextResponse.json({ success: true, message: "Review deleted" });
});
