import { NextResponse } from "next/server";

import { requireUser } from "../../../../../lib/auth.js";
import { removeCartItem } from "../../../../../services/cartService.js";
import { withRoute } from "../../../../../lib/http.js";

// Route params are async in Next.js 16 and must be awaited.
export const DELETE = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { productId, variantId } = await params;
  const cart = await removeCartItem(user._id, productId, variantId);
  return NextResponse.json({ success: true, cart });
});
