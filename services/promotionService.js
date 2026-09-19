import Promotion from "../models/promotionModel.js";
import Product from "../models/productModel.js";
import Category from "../models/categoryModel.js";
import { HttpError } from "../lib/http.js";
import { requireObjectIdFormat, isObjectIdFormat } from "../lib/validation.js";
import { isSafeInternalPath } from "../schemas/promotionSchemas.js";
import { sanitizeFraming } from "../lib/imageFraming.js";

// One shared model backs two storefront surfaces (the homepage hero
// carousel and visitor campaign popups) rather than two competing schemas.

// Fields that change what a visitor actually SEES or is sent to — bumping
// `version` on any of these (see updatePromotion() below) intentionally
// resets a popup visitor's stored "already dismissed/shown" eligibility
// (CampaignPopup.jsx compares its stored version against the live one).
const CREATIVE_FIELDS = [
  "title", "titleBn", "subtitle", "subtitleBn", "ctaLabel", "ctaLabelBn",
  "desktopImage", "mobileImage", "desktopFraming", "mobileFraming", "imageAlt", "imageAltBn",
  "targetType", "targetProduct", "targetCategory", "targetCollection", "targetShopFilter", "targetUrl",
];

// ================================================================ ADMIN

export async function listPromotionsAdmin({ type, status } = {}) {
  return Promotion.findAll({ type, status });
}

// `placement` is a 1:1 derivation of `type` — the admin form never submits
// it directly, so it's computed here rather than required as its own input.
const PLACEMENT_BY_TYPE = { carousel: "home_hero", popup: "storefront_popup" };

// Framing is stored via its own statement (models/promotionModel.js), and on
// a database without migration 0006 there is nowhere to put it — refuse
// loudly BEFORE writing anything rather than silently dropping the crop.
async function assertFramingStorage(...framings) {
  if (framings.some(Boolean) && !(await Promotion.framingInstalled())) {
    throw new HttpError(409, "Image framing storage is not installed on this database — run scripts/runMigrations.mjs (migration 0006_image_framing) first.");
  }
}

async function persistFraming(id, desktopFraming, mobileFraming) {
  if (!(await Promotion.framingInstalled())) return;
  await Promotion.writeFraming(id, sanitizeFraming(desktopFraming), sanitizeFraming(mobileFraming));
}

export async function createPromotion(body, userId) {
  await assertFramingStorage(body.desktopFraming, body.mobileFraming);
  const created = await Promotion.create({
    ...body,
    placement: PLACEMENT_BY_TYPE[body.type],
    createdBy: userId || null,
    updatedBy: userId || null,
  });
  await persistFraming(created._id, body.desktopFraming, body.mobileFraming);
  return Promotion.findById(created._id);
}

export async function updatePromotion(id, body, userId) {
  requireObjectIdFormat(id, "id");
  const existing = await Promotion.findById(id);
  if (!existing) throw new HttpError(404, "Promotion not found");

  const creativeChanged = CREATIVE_FIELDS.some(
    (field) => field in body && JSON.stringify(body[field] ?? null) !== JSON.stringify(existing[field] ?? null),
  );

  // A crop describes one specific image: replacing the image without also
  // sending a new crop must not leave the old crop applied to the new picture.
  const staleFraming = {};
  if ("desktopImage" in body && body.desktopImage !== existing.desktopImage && !("desktopFraming" in body)) staleFraming.desktopFraming = null;
  if ("mobileImage" in body && body.mobileImage !== existing.mobileImage && !("mobileFraming" in body)) staleFraming.mobileFraming = null;
  await assertFramingStorage(body.desktopFraming, body.mobileFraming);

  Object.assign(existing, body, staleFraming, { updatedBy: userId || null });
  // Defense in depth to match createPromotion() above — the admin form
  // never changes `type` on an existing promotion (disabled in the editor
  // once created), but a direct API call that did must not leave
  // `placement` stale.
  if (body.type) existing.placement = PLACEMENT_BY_TYPE[body.type];
  if (creativeChanged) existing.version += 1;
  await existing.save();
  await persistFraming(existing._id, existing.desktopFraming, existing.mobileFraming);
  return existing;
}

export async function duplicatePromotion(id, userId) {
  requireObjectIdFormat(id, "id");
  const source = await Promotion.findById(id);
  if (!source) throw new HttpError(404, "Promotion not found");
  const { _id, createdAt, updatedAt, save, ...rest } = source;
  void _id;
  void createdAt;
  void updatedAt;
  void save;
  const copy = await Promotion.create({
    ...rest,
    name: `${source.name} (copy)`,
    status: "draft",
    version: 1,
    createdBy: userId || null,
    updatedBy: userId || null,
  });
  // create() doesn't write framing (see persistFraming) — carry the crops over.
  await persistFraming(copy._id, source.desktopFraming, source.mobileFraming);
  return Promotion.findById(copy._id);
}

export async function deletePromotion(id) {
  requireObjectIdFormat(id, "id");
  const deleted = await Promotion.deleteById(id);
  if (!deleted) throw new HttpError(404, "Promotion not found");
}

// Reassigns sortOrder to match `order` (an array of every promotion id of
// `type`, in the admin's intended display order) — scoped to `type` so
// reordering carousel banners can never touch a popup's sortOrder or vice
// versa.
export async function reorderPromotions(type, order) {
  const existingIds = new Set(await Promotion.findIdsByType(type));
  for (const id of order) {
    if (!existingIds.has(id)) throw new HttpError(400, "order lists an id that doesn't belong to this promotion type");
  }
  await Promise.all(order.map((id, index) => Promotion.updateSortOrder(id, type, index)));
  return listPromotionsAdmin({ type });
}

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
