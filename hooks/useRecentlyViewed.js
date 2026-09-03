"use client";

import { useMemo, useSyncExternalStore } from "react";
import { storage } from "../lib/utils.js";

// Deliberately its own key — never shares storage with the guest cart or
// any wishlist-adjacent key. Stores only {id, viewedAt} pairs, never full
// product snapshots: Recently Viewed always resolves fresh data from
// MongoDB (see services/productService.js's getProductsByIds), so a
// since-changed price/image/name, or a since-deleted/unpublished product,
// is never displayed stale — the id list is just "what to look up and in
// what order," nothing more.
const STORAGE_KEY = "tahos_recently_viewed";
const MAX_ENTRIES = 12;

const listeners = new Set();
const notify = () => listeners.forEach((l) => l());
const subscribe = (onStoreChange) => {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
};

// useSyncExternalStore requires a referentially stable snapshot when the
// underlying value hasn't changed, or it re-renders forever — cache the
// parsed result against the raw string it came from instead of parsing on
// every call. Defensive on shape too: a non-array root, a non-object entry,
// or an entry missing either field is dropped rather than trusted.
let cachedRaw;
let cachedHistory = [];

// Exported (rather than kept module-private) so tests can exercise the real
// parse/validate/cap logic directly instead of re-deriving it.
export function getHistorySnapshot() {
  const raw = storage.get(STORAGE_KEY);
  if (raw === cachedRaw) return cachedHistory;
  cachedRaw = raw;
  let parsed = [];
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    parsed = [];
  }
  cachedHistory = Array.isArray(parsed)
    ? parsed.filter(
        (entry) => entry && typeof entry.id === "string" && entry.id.length > 0 && typeof entry.viewedAt === "number",
      )
    : [];
  return cachedHistory;
}

// The server has no localStorage and no visitor identity — always empty.
const getServerSnapshot = () => [];

/**
 * Records a view. Call this with a *loaded* product's real _id — never the
 * raw route param — so a 404, a deleted product, or a still-loading page
 * never gets recorded. Moves an existing entry back to the front instead of
 * duplicating it, and caps the list at MAX_ENTRIES (oldest dropped first).
 */
export function recordProductView(productId) {
  if (!productId || typeof productId !== "string") return;
  const deduped = getHistorySnapshot().filter((entry) => entry.id !== productId);
  storage.setJSON(STORAGE_KEY, [{ id: productId, viewedAt: Date.now() }, ...deduped].slice(0, MAX_ENTRIES));
  cachedRaw = undefined; // force the next snapshot read to reparse
  notify();
}

// Pure and exported on its own so the "exclude the current product" contract
// is testable without a DOM/React renderer.
export function historyToIds(history, excludeId) {
  return history.map((entry) => entry.id).filter((id) => id !== excludeId);
}

/**
 * Ordered list of recently-viewed product ids (most recent first), minus
 * `excludeId` (the product currently on screen). Reads through
 * useSyncExternalStore so the server snapshot and the client's first render
 * agree (both empty) — no hydration-mismatch warning, and no post-mount
 * setState render pass needed to pick up the real value.
 */
export function useRecentlyViewed(excludeId) {
  const history = useSyncExternalStore(subscribe, getHistorySnapshot, getServerSnapshot);
  return useMemo(() => historyToIds(history, excludeId), [history, excludeId]);
}
