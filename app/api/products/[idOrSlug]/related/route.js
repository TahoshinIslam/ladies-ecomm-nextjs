import { NextResponse } from "next/server";

import { listRelated } from "../../../../../services/productService.js";
import { withRoute } from "../../../../../lib/http.js";
import { getServerLocale } from "../../../../../lib/i18n/server.js";
import { localizeProductList } from "../../../../../lib/i18n/localize.js";

// Route params are async in Next.js 16 and must be awaited.
export const GET = withRoute(async (request, { params }) => {
  const { idOrSlug } = await params;
  const limit = new URL(request.url).searchParams.get("limit");
  const [products, locale] = await Promise.all([
    listRelated(idOrSlug, limit || undefined),
    getServerLocale(),
  ]);
  const localized = localizeProductList(products, locale);
  return NextResponse.json({ success: true, count: localized.length, products: localized });
});
