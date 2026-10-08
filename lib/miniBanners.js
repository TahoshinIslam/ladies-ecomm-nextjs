import { isRealDiscount } from "./utils.js";

/**
 * The (up to three) products shown as small banners beside the homepage carousel: real products only — discounted ones first, then the
 * rest of the featured and new arrivals — and only ones a shopper can actually buy (some variant in stock). Never repeats a product.
 * Fewer than three buyable products means fewer banners, not placeholders.
 */
export function pickMiniBannerProducts(featured = [], arrivals = [], max = 3) {
  const buyable = (p) => (p.variants?.length ? p.variants.some((v) => (v.stock ?? 0) > 0) : (p.stock ?? 0) > 0);
  const picked = [];
  const seen = new Set();
  for (const pool of [featured.filter(isRealDiscount), arrivals.filter(isRealDiscount), featured, arrivals]) {
    for (const p of pool) {
      if (picked.length >= max) return picked;
      if (!seen.has(p._id) && buyable(p)) {
        seen.add(p._id);
        picked.push(p);
      }
    }
  }
  return picked;
}

// A link from settings must stay inside the shop: a rooted path, never "//host" or a full URL.
const insidePath = (href) => (typeof href === "string" && href.startsWith("/") && !href.startsWith("//") ? href : "");

/**
 * The three small banners beside the carousel, in order. A slot the owner has set a picture for (Settings → Shop layout → Offer
 * banners) shows that picture and links where they chose; an empty slot falls back to the next product card, so a banner is never blank.
 */
export function buildMiniBannerSlots(configured = [], products = [], max = 3) {
  const pool = [...products];
  const slots = [];
  for (let i = 0; i < max; i += 1) {
    const entry = Array.isArray(configured) ? configured[i] : null;
    const imageUrl = typeof entry?.imageUrl === "string" ? entry.imageUrl.trim() : "";
    if (imageUrl) {
      slots.push({ kind: "image", key: `image-${i}`, index: i, imageUrl, href: insidePath(entry.href) || "/shop" });
      continue;
    }
    const product = pool.shift();
    if (product) slots.push({ kind: "product", key: product._id, product });
  }
  return slots;
}
