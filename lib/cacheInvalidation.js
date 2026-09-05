// Phase 8 — the one place every mutation Route Handler calls to purge
// stale cached reads after a successful write. See lib/cacheTags.js for
// why this exists instead of `"use cache"`/cacheComponents.
import { revalidateTag } from "next/cache";

import { CACHE_TAGS } from "./cacheTags.js";

const KNOWN_TAG_VALUES = new Set(Object.values(CACHE_TAGS));
const MAX_TAG_LENGTH = 256;
const TAG_SHAPE_RE = /^[a-z-]+:[0-9a-fA-F]{24}$/; // "product:<id>" / "reviews:<id>"

function isSafeTag(tag) {
  if (typeof tag !== "string" || tag.length === 0 || tag.length > MAX_TAG_LENGTH) return false;
  return KNOWN_TAG_VALUES.has(tag) || TAG_SHAPE_RE.test(tag);
}

// Commerce-correctness tags (price/stock/visibility/analytics) use
// `{ expire: 0 }` rather than a cacheLife profile name: per Next.js's own
// revalidateTag() contract, this makes the NEXT read block for a fresh
// value instead of serving one more stale response while revalidating in
// the background — the right tradeoff for "is this still in stock,"
// wrong for content where a few extra seconds of staleness is harmless.
const IMMEDIATE_EXPIRE = { expire: 0 };

/**
 * Invalidates one or more cache tags after a mutation has already
 * committed successfully. Never call this before a write/transaction has
 * committed, and never let its own failure turn a successful mutation
 * into a reported failure — a cache that fails to invalidate is a
 * (bounded, TTL-recovered) staleness problem, not a correctness problem
 * the client's request should fail for.
 *
 * @param {string[]} tags - only known CACHE_TAGS values or validated
 *   `domain:<24-hex-id>` shapes (lib/cacheTags.js's own builders) are
 *   accepted; anything else throws immediately (a bug to fix, not a
 *   request to quietly ignore) rather than silently doing nothing.
 */
export function invalidateCacheTags(tags) {
  const unique = [...new Set(tags)];
  for (const tag of unique) {
    if (!isSafeTag(tag)) {
      throw new Error("invalidateCacheTags: refusing an unrecognized or oversized tag");
    }
  }
  for (const tag of unique) {
    try {
      revalidateTag(tag, IMMEDIATE_EXPIRE);
    } catch (err) {
      // Deliberately generic and server-side only — never the tag value,
      // never any request context, never rethrown. The write this was
      // called after has already committed; failing to invalidate only
      // means the next read may be briefly stale until this cache
      // entry's own finite TTL recovers it (see lib/serverDataCache.js).
      console.error("Cache invalidation failed", err?.message || err);
    }
  }
}
