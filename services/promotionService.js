import Promotion from "../models/promotionModel.js";
import Product from "../models/productModel.js";
import Category from "../models/categoryModel.js";
import { HttpError } from "../lib/http.js";
import { requireObjectIdFormat, isObjectIdFormat } from "../lib/validation.js";
import { isSafeInternalPath } from "../schemas/promotionSchemas.js";

// One shared model backs two storefront surfaces (the homepage hero
// carousel and visitor campaign popups) rather than two competing schemas —
// see models/promotionModel.js's own comment. Every admin mutation here
// only ever writes an already Zod-`.strict()`-validated body
// (schemas/promotionSchemas.js), so — matching services/couponService.js's
// exact precedent — `Promotion.create(body)` / `findByIdAndUpdate(id,
// body, ...)` is safe as-is with no separate field-picking step.

// Fields that change what a visitor actually SEES or is sent to — bumping
// `version` on any of these (see updatePromotion() below) intentionally
// resets a popup visitor's stored "already dismissed/shown" eligibility
// (CampaignPopup.jsx compares its stored version against the live one).
// Deliberately excludes status/schedule/priority/audience/pageScope/
// frequency: pausing-then-reactivating the SAME creative, or nudging its
// priority, should not force everyone who already saw it to see it again.
const CREATIVE_FIELDS = [
  "title", "titleBn", "subtitle", "subtitleBn", "ctaLabel", "ctaLabelBn",
  "desktopImage", "mobileImage", "imageAlt", "imageAltBn",
  "targetType", "targetProduct", "targetCategory", "targetCollection", "targetShopFilter", "targetUrl",
];

// ================================================================ ADMIN

export async function listPromotionsAdmin({ type, status } = {}) {
  const filter = {};
  if (type) filter.type = type;
  if (status) filter.status = status;
  return Promotion.find(filter).sort({ sortOrder: 1, priority: -1, _id: 1 }).lean();
}

// `placement` is a 1:1 derivation of `type` (today at least — see
// models/promotionModel.js's own comment on why they're still two separate
// fields) — the admin form never submits it directly, so it's computed
// here rather than required as its own input.
const PLACEMENT_BY_TYPE = { carousel: "home_hero", popup: "storefront_popup" };

export async function createPromotion(body, userId) {
  return Promotion.create({
    ...body,
    placement: PLACEMENT_BY_TYPE[body.type],
    createdBy: userId || null,
    updatedBy: userId || null,
  });
}

export async function updatePromotion(id, body, userId) {
  requireObjectIdFormat(id, "id");
  const existing = await Promotion.findById(id);
  if (!existing) throw new HttpError(404, "Promotion not found");

  const creativeChanged = CREATIVE_FIELDS.some(
    (field) => field in body && JSON.stringify(body[field] ?? null) !== JSON.stringify(existing[field] ?? null),
  );

  Object.assign(existing, body, { updatedBy: userId || null });
  // Defense in depth to match createPromotion() above — the admin form
  // never changes `type` on an existing promotion (disabled in the editor
  // once created), but a direct API call that did must not leave
  // `placement` stale.
  if (body.type) existing.placement = PLACEMENT_BY_TYPE[body.type];
  if (creativeChanged) existing.version += 1;
  await existing.save();
  return existing;
}

export async function duplicatePromotion(id, userId) {
  requireObjectIdFormat(id, "id");
  const source = await Promotion.findById(id).lean();
  if (!source) throw new HttpError(404, "Promotion not found");
  const { _id, createdAt, updatedAt, __v, ...rest } = source;
  return Promotion.create({
    ...rest,
    name: `${source.name} (copy)`,
    status: "draft",
    version: 1,
    createdBy: userId || null,
    updatedBy: userId || null,
  });
}

export async function deletePromotion(id) {
  requireObjectIdFormat(id, "id");
  const promotion = await Promotion.findByIdAndDelete(id);
  if (!promotion) throw new HttpError(404, "Promotion not found");
}

// Reassigns sortOrder to match `order` (an array of every promotion id of
// `type`, in the admin's intended display order) — scoped to `type` so
// reordering carousel banners can never touch a popup's sortOrder or vice
// versa. Individual updateOne() calls (not updateMany/bulkWrite) — the
// list is admin-bounded (schemas/promotionSchemas.js caps it at 200) and
// this keeps every write an explicit, individually-auditable operation
// matching this codebase's existing preference for narrow, obvious writes
// over broad batch operators (see scripts/auditIndexes.mjs's own comment
// on the same tradeoff).
export async function reorderPromotions(type, order) {
  const existingIds = new Set((await Promotion.find({ type }).select("_id").lean()).map((p) => String(p._id)));
  for (const id of order) {
    if (!existingIds.has(id)) throw new HttpError(400, "order lists an id that doesn't belong to this promotion type");
  }
  await Promise.all(order.map((id, index) => Promotion.updateOne({ _id: id, type }, { $set: { sortOrder: index } })));
  return listPromotionsAdmin({ type });
}

// ================================================================ TARGET RESOLUTION

// The ONE place a public href is ever computed from a promotion's stored
// target — both the carousel and popup public services call this, and the
// client never independently builds a URL from raw target fields (the
// public DTOs below don't even expose targetProduct/targetCategory as
// separate ids — only the already-resolved `href`). Returns `{ href,
// clickable }`; `href` is only ever `null` (with `clickable:false`) — never
// a partially-built or unsafe string — so nothing downstream can render an
// unsafe/broken link.
export async function resolvePromotionTarget(promotion) {
  switch (promotion.targetType) {
    case "product": {
      if (!isObjectIdFormat(String(promotion.targetProduct || ""))) return { href: null, clickable: false };
      const product = await Product.findById(promotion.targetProduct).select("slug isActive").lean();
      if (!product || product.isActive === false) return { href: null, clickable: false };
      return { href: `/product/${product.slug || product._id}`, clickable: true };
    }
    case "category": {
      if (!isObjectIdFormat(String(promotion.targetCategory || ""))) return { href: null, clickable: false };
      const category = await Category.findById(promotion.targetCategory).select("isActive").lean();
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
        const category = await Category.findById(filter.category).select("isActive").lean();
        if (category && category.isActive !== false) params.set("category", String(filter.category));
      }
      if (filter.collection && ["new", "featured", "discount"].includes(filter.collection)) {
        params.set("collection", filter.collection);
      }
      if (filter.style && isObjectIdFormat(String(filter.style))) {
        const style = await Category.findById(filter.style).select("isActive").lean();
        if (style && style.isActive !== false) params.set("style", String(filter.style));
      }
      if ([...params.keys()].length === 0) return { href: null, clickable: false };
      return { href: `/shop?${params.toString()}`, clickable: true };
    }
    case "internal_url": {
      // Re-checked here even though schemas/promotionSchemas.js already
      // validated it at write time — this function is the one place a
      // response is actually built, so it re-verifies rather than trusting
      // that nothing between write and read could have changed the
      // contract (defense in depth, matching this app's existing pattern —
      // see schemas/commonSchemas.js's own comment on the same idea).
      if (!isSafeInternalPath(promotion.targetUrl || "")) return { href: null, clickable: false };
      return { href: promotion.targetUrl, clickable: true };
    }
    case "none":
    default:
      return { href: null, clickable: false };
  }
}

// ================================================================ PUBLIC ELIGIBILITY

// Deliberately audience-BLIND — see lib/serverDataCache.js's own comment
// and section H of the feature spec this implements: authentication state
// must never leak into a cache shared across every visitor. Callers
// (app/api/promotions/*/route.js) filter the returned array by the
// requesting visitor's own audience AFTER this (cached) read resolves,
// never before.
//
// A promotion whose target has gone stale (resolvePromotionTarget returns
// `clickable:false` for anything other than a deliberate `targetType:
// "none"` visual-only banner) is OMITTED from the result entirely, not
// returned as a dead link — see this module's own top-of-file note on
// that documented choice.
export async function getEligiblePromotionsBase({ type, placement, pageScope, now = new Date() }) {
  const scheduleFilter = {
    type,
    placement,
    status: "active",
    pageScope: { $in: pageScope === "home" ? ["home", "all"] : [pageScope, "all"] },
    $and: [
      { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
      { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
    ],
  };
  const sort = type === "popup" ? { priority: -1, startAt: -1, _id: 1 } : { sortOrder: 1, priority: -1, _id: 1 };
  const candidates = await Promotion.find(scheduleFilter).sort(sort).lean();

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

// Applies the visitor's own audience AFTER the shared cached read — see
// getEligiblePromotionsBase()'s comment. `isAuthenticated` is resolved by
// the route handler from the request's own session cookie, never cached.
export function filterByAudience(promotions, isAuthenticated) {
  return promotions.filter((p) => {
    if (p.audience === "all") return true;
    if (p.audience === "guest") return !isAuthenticated;
    if (p.audience === "customer") return isAuthenticated;
    return false;
  });
}
