import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import { formatBdt } from "./currency.js";

// Merge Tailwind classes safely (resolves conflicts like "p-2 p-4" → "p-4")
export const cn = (...inputs) => twMerge(clsx(inputs));

// The ONE shared definition of "what a shopper actually pays" — a real
// discount requires discountPrice > 0 AND discountPrice < basePrice, the
// same invariant services/productService.js's assertDiscountsValid already
// enforces at save time (this is the read-side mirror of that rule, not a
// second one). Every price-aware read path — ProductCard display, shop
// price-range filtering/sorting, collection=discount matching, discount
// facet counts — imports this instead of re-deriving `discountPrice ??
// basePrice` locally (which, using `??` instead of a real `> 0` check,
// would wrongly treat a literal discountPrice of 0 as "the price," showing
// ৳0 instead of falling back to basePrice).
export const isRealDiscount = (product) => {
  const { basePrice, discountPrice } = product || {};
  return discountPrice != null && discountPrice > 0 && discountPrice < basePrice;
};

export const effectivePrice = (product) => (isRealDiscount(product) ? product.discountPrice : product?.basePrice);

// Pure, framework-free responsive batch-size lookup for the shop grid's
// "Load more" button — deliberately NOT used to decide what's visible on
// first paint (that's server-rendered CSS, see ShopPageClient.jsx's
// per-card nth-position classes) — only how many additional products a
// click reveals/fetches on each device class. Unit-testable without any
// DOM/jsdom, since this repo has neither.
export const RESPONSIVE_BATCH_SIZES = { desktop: 12, tablet: 9, mobile: 8 };
export const responsiveBatchSize = (breakpoint) => RESPONSIVE_BATCH_SIZES[breakpoint] ?? RESPONSIVE_BATCH_SIZES.desktop;

// Server-rendered up to `bufferSize` (12) cards; the first-paint visible
// COUNT per breakpoint is smaller on tablet/mobile (9/8) — the remaining
// buffered-but-not-yet-visible cards are what "Load more" reveals first,
// before ever fetching a new page. Pure and DOM-free so it's directly
// unit-testable: given a breakpoint and how many extra cards the user has
// already asked to reveal, how many of the buffer are visible right now.
export const visibleBufferCount = (breakpoint, revealedExtra = 0, bufferSize = 12) => {
  const base = responsiveBatchSize(breakpoint);
  return Math.min(bufferSize, base + Math.max(0, revealedExtra));
};

// A "department" (Burqa, Cosmetics, ...) is any category that is the
// direct parent of at least one real leaf/style — the only kind of
// category id Product.topCategory ever equals (see models/productModel.js's
// pre-validate hook), and the only valid scope for
// AttributeDefinition.appliesToCategories. Deliberately NOT `!c.parent` —
// since Clothes was introduced as a real parent of Burqa/Hijab/etc., a
// root category (a "division") is no longer always a department; Cosmetics/
// Shoes/Sunglasses still are (root AND department, their children being
// leaves), while Clothes is a root but NOT a department (its children —
// Burqa etc. — are themselves departments, not leaves).
export const isDepartmentCategory = (category, allCategories) =>
  allCategories.some(
    (child) =>
      String(child.parent) === String(category._id) &&
      !allCategories.some((grandchild) => String(grandchild.parent) === String(child._id)),
  );

// How many hops up to a root: 0 for a root/division (Clothes, Cosmetics),
// 1 for a department (Burqa, one hop below Clothes), 2 for a leaf/style
// (burqa-saudi-style). Mirrors services/categoryService.js's validateParent
// depth cap (at most 3 levels total, i.e. depth 0/1/2) — used by the admin
// category tree to decide which categories can still take a new child.
export const categoryDepth = (category, allCategories) => {
  let depth = 0;
  let current = category;
  while (current?.parent) {
    depth += 1;
    current = allCategories.find((c) => String(c._id) === String(current.parent));
    if (!current) break;
  }
  return depth;
};

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
 * Category-agnostic variant resolution.
 *
 * A product's variants vary along an arbitrary set of axes — color/size/
 * fabric for clothing, shade/volumeMl for cosmetics — and any subset of
 * them (a Hijab varies only by color; an Abaya by color+size; a lipstick
 * only by shade). Which keys are candidate axes for a given product is the
 * caller's job: pass the `derivedFromVariant` AttributeDefinition keys that
 * apply to the product's department (both ProductDetailInteractive.jsx and
 * QuickAddSheet.jsx already have `attrDefs` in scope for exactly this).
 * `candidateAxes` defaults to the original clothing triple so any call site
 * not yet passing it keeps its previous behavior. Collapsing variant
 * identity down to a bare size string discards the other axes and makes two
 * different variants indistinguishable (see the Phase 4 audit — this was a
 * live bug: Instant Jersey Hijab's 3 color variants all reported the same
 * "free-size" size).
 */
const DEFAULT_VARIANT_AXES = ["color", "size", "fabric"];

// Which axes this product actually has a real value for — shown as a
// selector row even when there's only one option (a single-color Burqa
// still shows "Color: Black" as a filled-in swatch, not nothing). Only an
// axis with zero real values across every variant (nothing to show at all)
// is excluded.
export const getVariantAxes = (variants = [], candidateAxes = DEFAULT_VARIANT_AXES) =>
  candidateAxes.filter((axis) => {
    const values = new Set(variants.map((v) => v.attributes?.[axis]).filter(Boolean));
    return values.size >= 1;
  });

// Available values for one axis, given the current selection on the other
// axes — so picking a color narrows which sizes are even possible, and a
// value maps to disabled:true only when every variant matching the other
// selected axes at that value is out of stock (never a variant that
// doesn't exist at all — those simply don't appear as options).
export const getAxisOptions = (variants = [], axis, selection = {}, axes = DEFAULT_VARIANT_AXES) => {
  const others = axes.filter((a) => a !== axis);
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
export const resolveVariant = (variants = [], selection = {}, axes = DEFAULT_VARIANT_AXES) =>
  variants.find((v) => axes.every((a) => !selection[a] || v.attributes?.[a] === selection[a])) || null;

// Sensible default on first load: the first in-stock variant (falling back
// to the first variant if everything's out of stock), so price/stock/
// gallery show something real immediately instead of a blank "pick
// options" state.
export const getDefaultVariantSelection = (variants = [], axes = DEFAULT_VARIANT_AXES) => {
  const first = variants.find((v) => (v.stock ?? 0) > 0) || variants[0];
  if (!first) return {};
  const selection = {};
  for (const axis of axes) selection[axis] = first.attributes?.[axis] || "";
  return selection;
};

// After changing one axis, repair the others if the current combination no
// longer resolves to a real, in-stock-preferring variant — so a selection
// can never point at a nonexistent or (when an in-stock alternative
// exists) needlessly out-of-stock combination.
export const repairVariantSelection = (variants = [], selection = {}, axes = DEFAULT_VARIANT_AXES) => {
  const next = { ...selection };
  for (const axis of axes) {
    const options = getAxisOptions(variants, axis, next, axes);
    if (!options.length) continue;
    const stillValid = options.find((o) => o.value === next[axis]);
    if (!stillValid || stillValid.disabled) {
      const firstAvailable = options.find((o) => !o.disabled) || options[0];
      next[axis] = firstAvailable.value;
    }
  }
  return next;
};

// Renders an attributes bag (variant.attributes or a cart/order
// snapshot.attributes — same shape) as a "Black · XL · Nida" line — same
// bare-value, no-label format the cart/checkout/order pages already used
// for the fixed color/size/fabric fields, just generalized to an arbitrary
// key set (shade/volumeMl for cosmetics, ...) so no per-category code is
// needed at any of those call sites.
export const formatVariantAttributes = (attributes = {}, separator = " · ") =>
  Object.values(attributes).filter(Boolean).join(separator);

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
