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
