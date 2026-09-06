import { NextResponse } from "next/server";

import { requireUser } from "../../../lib/auth.js";
import { getCart, addToCart, updateCartItem, clearCart } from "../../../services/cartService.js";
import { withRoute } from "../../../lib/http.js";
import { parseJsonBody } from "../../../lib/validation.js";
import { addToCartSchema, updateCartItemSchema } from "../../../schemas/cartSchemas.js";

export const GET = withRoute(async (request) => {
  const user = await requireUser(request);
  const cart = await getCart(user._id);
  return NextResponse.json({ success: true, cart });
});

export const POST = withRoute(async (request) => {
  const user = await requireUser(request);
  const { productId, variantId, quantity } = await parseJsonBody(request, addToCartSchema);
  const cart = await addToCart(user._id, productId, variantId, quantity);
  return NextResponse.json({ success: true, cart });
});

export const PUT = withRoute(async (request) => {
  const user = await requireUser(request);
  const { productId, variantId, quantity } = await parseJsonBody(request, updateCartItemSchema);
  const cart = await updateCartItem(user._id, productId, variantId, quantity);
  return NextResponse.json({ success: true, cart });
});

export const DELETE = withRoute(async (request) => {
  const user = await requireUser(request);
  const cart = await clearCart(user._id);
  return NextResponse.json({ success: true, cart });
});
