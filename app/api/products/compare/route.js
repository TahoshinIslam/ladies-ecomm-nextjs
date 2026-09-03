import { NextResponse } from "next/server";

import { getCompareProducts } from "../../../../services/productService.js";
import { withRoute } from "../../../../lib/http.js";

export const GET = withRoute(async (request) => {
  const ids = new URL(request.url).searchParams.get("ids");
  const products = await getCompareProducts(ids);
  return NextResponse.json({ success: true, products });
});
