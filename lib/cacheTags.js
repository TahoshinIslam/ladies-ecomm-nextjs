// Phase 8 — centralized cache tag names. Every tag used anywhere in the
// app (both when wrapping a cached read and when invalidating after a
// mutation) must come from here, so a typo can never silently create two
// different tags for what should be the same cache domain.
//
// ============================================================================
// WHY unstable_cache/revalidateTag INSTEAD OF cacheComponents/"use cache"
// ============================================================================
// This app's CSP (proxy.js) is a strict, per-request NONCE-based policy —
// every HTML response carries a fresh, unguessable nonce, and every inline
// <script> tag (including Next's own hydration bootstrap) must carry the
// matching value. Per Next.js's own documentation, a nonce CSP requires
// every page that can contain an inline script to render fully dynamically
// per request: static generation, ISR, and Partial Prerendering (PPR) can
// only inject a build-time or per-segment-cached nonce, never a genuinely
// per-request one. `cacheComponents: true` enables PPR by default and is
// the ONLY way to use `"use cache"`/`cacheLife`/`cacheTag` in this Next.js
// version — turning it on would silently break the nonce contract the
// whole security-header layer depends on.
//
// Do NOT enable `cacheComponents` in next.config.mjs. Do NOT add a
// `"use cache"` directive anywhere. Do NOT introduce PPR. The correct,
// supported mechanism while keeping strict dynamic rendering is the
// "previous" data cache API — `unstable_cache()` + `revalidateTag()` — which
// caches the RESULT OF A DATA READ (a plain, already-fetched value), never
// the HTML response itself. The page's own render (and its nonce) still
// happens fresh on every request; only the database round trip behind it
// is skipped when a cache entry is fresh. See lib/serverDataCache.js for
// the wrappers built on this, and tests/serverCacheArchitecture.test.mjs
// for the regression guard that keeps this decision from being reversed
// by a future change.
// ============================================================================

// Broad, domain-wide tags — safe to invalidate liberally; a mutation that
// might affect *some* cached read in a domain but can't cheaply prove
// exactly which one invalidates the whole domain instead (see lib/http.js's
// analogous "fail closed, not cleverly" precedent elsewhere in this app).
export const CACHE_TAGS = {
  CATALOG: "catalog", // any product-list-shaped read (home sections, shop listing, related products)
  CATEGORIES: "categories",
  BRANDS: "brands",
  ATTRIBUTES: "attributes",
  PUBLIC_SETTINGS: "public-settings",
  PUBLIC_THEME: "public-theme",
  ADMIN_ANALYTICS: "admin-analytics",
};

// Next.js caps a single tag at 256 characters (see the framework's own
// documented limit) — this is well under that even for a 24-hex-char id.
const MAX_TAG_LENGTH = 256;
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

// A tag scoped to one specific, already-validated product id — NOT built
// from a slug or any other free-form user input, so it can never grow
// unbounded or leak anything sensitive (an id is not PII). Throws rather
// than silently falling back to a broad tag: a caller passing something
// that isn't a real ObjectId almost certainly has a bug worth surfacing,
// not a case to paper over.
export function productTag(id) {
  if (typeof id !== "string" || !OBJECT_ID_RE.test(id)) {
    throw new Error("productTag: id must be a validated 24-hex ObjectId string");
  }
  const tag = `product:${id}`;
  if (tag.length > MAX_TAG_LENGTH) throw new Error("productTag: tag exceeds the framework tag-length limit");
  return tag;
}

export function reviewsTag(productId) {
  if (typeof productId !== "string" || !OBJECT_ID_RE.test(productId)) {
    throw new Error("reviewsTag: productId must be a validated 24-hex ObjectId string");
  }
  return `reviews:${productId}`;
}
