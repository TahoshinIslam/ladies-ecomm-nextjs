import { NextResponse } from "next/server";

import { listFeatured } from "../../../../services/productService.js";
import { withRoute } from "../../../../lib/http.js";

export const GET = withRoute(async () => {
  const products = await listFeatured();
  return NextResponse.json({ success: true, count: products.length, products });
});
