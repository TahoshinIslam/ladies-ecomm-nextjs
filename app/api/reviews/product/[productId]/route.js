import { NextResponse } from "next/server";

import { requireUser } from "../../../../../lib/auth.js";
import { getProductReviews, createReview } from "../../../../../services/reviewService.js";
import { withRoute } from "../../../../../lib/http.js";
import { parseJsonBody, parsePathParams, parseQuery, z } from "../../../../../lib/validation.js";
import { productReviewsQuerySchema, createReviewSchema } from "../../../../../schemas/reviewSchemas.js";
import { objectIdSchema } from "../../../../../schemas/commonSchemas.js";
import { invalidateCacheTags } from "../../../../../lib/cacheInvalidation.js";
import { CACHE_TAGS, productTag, reviewsTag } from "../../../../../lib/cacheTags.js";

const productIdParamSchema = z.object({ productId: objectIdSchema });

export const GET = withRoute(async (request, { params }) => {
  const { productId } = parsePathParams(await params, productIdParamSchema);
  const { searchParams } = new URL(request.url);
  const query = parseQuery(searchParams, productReviewsQuerySchema);
  const result = await getProductReviews(productId, query);
  return NextResponse.json({ success: true, ...result });
});

export const POST = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { productId } = parsePathParams(await params, productIdParamSchema);
  const body = await parseJsonBody(request, createReviewSchema);
  const review = await createReview(user._id, productId, body);
  // A new review changes the product's denormalized rating/numReviews
  // (see models/reviewModel.js's post-save calcAverageRating hook) —
  // both of which are part of the cached product document.
  invalidateCacheTags([CACHE_TAGS.CATALOG, productTag(productId), reviewsTag(productId)]);
  return NextResponse.json({ success: true, review }, { status: 201 });
});
