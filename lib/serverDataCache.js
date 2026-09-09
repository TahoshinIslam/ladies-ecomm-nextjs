// Phase 8 — cached wrappers around the PUBLIC (never user-specific) reads
// behind the Phase 7 Server Component pages. See lib/cacheTags.js for why
// `unstable_cache` + `revalidateTag` is used here instead of
// `"use cache"`/cacheComponents (that decision is load-bearing for this
// app's nonce CSP — do not change it without re-reading that file).
//
// Every function here:
//   - is called from a Server Component or Route Handler only (never
//     imported by a Client Component — see
//     tests/serverCacheArchitecture.test.mjs's import-graph check)
//   - returns a plain, already-serialized DTO (lib/serialize.js's
//     serializeForClient — no Mongoose document, no ObjectId/Date
//     instance ever crosses out of this module)
//   - never touches a `select: false` field (Mongoose's own default
//     projection already excludes password/reset/session/gateway fields
//     from every one of these queries, same guarantee every Route
//     Handler already relies on)
//   - has a finite TTL (`revalidate: <seconds>`) as a correctness
//     fallback independent of mutation invalidation, and a real,
//     specific tag set invalidation can target
//   - never caches a thrown error: `unstable_cache` does not persist a
//     rejected call, so a lookup failure simply isn't cached — the next
//     request tries again for real
//
// `unstable_cache()` is deliberately called INSIDE each exported function
// (not once at module scope) wherever a tag needs to depend on the
// request's own arguments (e.g. `product:<id>`) — its cache KEY is
// derived from the static `keyParts` plus the actual call arguments, not
// from JS closure identity, so re-wrapping per call is the documented,
// correct pattern for per-argument tags and does not create a new cache
// entry family on every call.
import { unstable_cache } from "next/cache";

import connectDB from "../config/db.js";
import { CACHE_TAGS, productTag } from "./cacheTags.js";
import { serializeForClient } from "./serialize.js";
import { listProducts, getProductByIdOrSlug, listRelated } from "../services/productService.js";
import { listCategories } from "../services/categoryService.js";
import { resolveAttributesForCategory, listAttributes } from "../services/attributeService.js";
import { getPublicSettings } from "../services/settingsService.js";
import { getActiveTheme } from "../services/themeService.js";
import {
  getOverview,
  getSalesSeries,
  getTopProducts,
  getStatusBreakdown,
  getRevenueByMethod,
} from "../services/analyticsService.js";
import Brand from "../models/brandModel.js";
import Product from "../models/productModel.js";

// Realtime-durability-class fix (same family as Phase 11's event-outbox
// closure): every function below is called from a Server Component, never
// a Route Handler — Route Handlers get connection readiness for free from
// lib/http.js's withRoute() (which calls connectDB() before the handler
// runs), but a Server Component render never goes through that wrapper at
// all. Before this fix, every `unstable_cache` callback below called
// straight into a service/Mongoose model with no explicit connection
// step, silently relying on Mongoose's own command buffering (default
// 10s) PLUS the assumption that some earlier, unrelated request on the
// same warm instance had already connected via a Route Handler. On a
// fresh/cold Vercel instance whose FIRST request is a Server Component
// page (e.g. the homepage) rather than an API call, there was no
// connection yet, buffering timed out at 10s, and the render failed with
// a raw MongooseError — reproduced consistently against a real Preview
// deployment.
//
// The fix: every cache-miss callback establishes DB readiness itself,
// via this one shared helper, so no future addition to this file can
// forget it (the alternative — pasting `await connectDB()` into 14
// separate callback bodies — is exactly the kind of thing that drifts).
// Deliberately called INSIDE the unstable_cache callback, never outside
// it — a real cache HIT must still never require a database connection
// at all.
async function withDb(fn) {
  await connectDB();
  return fn();
}

// Named TTL constants (seconds) — see this phase's own cache-lifetime
// policy comment below each group. Mutation invalidation (lib/
// cacheInvalidation.js) is the PRIMARY freshness mechanism for anything
// correctness-sensitive (price/stock/visibility); every TTL here is a
// recovery fallback for the case invalidation didn't fire (a missed
// call site, a transient revalidateTag failure), not the main guarantee.
export const CACHE_TTL_SECONDS = {
  PRODUCT_LIST: 300,
  PRODUCT_DETAIL: 300,
  RELATED_PRODUCTS: 300,
  CATEGORIES: 900,
  BRANDS: 900,
  ATTRIBUTES: 900,
  PUBLIC_SETTINGS: 900,
  PUBLIC_THEME: 900,
  ADMIN_ANALYTICS: 45,
};

// ---------------------------------------------------------------- Catalog

/**
 * Cached product listing for an ALREADY Phase-5-validated query and an
 * ALREADY Phase-8-eligible cache key (see lib/shopCacheEligibility.js —
 * callers must check eligibility themselves and call listProducts()
 * directly, uncached, for anything ineligible; this function does not
 * re-check eligibility).
 */
export async function getCachedProductList(query, cacheKey, { includeFacets = true } = {}) {
  return unstable_cache(
    async () =>
      withDb(async () => {
        const result = await listProducts(query, { isAdmin: false, includeFacets });
        return serializeForClient(result);
      }),
    // The facets inclusion is part of the cache identity, not just a
    // call-time option — a `facets: null` entry populated by a caller
    // that skipped them must never be served back to a caller (like the
    // shop page) that actually reads `result.facets`.
    ["product-list", cacheKey, includeFacets ? "facets" : "no-facets"],
    { revalidate: CACHE_TTL_SECONDS.PRODUCT_LIST, tags: [CACHE_TAGS.CATALOG] },
  )();
}

/**
 * Cached single-product lookup by id OR slug. Tagged with the broad
 * CATALOG tag always, PLUS the specific `product:<id>` tag whenever the
 * input is already a real ObjectId (the common case for a direct product
 * page hit) — a slug-keyed lookup can't know the real id in advance
 * without defeating the cache, so it relies on the broad tag alone (see
 * this file's header comment and lib/cacheTags.js — this is the
 * documented, accepted tradeoff, not an oversight).
 */
export async function getCachedProductByIdOrSlug(idOrSlug) {
  const isLikelyId = /^[0-9a-fA-F]{24}$/.test(idOrSlug);
  const tags = isLikelyId ? [CACHE_TAGS.CATALOG, productTag(idOrSlug)] : [CACHE_TAGS.CATALOG];
  return unstable_cache(
    async () =>
      withDb(async () => {
        const product = await getProductByIdOrSlug(idOrSlug);
        return serializeForClient(product);
      }),
    ["product-by-id-or-slug", idOrSlug],
    { revalidate: CACHE_TTL_SECONDS.PRODUCT_DETAIL, tags },
  )();
}

export async function getCachedRelatedProducts(idOrSlug, limit) {
  return unstable_cache(
    async () =>
      withDb(async () => {
        const related = await listRelated(idOrSlug, limit);
        return serializeForClient(related);
      }),
    ["related-products", idOrSlug, String(limit)],
    { revalidate: CACHE_TTL_SECONDS.RELATED_PRODUCTS, tags: [CACHE_TAGS.CATALOG] },
  )();
}

export async function getCachedCategories() {
  return unstable_cache(
    async () => withDb(async () => serializeForClient(await listCategories())),
    ["categories"],
    { revalidate: CACHE_TTL_SECONDS.CATEGORIES, tags: [CACHE_TAGS.CATEGORIES] },
  )();
}

export async function getCachedBrands() {
  return unstable_cache(
    async () => withDb(async () => serializeForClient(await Brand.find({ isActive: true }).sort("name").lean())),
    ["brands"],
    { revalidate: CACHE_TTL_SECONDS.BRANDS, tags: [CACHE_TAGS.BRANDS] },
  )();
}

export async function getCachedAttributesForCategory(topCategoryId) {
  return unstable_cache(
    async () => withDb(async () => serializeForClient(await resolveAttributesForCategory(topCategoryId))),
    ["attributes-for-category", String(topCategoryId)],
    { revalidate: CACHE_TTL_SECONDS.ATTRIBUTES, tags: [CACHE_TAGS.ATTRIBUTES] },
  )();
}

export async function getCachedAllAttributes() {
  return unstable_cache(
    async () => withDb(async () => serializeForClient(await listAttributes())),
    ["attributes-all"],
    { revalidate: CACHE_TTL_SECONDS.ATTRIBUTES, tags: [CACHE_TAGS.ATTRIBUTES] },
  )();
}

/**
 * Phase 10 — narrow projection for app/sitemap.js: only the two fields a
 * sitemap entry needs (`slug` for the URL, `updatedAt` for
 * `lastModified`), never a full product document, and only active
 * products (an inactive one must never appear in the public sitemap).
 * Tagged CATALOG like every other product-shaped cached read, so the
 * same product create/update/delete invalidation this app already fires
 * (see every app/api/products/**\/route.js's invalidateCacheTags call)
 * keeps this in sync — no separate sitemap-specific invalidation path to
 * maintain. Bounded to the real catalog size (this app's seeded/demo
 * catalog is a handful of products, but the query itself has no
 * artificial page-size ceiling the way an admin list view would).
 */
export async function getCachedSitemapProducts() {
  return unstable_cache(
    async () =>
      withDb(async () =>
        serializeForClient(await Product.find({ isActive: true }).select("slug updatedAt").lean()),
      ),
    ["sitemap-products"],
    { revalidate: CACHE_TTL_SECONDS.PRODUCT_LIST, tags: [CACHE_TAGS.CATALOG] },
  )();
}

// ------------------------------------------------------- Public config

export async function getCachedPublicSettings() {
  return unstable_cache(
    async () => withDb(async () => serializeForClient(await getPublicSettings())),
    ["public-settings"],
    { revalidate: CACHE_TTL_SECONDS.PUBLIC_SETTINGS, tags: [CACHE_TAGS.PUBLIC_SETTINGS] },
  )();
}

export async function getCachedActiveTheme() {
  return unstable_cache(
    async () => withDb(async () => serializeForClient(await getActiveTheme())),
    ["public-theme"],
    { revalidate: CACHE_TTL_SECONDS.PUBLIC_THEME, tags: [CACHE_TAGS.PUBLIC_THEME] },
  )();
}

// ------------------------------------------------------- Admin analytics
//
// Callers MUST enforce the dashboard.view permission (or equivalent)
// BEFORE calling any of these — this module caches the DATA, shared
// identically across every authorized administrator, never the
// authorization decision itself. An unauthorized caller must never reach
// this file at all.

export async function getCachedOverview() {
  return unstable_cache(
    async () => withDb(async () => serializeForClient(await getOverview())),
    ["admin-overview"],
    { revalidate: CACHE_TTL_SECONDS.ADMIN_ANALYTICS, tags: [CACHE_TAGS.ADMIN_ANALYTICS] },
  )();
}

export async function getCachedSalesSeries(days) {
  return unstable_cache(
    async () => withDb(async () => serializeForClient(await getSalesSeries(days))),
    ["admin-sales-series", String(days)],
    { revalidate: CACHE_TTL_SECONDS.ADMIN_ANALYTICS, tags: [CACHE_TAGS.ADMIN_ANALYTICS] },
  )();
}

export async function getCachedTopProducts(limit) {
  return unstable_cache(
    async () => withDb(async () => serializeForClient(await getTopProducts(limit))),
    ["admin-top-products", String(limit)],
    { revalidate: CACHE_TTL_SECONDS.ADMIN_ANALYTICS, tags: [CACHE_TAGS.ADMIN_ANALYTICS] },
  )();
}

export async function getCachedStatusBreakdown() {
  return unstable_cache(
    async () => withDb(async () => serializeForClient(await getStatusBreakdown())),
    ["admin-status-breakdown"],
    { revalidate: CACHE_TTL_SECONDS.ADMIN_ANALYTICS, tags: [CACHE_TAGS.ADMIN_ANALYTICS] },
  )();
}

export async function getCachedRevenueByMethod() {
  return unstable_cache(
    async () => withDb(async () => serializeForClient(await getRevenueByMethod())),
    ["admin-revenue-by-method"],
    { revalidate: CACHE_TTL_SECONDS.ADMIN_ANALYTICS, tags: [CACHE_TAGS.ADMIN_ANALYTICS] },
  )();
}
