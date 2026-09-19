import { headers } from "next/headers";

import ShopPageClient from "./shop/ShopPageClient.jsx";
import CategoryLanding from "./shop/CategoryLanding.jsx";
import connectDB from "../config/db.js";
import { listProducts, parseProductListQuery, FASHION_DEPARTMENT_SLUGS } from "../services/productService.js";
import { isLeafCategory } from "../services/categoryService.js";
import { assertNoDuplicateQueryKeys, assertNoDangerousQueryKeys } from "../lib/validation.js";
import { parseQueryParams, HttpError } from "../lib/http.js";
import { serializeForClient } from "../lib/serialize.js";
import { getCachedProductList, getCachedCategories, getCachedPublicSettings } from "../lib/serverDataCache.js";
import { getShopCacheKey } from "../lib/shopCacheEligibility.js";
import { getServerLocale, getT } from "../lib/i18n/server.js";
import { localizeCategory } from "../lib/i18n/localize.js";
import { absoluteUrl, safeJsonLd } from "../lib/seo.js";
import { isObjectIdFormat } from "../lib/validation.js";
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

  // Realtime-durability-class fix: the cached branch below now
  // guarantees its own DB readiness (lib/serverDataCache.js's withDb()),
  // but the uncached listProducts() fallback (an ineligible-for-cache
  // query — free-text search, dynamic facets) does not go through that
  // wrapper — establish readiness explicitly here rather than relying on
  // some earlier, unrelated request having already connected on this warm
  // instance. Also needed up front for the category-landing branch below,
  // which reads Category directly.
  await connectDB();

  // Shop-category-tiles feature — fetched once, up front, and reused both
  // by the CategoryLanding branch below (previously its own separate
  // getCachedCategories() call) and as an `initialCategories`/
  // `initialDepartmentImages` prop seeding ShopPageClient.jsx's category-
  // filter tile row's very first paint, exactly like Header.jsx's
  // `initialDepartments` already seeds the nav — the client's own
  // useGetCategoriesQuery() still fires and takes over for freshness, so
  // this is not a second, competing data source, only a first-paint seed.
  const [categories, publicSettings] = await Promise.all([getCachedCategories(), getCachedPublicSettings()]);
  const departmentImages = publicSettings?.homepage?.departmentImages || {};
  // Saved crops for the category-tile row (Admin → Shop Config → Departments).
  const imageFraming = publicSettings?.homepage?.imageFraming || {};

  // A category that itself has children (e.g. "Cosmetics", or "Food") is a
  // browsing waypoint, not a leaf shoppers file real products under —
  // showing the full filter+grid UI for it would be either empty or a
  // meaningless mix of its sub-categories' attributes (Cosmetics has no
  // brand/price range of its own; "Face Wash" does). Land on a real tile
  // grid of its direct children instead — the same drill-down a shopper
  // gets clicking through the category mega-menu — and only render the
  // product grid once `?category=` actually names a genuine leaf. A
  // `style=` param (the mega-menu's own leaf-level link) always means the
  // shopper has already drilled down that far, so it skips this branch
  // even if `category` alone would otherwise be non-leaf.
  //
  // The original 9 fashion departments (FASHION_DEPARTMENT_SLUGS) are
  // EXEMPT from this even though each is technically non-leaf too (Burqa
  // has real style children like "Closed-style Burqa") — unlike a
  // marketplace division's departments, every one of a fashion
  // department's styles is still the same real, filterable product type
  // (all are burqas), so the established grid-with-a-Style-filter
  // experience is correct there; forcing an extra tile-click first would
  // only have made real, working navigation (color/size/fabric filters,
  // real product counts) worse.
  //
  // Matched by slug alone, NOT "is this a root category" — these 9 now sit
  // one level under the Men/Women gender divisions (parent set), exactly
  // like a marketplace division's own mid-tier departments (e.g. Food's
  // "Fruits & Vegetables"). The distinction that actually matters was
  // never depth, it was "is every child of this category still the same
  // filterable product type" — that's still true of Burqa regardless of
  // what now sits above it, so the exemption must survive the added
  // nesting. Visiting the Men/Women division itself (not in this
  // allowlist) still correctly falls through to the isLeaf check below and
  // lands on CategoryLanding, same as Food's own division page.
  const categoryParam = typeof rawSearchParams?.category === "string" ? rawSearchParams.category : null;
  const hasStyleParam = typeof rawSearchParams?.style === "string" && rawSearchParams.style !== "";
  if (categoryParam && isObjectIdFormat(categoryParam) && !hasStyleParam) {
    const requestedCategory = categories.find((c) => String(c._id) === categoryParam);
    const isFashionDept = requestedCategory && FASHION_DEPARTMENT_SLUGS.includes(requestedCategory.slug);
    if (!isFashionDept) {
      const isLeaf = await isLeafCategory(categoryParam);
      if (!isLeaf) {
        return <CategoryLanding categoryId={categoryParam} />;
      }
    }
  }

  let result;
  let invalid = false;
  try {
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
      <ShopPageClient
        key={usp.toString()}
        initialProducts={initialProducts}
        total={total}
        facets={facets}
        initialCategories={serializeForClient(categories)}
        initialDepartmentImages={departmentImages}
        initialImageFraming={imageFraming}
      />
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
