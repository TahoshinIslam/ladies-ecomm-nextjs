import { NextResponse } from "next/server";

import { listProducts, parseProductListQuery } from "../../../services/productService.js";
import { withRoute, parseQueryParams } from "../../../lib/http.js";
import { getServerLocale } from "../../../lib/i18n/server.js";
import { localizeProductList } from "../../../lib/i18n/localize.js";
import { assertNoDuplicateQueryKeys, assertNoDangerousQueryKeys } from "../../../lib/validation.js";

import { getCachedProductList } from "../../../lib/serverDataCache.js";
import { getShopCacheKey } from "../../../lib/shopCacheEligibility.js";
import { getOrganizationId } from "../../../lib/tenant.js";

export const GET = withRoute(async (request) => {
  const { searchParams } = new URL(request.url);
  assertNoDuplicateQueryKeys(searchParams);
  assertNoDangerousQueryKeys(searchParams);
  const rawQuery = parseQueryParams(searchParams);
  const query = await parseProductListQuery(rawQuery);

  // This is the shop page's own listing/filter/paginate endpoint — the
  // single most-hit product read in the app — yet it never went through
  // lib/serverDataCache.js's cache, unlike the identically-shaped queries
  // the home page's server render already caches (see HomePage.jsx). Same
  // eligibility policy here: a bounded/canonical query (no free-text
  // search, no dynamic attribute facet) is cache-eligible; anything else
  // falls straight through to the real, uncached read exactly as before.
  const cacheKey = getShopCacheKey(query, { organizationId: getOrganizationId() });
  const [result, locale] = await Promise.all([
    cacheKey ? getCachedProductList(query, cacheKey, { includeFacets: true }) : listProducts(query),
    getServerLocale(),
  ]);
  // Always locale-resolved now. The unresolved branch existed for the admin
  // product table, which needed English and Bangla side by side so an editor
  // could never re-save nameBn into the English field. There is no admin
  // caller left, and the dashboard reads the database directly rather than
  // through this route.
  return NextResponse.json({
    success: true,
    ...result,
    products: localizeProductList(result.products, locale),
  });
});

// The staff-gated handler that used to live here (POST) went with the
// admin section: creating and editing the catalog is the dashboard's job now,
// and it writes an audit trail this app never did. The public handler above
// remains what the storefront actually needs.
