// Phase 8 — the shop/home product-list cache-eligibility policy.
//
// services/productService.js's parseProductListQuery() (Phase 5) validates
// and normalizes a very wide space of query combinations — including
// arbitrary dynamic AttributeDefinition facets and free-text search. Blindly
// caching every possible resulting query would let a client generate an
// unbounded number of distinct cache keys (a cardinality/cost-abuse vector,
// not a correctness bug) for very little real hit-rate benefit, since most
// of that space is never requested twice.
//
// This module runs strictly AFTER Phase 5 validation/normalization (it never
// re-parses or re-validates raw input itself) and decides, from the already
// -clean query object, whether the request is worth caching at all. An
// ineligible query is never rejected or altered — it just skips the cache
// and goes straight to the same real, uncached services/productService.js
// call every request already went through before Phase 8.
const MAX_CACHE_KEY_LENGTH = 300;

// The only query keys this policy will cache — every one of them is a
// bounded, enumerable, or numeric-range field (see schemas/catalogSchemas.js
// / services/productService.js's ALLOWED_FILTER_FIELDS). Any OTHER key
// (including any dynamic AttributeDefinition facet, filterable-select or
// free-text alike) makes the whole query ineligible: distinguishing a
// bounded-enum attribute facet from a free-text one would need an extra
// database lookup on the caching hot path, which defeats the point of
// caching and adds a second place that could drift from Phase 5's own
// classification.
const CACHEABLE_KEYS = new Set([
  "page",
  "limit",
  "sort",
  "fields",
  "category",
  "style",
  "topCategory",
  "brand",
  "ageGroup",
  "featured",
  "new",
  "discount",
  "collection",
  "availability",
  "ratingGte",
  "isFeatured",
  "isActive",
  "basePrice",
]);

// Fields whose value is a CSV "set" (order-independent) — sorted before
// building the key so `ageGroup=kids,girls` and `ageGroup=girls,kids`
// (semantically identical, per services/productService.js's buildFilter)
// share one cache entry instead of two.
const CSV_SET_FIELDS = new Set(["category", "brand", "ageGroup"]);

function canonicalizeValue(key, value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // basePrice's {gte,gt,lte,lt} range object — sort its own keys too.
    const sortedEntries = Object.keys(value)
      .sort()
      .map((k) => [k, value[k]]);
    return JSON.stringify(sortedEntries);
  }
  if (CSV_SET_FIELDS.has(key) && typeof value === "string") {
    return [...value.split(",")].sort().join(",");
  }
  return String(value);
}

/**
 * Returns a stable, canonical cache-key string for an already-Phase-5-
 * validated product-list query, or `null` if the query is not eligible for
 * caching (search present, any dynamic/unknown key present, admin request,
 * or the canonical key would exceed the safe length bound).
 *
 * Two semantically-equivalent queries (same filters, different key
 * insertion order or CSV value order) always produce the same string.
 */
export function getShopCacheKey(query, { isAdmin = false } = {}) {
  if (isAdmin) return null;
  if (!query || typeof query !== "object") return null;
  if (query.search) return null;

  const keys = Object.keys(query);
  for (const key of keys) {
    if (!CACHEABLE_KEYS.has(key)) return null;
  }

  const canonical = keys
    .sort()
    .map((key) => `${key}=${canonicalizeValue(key, query[key])}`)
    .join("&");

  if (canonical.length > MAX_CACHE_KEY_LENGTH) return null;
  return canonical || "(default)";
}
