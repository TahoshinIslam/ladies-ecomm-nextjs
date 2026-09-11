import { NextResponse } from "next/server";

import { withRoute } from "../../../../../lib/http.js";
import { getServerLocale } from "../../../../../lib/i18n/server.js";
import { localizeProductList } from "../../../../../lib/i18n/localize.js";
import { parseQuery } from "../../../../../lib/validation.js";
import { relatedQuerySchema } from "../../../../../schemas/catalogSchemas.js";
import { getCachedRelatedProducts } from "../../../../../lib/serverDataCache.js";

// Route params are async in Next.js 16 and must be awaited. `idOrSlug`
// itself is validated inside listRelated() -> getProductByIdOrSlug(), which
// already branches on mongoose.isValidObjectId() vs. a slug lookup — no
// separate schema needed for that half of the path param.
export const GET = withRoute(async (request, { params }) => {
  const { idOrSlug } = await params;
  const { limit } = parseQuery(new URL(request.url).searchParams, relatedQuerySchema);
  const [products, locale] = await Promise.all([
    getCachedRelatedProducts(idOrSlug, limit),
    getServerLocale(),
  ]);
  const localized = localizeProductList(products, locale);
  return NextResponse.json({ success: true, count: localized.length, products: localized });
});
