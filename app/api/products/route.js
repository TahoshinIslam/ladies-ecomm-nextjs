import { NextResponse } from "next/server";

import { getSessionUser, requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { listProducts, createProduct, parseProductListQuery } from "../../../services/productService.js";
import { withRoute, parseQueryParams } from "../../../lib/http.js";
import { getServerLocale } from "../../../lib/i18n/server.js";
import { localizeProductList } from "../../../lib/i18n/localize.js";
import { parseJsonBody, assertNoDuplicateQueryKeys, assertNoDangerousQueryKeys } from "../../../lib/validation.js";
import { createProductSchema } from "../../../schemas/catalogSchemas.js";
import { invalidateCacheTags } from "../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../lib/cacheTags.js";
import { getCachedProductList } from "../../../lib/serverDataCache.js";
import { getShopCacheKey } from "../../../lib/shopCacheEligibility.js";

export const GET = withRoute(async (request) => {
  const user = await getSessionUser(request).catch(() => null);
  const isAdmin = user?.role === "admin";
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
  // search, no dynamic attribute facet, non-admin) is cache-eligible;
  // anything else falls straight through to the real, uncached read exactly
  // as before.
  const cacheKey = !isAdmin ? getShopCacheKey(query, { isAdmin: false }) : null;
  const [result, locale] = await Promise.all([
    cacheKey ? getCachedProductList(query, cacheKey, { includeFacets: true }) : listProducts(query, { isAdmin }),
    getServerLocale(),
  ]);
  // Admin requests (the products admin table/edit form) always see raw
  // English + Bangla side by side, never a locale-resolved single value —
  // the admin's own browser may well have the Bangla cookie set (it's the
  // default for a first-time visitor), and silently substituting nameBn
  // into `name` here would let an admin re-save it as the English field,
  // corrupting real product data. Only the real storefront response is
  // ever locale-resolved.
  return NextResponse.json({
    success: true,
    ...result,
    products: isAdmin ? result.products : localizeProductList(result.products, locale),
  });
});

export const POST = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.PRODUCTS_MANAGE);
  const body = await parseJsonBody(request, createProductSchema);
  const product = await createProduct(body);
  // A newly created product can change every product-list-shaped cached
  // read (home sections, shop listing) — invalidated only after the
  // write above has actually committed.
  invalidateCacheTags([CACHE_TAGS.CATALOG]);
  return NextResponse.json({ success: true, product }, { status: 201 });
});
