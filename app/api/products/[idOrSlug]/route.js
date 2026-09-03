import { NextResponse } from "next/server";

import { requireAdmin } from "../../../../lib/auth.js";
import {
  getProductByIdOrSlug,
  updateProduct,
  deleteProduct,
} from "../../../../services/productService.js";
import { withRoute } from "../../../../lib/http.js";

// Route params are async in Next.js 16 and must be awaited.
export const GET = withRoute(async (request, { params }) => {
  const { idOrSlug } = await params;
  const product = await getProductByIdOrSlug(idOrSlug);
  return NextResponse.json({ success: true, product });
});

export const PUT = withRoute(async (request, { params }) => {
  await requireAdmin(request);
  const { idOrSlug } = await params;
  const body = await request.json();
  const product = await updateProduct(idOrSlug, body);
  return NextResponse.json({ success: true, product });
});

export const DELETE = withRoute(async (request, { params }) => {
  await requireAdmin(request);
  const { idOrSlug } = await params;
  await deleteProduct(idOrSlug);
  return NextResponse.json({ success: true, message: "Product deactivated" });
});
