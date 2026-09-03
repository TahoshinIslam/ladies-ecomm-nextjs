import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/auth.js";
import { toggleWishlist } from "../../../../services/wishlistService.js";
import { withRoute } from "../../../../lib/http.js";

// Route params are async in Next.js 16 and must be awaited.
export const POST = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { productId } = await params;
  const { added, wishlist } = await toggleWishlist(user._id, productId);
  return NextResponse.json({ success: true, added, wishlist });
});
