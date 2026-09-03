import { NextResponse } from "next/server";

import { listRelated } from "../../../../../services/productService.js";
import { withRoute } from "../../../../../lib/http.js";

// Route params are async in Next.js 16 and must be awaited.
export const GET = withRoute(async (request, { params }) => {
  const { idOrSlug } = await params;
  const products = await listRelated(idOrSlug);
  return NextResponse.json({ success: true, count: products.length, products });
});
