import { Suspense } from "react";
import ShopPage from "@/views/ShopPage.jsx";
import ShopPageSkeleton from "@/views/shop/ShopPageSkeleton.jsx";
import { absoluteUrl, truncateDescription } from "@/lib/seo.js";
import { getT, getServerLocale } from "@/lib/i18n/server.js";
import { getCachedCategories } from "@/lib/serverDataCache.js";
import { isObjectIdFormat } from "@/lib/validation.js";
import { departmentName } from "@/lib/i18n/catalog.js";

// A request is only ever a genuinely indexable category page when its
// ENTIRE query is exactly `?category=<id>` — nothing else. Deliberately
// narrower than services/productService.js's parseProductListQuery (the
// real, full query contract ShopPage.jsx uses to fetch products): this
// never needs to duplicate that parser because indexing is only ever
// safe for the single cleanest, highest-value case. Any additional
// param (search, another facet, a non-default sort, page>1, or a
// `?category=` that's a CSV/repeated value rather than one plain id)
// falls through to the noindex branch below, same as before this
// existed — this only ADDS a real indexable target, it never widens
// what already got treated as safe-to-index.
function getIndexableCategoryId(rawParams) {
  const keys = Object.keys(rawParams || {});
  if (keys.length !== 1 || keys[0] !== "category") return null;
  const value = rawParams.category;
  return typeof value === "string" && isObjectIdFormat(value) ? value : null;
}

// Phase 10's original shop query-string indexing policy (kept, just no
// longer the ONLY case): the bare `/shop` (no query at all) is one stable,
// indexable landing page. A single clean `?category=<id>` is now a SECOND
// indexable landing page per department (see getIndexableCategoryId above
// and the incident-response SEO audit that added this — Google could
// never rank a "Burqa"/"Hijab" department specifically before, since every
// query-string variant collapsed to noindex+canonical-to-bare-/shop).
// EVERY other query-string variant — free-text search, any other facet
// combination, sort order, or pagination — is still deliberately
// `noindex,follow`. Its canonical now prefers the real category URL when
// one was named (a `?category=X&page=2` is a variant of that category's
// own page, not of the whole unfiltered catalog) and only falls back to
// bare `/shop` otherwise — this repo still doesn't define an
// "intentionally indexable" combination for anything beyond a bare
// category (featured/new/discount/brand/etc. all stay exactly as
// conservative as before). `follow` is kept so links to real product
// pages reachable from a filtered result are still crawlable.
export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  const hasQuery = Object.keys(params || {}).length > 0;
  const t = await getT();

  const categoryId = getIndexableCategoryId(params);
  if (categoryId) {
    const [locale, categories] = await Promise.all([getServerLocale(), getCachedCategories()]);
    const category = categories.find((c) => String(c._id) === categoryId);
    if (category) {
      const name = departmentName(locale, category.slug, category.name);
      const description = truncateDescription(
        category.description || t("seo.categoryFallbackDescription", { name }),
      );
      const canonicalPath = `/shop?category=${categoryId}`;
      return {
        title: name,
        description,
        alternates: { canonical: canonicalPath },
        robots: { index: true, follow: true },
        openGraph: { type: "website", title: name, description, url: absoluteUrl(canonicalPath) },
        twitter: { card: "summary", title: name, description },
      };
    }
    // A well-formed but unrecognized/stale category id (e.g. a deleted
    // category still linked somewhere) — falls through to the generic
    // noindex handling below exactly like any other unrecognized query,
    // never a crash or a false-positive index.
  }

  // A category id was named (even alongside other params, or one that
  // didn't resolve above) gets its own clean URL as canonical instead of
  // collapsing all the way to the unfiltered catalog; anything else
  // (search, other facets, no category at all) still canonicalizes to
  // bare /shop exactly as before.
  const rawCategory = params?.category;
  const canonicalPath =
    typeof rawCategory === "string" && isObjectIdFormat(rawCategory) ? `/shop?category=${rawCategory}` : "/shop";

  return {
    title: "Shop",
    description: truncateDescription(t("seo.shopDescription")),
    alternates: { canonical: canonicalPath },
    robots: hasQuery ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default function Page({ searchParams }) {
  return (
    <Suspense fallback={<ShopPageSkeleton />}>
      <ShopPage searchParams={searchParams} />
    </Suspense>
  );
}
