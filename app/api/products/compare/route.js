import { NextResponse } from "next/server";

import { getCompareProducts } from "../../../../services/productService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseQuery } from "../../../../lib/validation.js";
import { productCompareQuerySchema } from "../../../../schemas/catalogSchemas.js";

export const GET = withRoute(async (request) => {
  const { ids } = parseQuery(new URL(request.url).searchParams, productCompareQuerySchema);
  const products = await getCompareProducts(ids);
  return NextResponse.json({ success: true, products });
});
