import { NextResponse } from "next/server";

import { requireUser } from "../../../../../lib/auth.js";
import { getProductReviews, createReview } from "../../../../../services/reviewService.js";
import { withRoute } from "../../../../../lib/http.js";

export const GET = withRoute(async (request, { params }) => {
  const { productId } = await params;
  const { searchParams } = new URL(request.url);
  const result = await getProductReviews(productId, {
    page: searchParams.get("page") || undefined,
    limit: searchParams.get("limit") || undefined,
  });
  return NextResponse.json({ success: true, ...result });
});

export const POST = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { productId } = await params;
  const body = await request.json();
  const review = await createReview(user._id, productId, body);
  return NextResponse.json({ success: true, review }, { status: 201 });
});
