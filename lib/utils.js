import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import { formatBdt } from "./currency.js";

// Merge Tailwind classes safely (resolves conflicts like "p-2 p-4" → "p-4")
export const cn = (...inputs) => twMerge(clsx(inputs));

/**
 * Web Storage that is safe to touch during server rendering.
 *
 * Reducers and module-level initialisers run on the server in the App Router,
 * where `window` does not exist — and in Safari private mode even reading
 * throws. Every access goes through here so a missing or hostile store
 * degrades to `null` instead of a 500.
 *
 * Note this only makes access *safe*, not *hydration-correct*: state that
 * differs between server and client must still be loaded after mount, which is
 * what the `hydrate*` reducers in store/ are for.
 */
const makeStorage = (pick) => ({
  get(key) {
    if (typeof window === "undefined") return null;
    try {
      return pick()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    if (typeof window === "undefined") return;
    try {
      pick()?.setItem(key, value);
    } catch {
      // Quota exceeded or storage blocked — non-fatal.
    }
  },
  remove(key) {
    if (typeof window === "undefined") return;
    try {
      pick()?.removeItem(key);
    } catch {
      // Non-fatal.
    }
  },
  getJSON(key, fallback = null) {
    const raw = this.get(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  setJSON(key, value) {
    this.set(key, JSON.stringify(value));
  },
});

export const storage = makeStorage(() => window.localStorage);
export const sessionCache = makeStorage(() => window.sessionStorage);

/**
 * Format a value that's ALREADY in Taka (order/checkout totals, receipts,
 * coupon amounts, admin revenue aggregates — anything sourced from an
 * Order document, whose monetary fields are converted to BDT once at order
 * creation, see services/orderService.js's toRegionCurrency) — never a raw
 * catalog price. Bangla digits for `locale === "bn-BD"`, English digits
 * otherwise; always the ৳ symbol, never $/USD. For a RAW, USD-denominated
 * catalog price (Product.basePrice, variant.price, etc. — see
 * services/productService.js) use useSettings().formatPrice() instead,
 * which additionally applies the live exchange-rate conversion this
 * function deliberately does not.
 */
export const formatCurrency = (value, locale = "en-BD") => formatBdt(value, locale);

export const formatDate = (date) =>
  new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));

export const formatDateTime = (date) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));

// Resolve a product image path — handles both local (/images/1.png) and absolute URLs.
// For Cloudinary URLs, inject f_auto,q_auto[,w_<width>] so we serve WebP/AVIF at the right size.
export const resolveImage = (src, width) => {
  if (!src) return "/images/placeholder.webp";
  if (src.startsWith("data:")) return src;
  if (src.includes("res.cloudinary.com") && src.includes("/upload/")) {
    const transform = width
      ? `f_auto,q_auto,w_${width},c_limit`
      : "f_auto,q_auto";
    // Avoid double-injecting if a transform already exists
    if (/\/upload\/[^/]*[a-z]_[^/]+\//.test(src)) return src;
    return src.replace("/upload/", `/upload/${transform}/`);
  }
  // Local seed images live as PNG in DB but we ship WebP — swap on the fly
  if (/^\/images\/[^/]+\.png$/i.test(src)) {
    return src.replace(/\.png$/i, ".webp");
  }
  return src;
};

// Gender → emoji (for display variety)
export const genderIcon = (g) =>
  ({ men: "♂", women: "♀", kids: "★", unisex: "⚡" }[g] || "");

// Truncate long strings
export const truncate = (s, n = 60) =>
  String(s || "").length > n ? String(s).slice(0, n - 1) + "…" : String(s || "");

// Classname helper for active route
export const activeClass = (isActive, base, active) =>
  cn(base, isActive && active);

/**
 * Build a query string, dropping undefined/null/empty-string values instead
 * of letting URLSearchParams stringify them as the literal text "undefined"
 * (its actual behavior when handed a plain object — `new
 * URLSearchParams({a: undefined})` produces "a=undefined", not "").
 * Nested plain-object values become bracket params (price: {gte, lte} ->
 * price[gte]=X&price[lte]=Y), matching the shape services/productService.js
 * already expects for range filters.
 */
export const buildQueryString = (params = {}) => {
  const q = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined || val === null || val === "") continue;
    if (typeof val === "object" && !Array.isArray(val)) {
      for (const [op, v] of Object.entries(val)) {
        if (v !== undefined && v !== null && v !== "") q.append(`${key}[${op}]`, v);
      }
    } else {
      q.append(key, val);
    }
  }
  return q.toString();
};

/**
 * Modest-fashion variant resolution.
 *
 * A product's variants vary along up to three axes — color, size/length,
 * fabric — and any subset of them (a Hijab varies only by color; an Abaya
 * by color+size; nothing in the current catalog varies by all three yet).
 * Collapsing that down to a bare size string discards color/fabric and
 * makes two different variants indistinguishable (see the Phase 4 audit —
 * this was a live bug: Instant Jersey Hijab's 3 color variants all report
 * the same "free-size" size). Shared by ProductDetailPage.jsx and
 * QuickAddSheet.jsx so both resolve variants the same, correct way.
 */
const VARIANT_AXES = ["color", "size", "fabric"];

// Which axes this product actually has a real value for — shown as a
// selector row even when there's only one option (a single-color Burqa
// still shows "Color: Black" as a filled-in swatch, not nothing). Color and
// size/length are purchasing decisions in modest fashion regardless of
// variant count; only an axis with zero real values across every variant
// (nothing to show at all) is excluded.
export const getVariantAxes = (variants = []) =>
  VARIANT_AXES.filter((axis) => {
    const values = new Set(variants.map((v) => v.attributes?.[axis]).filter(Boolean));
    return values.size >= 1;
  });

// Available values for one axis, given the current selection on the other
// axes — so picking a color narrows which sizes are even possible, and a
// value maps to disabled:true only when every variant matching the other
// selected axes at that value is out of stock (never a variant that
// doesn't exist at all — those simply don't appear as options).
export const getAxisOptions = (variants = [], axis, selection = {}) => {
  const others = VARIANT_AXES.filter((a) => a !== axis);
  const matching = variants.filter((v) =>
    others.every((a) => !selection[a] || v.attributes?.[a] === selection[a]),
  );
  const seen = new Map();
  for (const v of matching) {
    const val = v.attributes?.[axis];
    if (!val || seen.has(val)) continue;
    const forThisValue = matching.filter((mv) => mv.attributes?.[axis] === val);
    seen.set(val, forThisValue.every((mv) => (mv.stock ?? 0) <= 0));
  }
  return [...seen.entries()].map(([value, disabled]) => ({ value, disabled }));
};

// The single variant a full selection resolves to (only the axes that
// actually vary need to match — see getVariantAxes).
export const resolveVariant = (variants = [], selection = {}) =>
  variants.find((v) => VARIANT_AXES.every((a) => !selection[a] || v.attributes?.[a] === selection[a])) || null;

// Sensible default on first load: the first in-stock variant (falling back
// to the first variant if everything's out of stock), so price/stock/
// gallery show something real immediately instead of a blank "pick
// options" state.
export const getDefaultVariantSelection = (variants = []) => {
  const first = variants.find((v) => (v.stock ?? 0) > 0) || variants[0];
  if (!first) return {};
  return {
    color: first.attributes?.color || "",
    size: first.attributes?.size || "",
    fabric: first.attributes?.fabric || "",
  };
};

// After changing one axis, repair the others if the current combination no
// longer resolves to a real, in-stock-preferring variant — so a selection
// can never point at a nonexistent or (when an in-stock alternative
// exists) needlessly out-of-stock combination.
export const repairVariantSelection = (variants = [], selection = {}) => {
  const next = { ...selection };
  for (const axis of VARIANT_AXES) {
    const options = getAxisOptions(variants, axis, next);
    if (!options.length) continue;
    const stillValid = options.find((o) => o.value === next[axis]);
    if (!stillValid || stillValid.disabled) {
      const firstAvailable = options.find((o) => !o.disabled) || options[0];
      next[axis] = firstAvailable.value;
    }
  }
  return next;
};

// Variant → effective price/discount/stock, mirroring
// services/productService.js's own resolution rule: "effective price =
// variant.price ?? product.basePrice".
export const resolveVariantPricing = (product, variant) => {
  const effectivePrice = variant?.price ?? product?.basePrice;
  const effectiveDiscount = variant?.discountPrice ?? product?.discountPrice;
  const displayPrice = effectiveDiscount ?? effectivePrice;
  const hasDiscount = !!(effectiveDiscount && effectiveDiscount < effectivePrice);
  return {
    price: effectivePrice,
    discountPrice: effectiveDiscount,
    displayPrice,
    hasDiscount,
    stock: variant?.stock ?? 0,
  };
};
