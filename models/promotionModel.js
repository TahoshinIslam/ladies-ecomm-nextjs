import mongoose from "mongoose";

import { TARGET_TYPES, COLLECTION_VALUES, AUDIENCES, PAGE_SCOPES, FREQUENCIES } from "../lib/promotionConstants.js";

// Admin-managed promotions — backs two storefront surfaces from one model
// (see services/promotionService.js's own comment for why one model, not
// two): the homepage hero carousel (`placement: "home_hero"`, `type:
// "carousel"`) and visitor campaign popups (`placement: "storefront_popup"`,
// `type: "popup"`). Both share the same target/schedule/audience contract —
// a carousel banner and a popup campaign are the same "show this creative,
// linking to this safe destination, under these conditions" shape with a
// different presentation, not two different domains.
//
// `title`/`subtitle`/`ctaLabel` and their `...Bn` counterparts are plain
// admin-authored copy fields (this codebase's app-chrome strings go through
// lib/i18n's translation-key dictionaries, but promotion content is
// per-campaign prose an admin writes directly — there is no translation key
// for "20% off this weekend only").
const shopFilterSchema = new mongoose.Schema(
  {
    category: { type: mongoose.Schema.Types.ObjectId, ref: "categories", default: null },
    collection: { type: String, enum: COLLECTION_VALUES, default: null },
    style: { type: mongoose.Schema.Types.ObjectId, ref: "categories", default: null },
  },
  { _id: false },
);

const promotionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: ["carousel", "popup"], required: true },
    // Kept alongside `type` (rather than derived) so a future placement can
    // be added for the same type without a migration — today carousel is
    // always home_hero and popup is always storefront_popup, but nothing in
    // the query layer assumes that 1:1 mapping.
    placement: { type: String, enum: ["home_hero", "storefront_popup"], required: true },
    status: { type: String, enum: ["draft", "active", "paused"], default: "draft" },

    title: { type: String, trim: true, maxlength: 200, default: "" },
    titleBn: { type: String, trim: true, maxlength: 200, default: "" },
    subtitle: { type: String, trim: true, maxlength: 400, default: "" },
    subtitleBn: { type: String, trim: true, maxlength: 400, default: "" },
    ctaLabel: { type: String, trim: true, maxlength: 60, default: "" },
    ctaLabelBn: { type: String, trim: true, maxlength: 60, default: "" },

    desktopImage: { type: String, required: true },
    mobileImage: { type: String, default: "" },
    imageAlt: { type: String, trim: true, maxlength: 200, default: "" },
    imageAltBn: { type: String, trim: true, maxlength: 200, default: "" },

    targetType: { type: String, enum: TARGET_TYPES, default: "none" },
    targetProduct: { type: mongoose.Schema.Types.ObjectId, ref: "products", default: null },
    targetCategory: { type: mongoose.Schema.Types.ObjectId, ref: "categories", default: null },
    targetCollection: { type: String, enum: COLLECTION_VALUES, default: null },
    targetShopFilter: { type: shopFilterSchema, default: null },
    // Validated at the schema layer (schemas/promotionSchemas.js's
    // internalPathSchema) AND again in services/promotionService.js's
    // resolvePromotionTarget() — defense in depth, matching this app's
    // existing pattern (see schemas/commonSchemas.js's own comments).
    targetUrl: { type: String, trim: true, maxlength: 300, default: "" },

    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    priority: { type: Number, default: 0, min: 0, max: 1000 },
    sortOrder: { type: Number, default: 0, min: 0, max: 10000 },

    audience: { type: String, enum: AUDIENCES, default: "all" },
    pageScope: { type: String, enum: PAGE_SCOPES, default: "home" },

    // Popup-only fields — harmless/unused on a carousel document.
    popupDelayMs: { type: Number, default: 2000, min: 500, max: 10000 },
    frequency: { type: String, enum: FREQUENCIES, default: "once_per_session" },
    cooldownHours: { type: Number, default: null, min: 1, max: 24 * 90 },

    // Bumped by services/promotionService.js whenever creative/targeting
    // meaningfully changes, so a visitor who already dismissed the OLD
    // version of a campaign sees the new one — see CampaignPopup.jsx's own
    // comment on how the client compares this against its stored value.
    version: { type: Number, default: 1, min: 1 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
  },
  { timestamps: true },
);

// Public eligibility query shape (services/promotionService.js's
// getEligiblePromotions()): { type, placement, status: "active", pageScope,
// startAt/endAt bounds }, sorted by sortOrder/priority. This one compound
// index covers the entire filter + both sort keys used there.
promotionSchema.index({ type: 1, placement: 1, status: 1, pageScope: 1, sortOrder: 1, priority: -1 });
// Admin list page's own filter-by-type/status view.
promotionSchema.index({ type: 1, status: 1, createdAt: -1 });
// Scheduling sweep — "what's currently active/scheduled/expired" for the
// admin list's status labels, and the eligibility query's own startAt/endAt
// bounds checks.
promotionSchema.index({ startAt: 1, endAt: 1 });

const Promotion = mongoose.models.promotions || mongoose.model("promotions", promotionSchema);
export default Promotion;
