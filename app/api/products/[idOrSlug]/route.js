import { NextResponse } from "next/server";

import { withRoute } from "../../../../lib/http.js";
import { getServerLocale } from "../../../../lib/i18n/server.js";
import { localizeProduct } from "../../../../lib/i18n/localize.js";

import { getCachedProductByIdOrSlug } from "../../../../lib/serverDataCache.js";

// Route params are async in Next.js 16 and must be awaited.
export const GET = withRoute(async (request, { params }) => {
  const { idOrSlug } = await params;
  const [product, locale] = await Promise.all([getCachedProductByIdOrSlug(idOrSlug), getServerLocale()]);
  return NextResponse.json({ success: true, product: localizeProduct(product, locale) });
});

// The staff-gated handlers that used to live here (PUT, DELETE) went with the
// admin section: creating and editing the catalog is the dashboard's job now,
// and it writes an audit trail this app never did. The public handlers above
// remain what the storefront actually needs.
