import { NextResponse } from "next/server";

import { getProductsByIds } from "../../../../services/productService.js";
import { withRoute } from "../../../../lib/http.js";
import { getServerLocale } from "../../../../lib/i18n/server.js";
import { localizeProductList } from "../../../../lib/i18n/localize.js";
import { parseQuery } from "../../../../lib/validation.js";
import { productBatchQuerySchema } from "../../../../schemas/catalogSchemas.js";

// Powers Recently Viewed: one batch query for however many ids the
// visitor's own localStorage history holds, instead of one request per
// card. Public — same trust level as GET /api/products itself.
export const GET = withRoute(async (request) => {
  const { ids } = parseQuery(new URL(request.url).searchParams, productBatchQuerySchema);
  const [products, locale] = await Promise.all([getProductsByIds(ids), getServerLocale()]);
  return NextResponse.json({ success: true, products: localizeProductList(products, locale) });
});
