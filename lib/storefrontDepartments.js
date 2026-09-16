// The single source of truth for which top-level categories the storefront
// recognizes — both services/productService.js (server-side scoping/
// filtering, via buildFilter()'s scopeIds) and views/shop/ShopPageClient.jsx
// (the client-side Category filter sidebar and pill row) import from here.
// This used to be two independently hand-maintained copies — one server,
// one client — and adding the 11 marketplace divisions only updated the
// server copy, silently leaving the client's Category filter showing just
// the original 9 fashion departments on every marketplace page (Cosmetics,
// Jewelry, Food, ...). A plain, framework-agnostic module (no mongoose, no
// "use client") is safe to import from either side, so there is now
// exactly one list to keep in sync with the real seeded taxonomy.

// The original, single-vertical modest-fashion catalog — every one of
// these divisions is 2 levels deep (division -> style, e.g. Burqa ->
// Closed-style Burqa) with real filters (color/size/fabric) that make
// sense to browse together across every style in ONE grid. views/
// ShopPage.jsx uses this exact list to keep that grid-first experience
// for these divisions specifically, even though each is technically
// non-leaf.
export const FASHION_DEPARTMENT_SLUGS = [
  "burqa",
  "hijab",
  "niqab",
  "abaya",
  "khimar",
  "modest-sets",
  "t-shirt",
  "shirts",
  "jeans",
];

// General-marketplace divisions added alongside fashion (scripts/
// seedMarketplaceExpansion.mjs) — this was a single-vertical modest-
// fashion shop before that, hence the two groups.
export const GENERAL_MARKETPLACE_DEPARTMENT_SLUGS = [
  "food",
  "baby-food-care",
  "diapers",
  "home-cleaning",
  "pet-care",
  "beauty-health",
  "home-kitchen",
  "jewelry",
  "stationeries",
  "toys-sports",
  "gadget",
];

// The storefront (non-admin reads) is scoped to these departments and
// their subcategories — a real allowlist, not just "any root category":
// a stray root category (e.g. leftover test/fixture data in a shared
// dev database) must never silently appear in the storefront nav or
// filters. Narrow this list again to soft-launch a subset.
export const STOREFRONT_DEPARTMENT_SLUGS = [...FASHION_DEPARTMENT_SLUGS, ...GENERAL_MARKETPLACE_DEPARTMENT_SLUGS];

// Deliberate display order for the homepage's "Shop your everyday
// favourites" tile row and the Shop page's category-filter tile row (both
// call sortDepartmentsForFavourites() below) — Category.find() sorts by
// sortOrder/name, and every seeded department ties on sortOrder=0, so
// without this the row falls back to alphabetical order. A department
// with no entry here sorts after all six known ones, keeping the row
// stable as the catalog grows.
export const DEPARTMENT_ORDER = ["burqa", "abaya", "hijab", "niqab", "khimar", "modest-sets"];

export const FAVOURITE_DEPARTMENTS_COUNT = 8;

// Shared by views/HomePage.jsx and views/shop/ShopPageClient.jsx so the
// homepage's favourites row and the Shop page's category-filter tile row
// always show the exact same departments in the exact same order — one
// sort/filter implementation, not two independently-maintained copies.
// The STOREFRONT_DEPARTMENT_SLUGS allowlist (previously applied only on
// the Shop side, not the homepage) is now applied here for both, closing
// a real gap: a stray/test root category could otherwise have appeared
// in the homepage's row but never the Shop page's.
export function sortDepartmentsForFavourites(categories) {
  return categories
    .filter((c) => !c.parent && STOREFRONT_DEPARTMENT_SLUGS.includes(c.slug))
    .sort((a, b) => {
      const ai = DEPARTMENT_ORDER.indexOf(a.slug);
      const bi = DEPARTMENT_ORDER.indexOf(b.slug);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
}
