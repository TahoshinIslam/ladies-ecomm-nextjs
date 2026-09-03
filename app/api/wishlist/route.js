import { NextResponse } from "next/server";

import { requireUser } from "../../../lib/auth.js";
import { getWishlist, clearWishlist } from "../../../services/wishlistService.js";
import { withRoute } from "../../../lib/http.js";

export const GET = withRoute(async (request) => {
  const user = await requireUser(request);
  const wishlist = await getWishlist(user._id);
  return NextResponse.json({ success: true, wishlist });
});

export const DELETE = withRoute(async (request) => {
  const user = await requireUser(request);
  await clearWishlist(user._id);
  return NextResponse.json({ success: true, message: "Wishlist cleared" });
});
