import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

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
 * Format a number as currency.
 * BDT renders with ৳ symbol but English numerals (cleaner than Bengali).
 * USD renders normally.
 */
export const formatCurrency = (value, currency = "USD") => {
  const num = Number(value) || 0;
  if (currency === "BDT") {
    // en-BD locale gives English numerals + ৳ symbol via Intl
    return new Intl.NumberFormat("en-BD", {
      style: "currency",
      currency: "BDT",
      maximumFractionDigits: 0,
    }).format(num);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(num);
};

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
