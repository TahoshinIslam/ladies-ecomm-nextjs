import Promotion from "../models/promotionModel.js";
import Product from "../models/productModel.js";
import Category from "../models/categoryModel.js";
import { isObjectIdFormat } from "../lib/validation.js";
import { isSafeInternalPath } from "../schemas/promotionSchemas.js";

// ================================================================ TARGET RESOLUTION

// The ONE place a public href is ever computed from a promotion's stored
// target. Returns `{ href, clickable }`; `href` is only ever `null` (with
// `clickable:false`) — never a partially-built or unsafe string.
export async function resolvePromotionTarget(promotion) {
  switch (promotion.targetType) {
    case "product": {
      if (!isObjectIdFormat(String(promotion.targetProduct || ""))) return { href: null, clickable: false };
      const product = await Product.findById(promotion.targetProduct);
      if (!product || product.isActive === false) return { href: null, clickable: false };
      return { href: `/product/${product.slug || product._id}`, clickable: true };
    }
    case "category": {
      if (!isObjectIdFormat(String(promotion.targetCategory || ""))) return { href: null, clickable: false };
      const category = await Category.findById(promotion.targetCategory);
      if (!category || category.isActive === false) return { href: null, clickable: false };
      return { href: `/shop?category=${promotion.targetCategory}`, clickable: true };
    }
    case "collection": {
      const value = promotion.targetCollection;
      if (!["new", "featured", "discount"].includes(value)) return { href: null, clickable: false };
      return { href: `/shop?collection=${value}`, clickable: true };
    }
    case "shop_filter": {
      const filter = promotion.targetShopFilter;
      if (!filter) return { href: null, clickable: false };
      const params = new URLSearchParams();
      if (filter.category && isObjectIdFormat(String(filter.category))) {
        const category = await Category.findById(filter.category);
        if (category && category.isActive !== false) params.set("category", String(filter.category));
      }
      if (filter.collection && ["new", "featured", "discount"].includes(filter.collection)) {
        params.set("collection", filter.collection);
      }
      if (filter.style && isObjectIdFormat(String(filter.style))) {
        const style = await Category.findById(filter.style);
        if (style && style.isActive !== false) params.set("style", String(filter.style));
      }
      if ([...params.keys()].length === 0) return { href: null, clickable: false };
      return { href: `/shop?${params.toString()}`, clickable: true };
    }
    case "internal_url": {
      // Re-checked here even though schemas/promotionSchemas.js already
      // validated it at write time — defense in depth.
      if (!isSafeInternalPath(promotion.targetUrl || "")) return { href: null, clickable: false };
      return { href: promotion.targetUrl, clickable: true };
    }
    case "none":
    default:
      return { href: null, clickable: false };
  }
}

// ================================================================ PUBLIC ELIGIBILITY

// Deliberately audience-BLIND — see lib/serverDataCache.js's own comment:
// authentication state must never leak into a cache shared across every
// visitor. Callers (app/api/promotions/*/route.js) filter the returned
// array by the requesting visitor's own audience AFTER this (cached) read
// resolves, never before.
export async function getEligiblePromotionsBase({ type, placement, pageScope, now = new Date() }) {
  const candidates = await Promotion.findEligible({ type, placement, pageScope, now });

  const resolved = await Promise.all(
    candidates.map(async (p) => {
      const target = await resolvePromotionTarget(p);
      if (!target.clickable && p.targetType !== "none") return null; // stale target — omit
      return toPublicDto(p, target);
    }),
  );
  return resolved.filter(Boolean);
}

// Public-safe DTO — never createdBy/updatedBy/internal notes/audit
// details/raw Cloudinary credentials/unpublished status/raw target ids.
function toPublicDto(promotion, target) {
  return {
    id: String(promotion._id),
    title: promotion.title || "",
    titleBn: promotion.titleBn || "",
    subtitle: promotion.subtitle || "",
    subtitleBn: promotion.subtitleBn || "",
    ctaLabel: promotion.ctaLabel || "",
    ctaLabelBn: promotion.ctaLabelBn || "",
    desktopImage: promotion.desktopImage,
    mobileImage: promotion.mobileImage || "",
    desktopFraming: promotion.desktopFraming || null,
    mobileFraming: promotion.mobileFraming || null,
    imageAlt: promotion.imageAlt || "",
    imageAltBn: promotion.imageAltBn || "",
    href: target.href,
    clickable: target.clickable,
    audience: promotion.audience,
    popupDelayMs: promotion.popupDelayMs,
    frequency: promotion.frequency,
    cooldownHours: promotion.cooldownHours,
    version: promotion.version,
  };
}

// Applies the visitor's own audience AFTER the shared cached read.
// `isAuthenticated` is resolved by the route handler from the request's
// own session cookie, never cached.
export function filterByAudience(promotions, isAuthenticated) {
  return promotions.filter((p) => {
    if (p.audience === "all") return true;
    if (p.audience === "guest") return !isAuthenticated;
    if (p.audience === "customer") return isAuthenticated;
    return false;
  });
}
