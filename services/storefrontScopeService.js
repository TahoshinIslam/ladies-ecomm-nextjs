import Category from "../models/categoryModel.js";

// What the storefront may show, decided by DATA, not by a hard-coded list of
// slugs: a category is storefront-visible when it is active AND every
// ancestor above it is active. Deactivating a department (or any parent)
// hides everything under it; creating a new one in the admin makes it
// visible without a code change.
//
// This replaced a slug allowlist (STOREFRONT_DEPARTMENT_SLUGS) that silently
// excluded every admin-created department: a product filed under a new
// "Shoe" department was saved correctly (active, priced, in stock) yet never
// matched `top_category_id IN (...)`, so it appeared nowhere on the
// storefront. The old guard's aim — keep stray fixture categories out — is
// served by is_active instead (deactivate or delete a stray category).
export function computeVisibleCategoryIds(categories) {
  const byId = new Map(categories.map((c) => [c._id, c]));
  const isVisible = (category) => {
    const seen = new Set();
    let node = category;
    while (node) {
      // An inactive ancestor hides the branch; so does a parent cycle.
      if (!node.isActive || seen.has(node._id)) return false;
      seen.add(node._id);
      if (!node.parent) return true; // reached an active root
      node = byId.get(node.parent); // a dangling parent id ends the loop -> hidden
    }
    return false;
  };
  return categories.filter(isVisible).map((c) => c._id);
}

export async function resolveStorefrontVisibleCategoryIds() {
  return computeVisibleCategoryIds(await Category.findAll());
}

// Per-process memo of the visible set, VALIDATED against a fingerprint of the
// categories table on every use (Category.stamp(): one tiny aggregate) rather
// than trusted for a fixed time. Trusting a timer plus resetStorefrontScopeCache()
// was not enough: in a production build Next bundles route handlers and page
// renders separately, so the reset called from the categories API route never
// reached the copy of this cache the /shop page render uses — a department
// created (or re-activated) in the admin stayed invisible on the storefront
// pages for the rest of the TTL (found by tests/http/newDepartmentShoe). The
// stamp makes every server instance and bundle see a category change on its
// very next read; the TTL below is only a backstop.
const STOREFRONT_DEPT_IDS_TTL_MS = 60_000;
let storefrontDeptIdsCache = { ids: null, stamp: null, expiresAt: 0, inFlight: null, generation: 0 };

export function resetStorefrontScopeCache() {
  // Bumping the generation also discards a read that started before the
  // reset and finishes after it (it would otherwise re-cache stale ids).
  storefrontDeptIdsCache = { ids: null, stamp: null, expiresAt: 0, inFlight: null, generation: storefrontDeptIdsCache.generation + 1 };
}

export async function getStorefrontDepartmentIds() {
  const stamp = await Category.stamp();
  const cached = storefrontDeptIdsCache;
  if (cached.ids && cached.stamp === stamp && cached.expiresAt > Date.now()) {
    return cached.ids;
  }
  if (cached.inFlight && cached.inFlightStamp === stamp) {
    return cached.inFlight;
  }
  const generation = cached.generation;
  const inFlight = resolveStorefrontVisibleCategoryIds()
    .then((ids) => {
      if (storefrontDeptIdsCache.generation === generation) {
        storefrontDeptIdsCache = { ids, stamp, expiresAt: Date.now() + STOREFRONT_DEPT_IDS_TTL_MS, inFlight: null, generation };
      }
      return ids;
    })
    .catch((err) => {
      if (storefrontDeptIdsCache.generation === generation) storefrontDeptIdsCache.inFlight = null;
      throw err;
    });
  storefrontDeptIdsCache = { ...storefrontDeptIdsCache, inFlight, inFlightStamp: stamp };
  return inFlight;
}
