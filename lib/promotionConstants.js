// Shared, dependency-free enum values for the Promotion domain — imported
// by BOTH models/promotionModel.js (Mongoose, server-only) and
// schemas/promotionSchemas.js (Zod, client-safe: imported directly by the
// admin promotion form for client-side validation). This file itself must
// stay free of any Mongoose/Node-only import, exactly like
// schemas/commonSchemas.js's own contract — a single shared source avoids
// the two ever drifting apart without needing the schema to import the
// model (which would break bundling in a Client Component) or vice versa.
export const TARGET_TYPES = ["product", "category", "collection", "shop_filter", "internal_url", "none"];
export const COLLECTION_VALUES = ["new", "featured", "discount"];
export const AUDIENCES = ["all", "guest", "customer"];
export const PAGE_SCOPES = ["home", "shop", "product", "category_collection", "all"];
export const FREQUENCIES = ["every_session", "once_per_session", "once_per_day", "once_per_campaign", "custom_cooldown"];
