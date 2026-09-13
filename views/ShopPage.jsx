import { headers } from "next/headers";

import ShopPageClient from "./shop/ShopPageClient.jsx";
import connectDB from "../config/db.js";
import { listProducts, parseProductListQuery } from "../services/productService.js";
import { assertNoDuplicateQueryKeys, assertNoDangerousQueryKeys } from "../lib/validation.js";
import { parseQueryParams, HttpError } from "../lib/http.js";
import { serializeForClient } from "../lib/serialize.js";
import { getCachedProductList, getCachedCategories } from "../lib/serverDataCache.js";
import { getShopCacheKey } from "../lib/shopCacheEligibility.js";
import { getServerLocale, getT } from "../lib/i18n/server.js";
import { localizeCategory } from "../lib/i18n/localize.js";
import { absoluteUrl, safeJsonLd } from "../lib/seo.js";
import EmptyState from "../components/ui/EmptyState.jsx";
import { AlertCircle } from "lucide-react";

// Next.js searchParams (a plain `{key: string | string[]}` object) is
// reconstructed into a real URLSearchParams so this Server Component can
// reuse the EXACT same Phase 5 validated query contract GET /api/products
// itself uses (assertNoDuplicateQueryKeys/assertNoDangerousQueryKeys/
// parseQueryParams/parseProductListQuery) — one query contract, two entry
// points, never two implementations to keep in sync.
function toURLSearchParams(rawSearchParams) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(rawSearchParams || {})) {
    if (Array.isArray(value)) {
      for (const v of value) usp.append(key, v);
    } else if (value !== undefined) {
      usp.append(key, value);
    }
  }
  return usp;
}

// Phase 7 — real, search-parameter-driven Server Component: the initial
// product list, total count, and facet counts are all fetched here via
// services/productService.js directly (no fetch back to this app's own
// /api). A malformed/invalid query (the same contract GET /api/products
// enforces) renders a safe, controlled empty state instead of crashing or
// leaking an internal error — never a literal thrown 500.
export default async function ShopPage({ searchParams }) {
  const rawSearchParams = await searchParams;
  const usp = toURLSearchParams(rawSearchParams);

  let result;
  let invalid = false;
  try {
    // Realtime-durability-class fix: the cached branch below now
    // guarantees its own DB readiness (lib/serverDataCache.js's
    // withDb()), but the uncached listProducts() fallback (an
    // ineligible-for-cache query — free-text search, dynamic facets)
    // does not go through that wrapper — establish readiness explicitly
    // here rather than relying on some earlier, unrelated request having
    // already connected on this warm instance.
    await connectDB();
    assertNoDuplicateQueryKeys(usp);
    assertNoDangerousQueryKeys(usp);
    const rawQuery = parseQueryParams(usp);
    const query = await parseProductListQuery(rawQuery);
    // Phase 8 — only a bounded, low-cardinality subset of the (Phase 5)
    // validated query space is cached at all (see lib/shopCacheEligibility
    // .js's own header comment for why: free-text search and dynamic
    // attribute facets are excluded to avoid unbounded cache-key growth).
    // An ineligible query still works correctly — it just calls the same
    // real, uncached listProducts() this page always called before
    // Phase 8.
    const cacheKey = getShopCacheKey(query, { isAdmin: false });
    result = cacheKey ? await getCachedProductList(query, cacheKey) : await listProducts(query, { isAdmin: false });
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) {
      invalid = true;
    } else {
      throw err;
    }
  }

  if (invalid) {
    return (
      <div className="container-x py-20">
        <EmptyState
          icon={AlertCircle}
          title="Invalid filter"
          message="One of the filters in this link isn't valid. Try adjusting your search."
        />
      </div>
    );
  }

  const initialProducts = serializeForClient(result.products);
  const total = result.total;
  const facets = serializeForClient(result.facets);

  // Keying by the raw query string forces a full remount of the client
  // shell whenever the URL's filters change, so its local "show more"
  // pagination state always restarts from this fresh server-rendered
  // first page instead of carrying over stale state from the previous
  // filter selection.
  return (
    <>
      <ShopBreadcrumbJsonLd rawSearchParams={rawSearchParams} />
      <ShopPageClient key={usp.toString()} initialProducts={initialProducts} total={total} facets={facets} />
    </>
  );
}

// Phase 10 — BreadcrumbList structured data mirroring the exact visible
// trail views/shop/ShopPageClient.jsx renders (Home > Shop > [department,
// whenever `?category=` names one it can resolve] — see its
// `selectedDeptObj` logic, which — unlike app/(routes)/shop/page.jsx's
// narrower `getIndexableCategoryId` used only to decide indexability —
// shows the department for ANY request naming a resolvable category,
// alongside other filters/search/sort/pagination). Reuses the same
// Phase 8 cached category read + localization the /api/categories route
// itself uses, so the department name always matches what the client's
// own useGetCategoriesQuery call would render.
async function ShopBreadcrumbJsonLd({ rawSearchParams }) {
  const categoryId = typeof rawSearchParams?.category === "string" ? rawSearchParams.category : undefined;

  const [nonce, locale, t] = await Promise.all([
    headers().then((h) => h.get("x-nonce") || undefined),
    getServerLocale(),
    getT(),
  ]);

  let department = null;
  if (categoryId) {
    const categories = await getCachedCategories();
    const category = categories.find((c) => String(c._id) === categoryId);
    if (category) department = localizeCategory(category, locale);
  }

  const breadcrumbItems = [
    { name: t("navigation.home"), url: absoluteUrl("/") },
    { name: t("navigation.shop"), url: absoluteUrl("/shop") },
    ...(department ? [{ name: department.name, url: absoluteUrl(`/shop?category=${categoryId}`) }] : []),
  ];

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbItems.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }}
    />
  );
}
