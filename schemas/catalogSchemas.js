import { z } from "zod";

import { objectIdSchema, nonNegativeFiniteNumber, requiredString, urlSchema, paginationSchema, sortFieldSchema, sortOrderSchema, boundedIntParam } from "./commonSchemas.js";

// ====== Products ======

// Exported standalone (not just inlined below) so both server code
// (services/productService.js's AGE_GROUP_VALUES/query-facet filtering)
// and any client form (e.g. views/admin/ProductsPage.jsx's product-editor
// zod schema) share one source instead of hand-copying these three/three
// strings and risking drift if a value is ever added or renamed.
export const AGE_GROUP_VALUES_LIST = ["adult", "kids", "girls"];
export const AVAILABILITY_VALUES = ["readyStock", "preOrder", "madeToOrder"];

const variantAttributesSchema = z
  .object({
    color: z.string().trim().max(50).optional().default(""),
    size: z.string().trim().max(50).optional().default(""),
    fabric: z.string().trim().max(50).optional().default(""),
  })
  .strict()
  .optional()
  .default({});

const variantSchema = z
  .object({
    variantName: requiredString({ min: 1, max: 150 }),
    sku: requiredString({ min: 1, max: 60 }),
    attributes: variantAttributesSchema,
    price: z.union([z.null(), nonNegativeFiniteNumber]).optional(),
    discountPrice: z.union([z.null(), nonNegativeFiniteNumber]).optional(),
    stock: z.number().int().min(0).max(1_000_000),
    images: z.array(urlSchema).max(10).optional().default([]),
  })
  .strict();

const attributeValueSchema = z
  .object({
    key: requiredString({ min: 1, max: 100 }),
    values: z.array(z.string().trim().max(100)).max(50).optional().default([]),
  })
  .strict();

const measurementsSchema = z
  .object({
    heightRange: z.string().trim().max(50).optional().default(""),
    chest: z.string().trim().max(50).optional().default(""),
    sleeveLength: z.string().trim().max(50).optional().default(""),
  })
  .strict()
  .optional()
  .default({});

const productBaseFields = {
  name: requiredString({ min: 1, max: 200 }),
  nameBn: z.string().trim().max(200).optional().default(""),
  description: requiredString({ min: 1, max: 20000 }),
  descriptionBn: z.string().trim().max(20000).optional().default(""),
  category: objectIdSchema,
  brand: z.union([z.null(), objectIdSchema]).optional(),
  ageGroup: z.enum(AGE_GROUP_VALUES_LIST).optional().default("adult"),
  basePrice: nonNegativeFiniteNumber,
  discountPrice: z.union([z.null(), nonNegativeFiniteNumber]).optional(),
  images: z.array(urlSchema).min(1, "at least one image is required").max(20),
  variants: z.array(variantSchema).min(1, "at least one variant is required").max(100),
  attributes: z.array(attributeValueSchema).max(100).optional().default([]),
  measurements: measurementsSchema,
  includedItems: z.array(z.string().trim().max(200)).max(50).optional().default([]),
  availability: z.enum(AVAILABILITY_VALUES).optional().default("readyStock"),
  tags: z.array(z.string().trim().max(50)).max(50).optional().default([]),
  isFeatured: z.boolean().optional(),
  isActive: z.boolean().optional(),
  metaTitle: z.string().trim().max(200).optional().default(""),
  metaDescription: z.string().trim().max(500).optional().default(""),
  metaKeywords: z.string().trim().max(300).optional().default(""),
  ogImage: z.union([z.literal(""), urlSchema]).optional().default(""),
};

export const createProductSchema = z.object(productBaseFields).strict();
export const updateProductSchema = z
  .object(productBaseFields)
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" });

export const adminProductListQuerySchema = z
  .object({
    category: objectIdSchema.optional(),
    brand: objectIdSchema.optional(),
    ageGroup: z.enum(AGE_GROUP_VALUES_LIST).optional(),
    isActive: z.enum(["true", "false"]).optional(),
    search: z.string().trim().max(200).optional(),
    sortBy: sortFieldSchema(["createdAt", "name", "basePrice"], "createdAt"),
    sortOrder: sortOrderSchema,
  })
  .extend(paginationSchema().shape)
  .passthrough(); // storefront filters (color/size/fabric/priceMin/etc.) pass through unvalidated here — buildFilter() already allowlists/escapes/casts them (see services/productService.js)

// ====== Categories ======

export const createCategorySchema = z
  .object({
    name: requiredString({ min: 1, max: 150 }),
    nameBn: z.string().trim().max(150).optional().default(""),
    parent: z.union([z.null(), objectIdSchema]).optional(),
    image: z.union([z.literal(""), urlSchema]).optional().default(""),
    description: z.string().trim().max(2000).optional().default(""),
    descriptionBn: z.string().trim().max(2000).optional().default(""),
    sortOrder: z.number().int().min(0).max(100000).optional().default(0),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

export const updateCategorySchema = createCategorySchema
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" });

// ====== Attributes ======

const attributeOptionSchema = z
  .object({
    value: requiredString({ min: 1, max: 100 }),
    label: requiredString({ min: 1, max: 150 }),
    labelBn: z.string().trim().max(150).optional().default(""),
    swatchHex: z.string().trim().max(30).optional().default(""),
  })
  .strict();

const labelOverrideSchema = z
  .object({
    category: objectIdSchema,
    label: requiredString({ min: 1, max: 150 }),
    labelBn: z.string().trim().max(150).optional().default(""),
  })
  .strict();

export const createAttributeSchema = z
  .object({
    key: requiredString({ min: 1, max: 100 }),
    label: requiredString({ min: 1, max: 150 }),
    labelOverrides: z.array(labelOverrideSchema).max(50).optional().default([]),
    type: z.enum(["select", "swatch", "boolean", "text"]).optional().default("select"),
    options: z.array(attributeOptionSchema).max(200).optional().default([]),
    appliesToCategories: z.array(objectIdSchema).max(200).optional().default([]),
    derivedFromVariant: z.string().trim().max(50).optional(),
    filterable: z.boolean().optional(),
    required: z.boolean().optional().default(false),
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .strict();

export const updateAttributeSchema = createAttributeSchema
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" });

// ====== Products batch/compare/related query (path/query, not body) ======

const MAX_BATCH_IDS = 50;
const MAX_COMPARE_IDS = 50;
// ComparePage.jsx's own UI caps a real comparison at a handful of products,
// but there's no server-documented HARD minimum (a "compare" of one product
// is a degenerate-but-harmless case, not a security concern) — bounded on
// the top end only, matching the pre-existing getCompareProducts() cap
// this schema now enforces explicitly instead of silently.
function idListQueryField({ max }) {
  return z
    .string()
    .trim()
    .min(1, "at least one id is required")
    .max(2000)
    .transform((val, ctx) => {
      const parts = val
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "at least one id is required" });
        return z.NEVER;
      }
      if (parts.length > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `at most ${max} ids are allowed` });
        return z.NEVER;
      }
      for (let i = 0; i < parts.length; i++) {
        if (!/^[0-9a-fA-F]{24}$/.test(parts[i])) {
          // A safe, specific path (e.g. "ids.2") — never the malformed
          // value itself — per the documented safe-field-error contract.
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a valid id", path: [`ids.${i}`] });
          return z.NEVER;
        }
      }
      // Duplicates are not meaningful here (looking up the same product
      // twice), so they're de-duplicated rather than rejected — this
      // preserves the pre-existing behavior (both routes already
      // deduplicated via a Set) while still rejecting anything malformed
      // outright instead of silently dropping it.
      return [...new Set(parts)];
    });
}

export const productBatchQuerySchema = z.object({ ids: idListQueryField({ max: MAX_BATCH_IDS }) });
export const productCompareQuerySchema = z.object({ ids: idListQueryField({ max: MAX_COMPARE_IDS }) });

export const relatedQuerySchema = z.object({
  limit: boundedIntParam({ min: 1, max: 24, defaultValue: 8 }),
});

// GET /api/products (storefront + admin) query contract — Phase 5D.
//
// Phase 5C left this route with NO schema at all, reasoning that
// buildFilter()'s data-driven attribute-facet system (any query key not in
// a small structural set is treated as a filter keyed by a live
// AttributeDefinition.key) couldn't be expressed as a single static
// `.strict()` schema without breaking real, tested CSV multi-value
// behavior (`ageGroup=kids,girls` — tests/http/productFilters.integration
// .test.mjs). That reasoning about `.strict()` was correct, but the
// conclusion ("so validate nothing") wasn't: a HYBRID contract is what was
// missing, not the absence of one. This module owns the browser-safe,
// dependency-free half of that hybrid — fixed-field bounds and the
// low-level CSV/token safety rules — while services/productService.js's
// parseProductListQuery() owns the DB-aware half (checking a dynamic facet
// key against real AttributeDefinition records). Together they guarantee
// every query key either matches a known fixed field or a real, filterable
// attribute, and every value is validated before buildFilter() ever sees
// it — see that function's own contract comment for the full flow.

// Real, sortable/selectable fields — mirrors the sort options actually
// offered (views/ShopPage.jsx's SORTS, views/admin/ProductsPage.jsx's
// sortable DataTable columns: name, basePrice; admin's default sortBy is
// createdAt).
export const PRODUCT_SORT_FIELDS = ["createdAt", "basePrice", "rating", "isFeatured", "name"];

// Everything ProductCard.jsx/the admin table actually reads plus the
// histogram's own narrow `fields=basePrice,discountPrice` request
// (views/ShopPage.jsx) — a client-supplied `fields` projection may only
// select from this fixed, known-safe set, never an arbitrary schema path.
export const PRODUCT_SELECT_FIELDS = [
  "_id", "name", "nameBn", "slug", "description", "descriptionBn", "images", "basePrice",
  "discountPrice", "availability", "variants", "category", "brand", "attributes", "topCategory",
  "isActive", "isFeatured", "rating", "createdAt", "updatedAt", "measurements", "includedItems",
  "tags", "ageGroup", "__v",
];

export const MAX_PRODUCT_QUERY_LENGTH = 2000;
export const MAX_DYNAMIC_FACETS = 20;
export const MAX_FACET_KEY_LENGTH = 50;
export const MAX_FACET_VALUES = 20;
export const MAX_FACET_VALUE_LENGTH = 200;
export const MAX_PRICE_BOUND = 100_000_000;

// A real AttributeDefinition.key is plain letters+digits starting with a
// letter (see that model's own field comment: byte-for-byte match against
// Product.attributes[].key, never case-folded). This alone already
// excludes every Mongo-operator ("$..."), dotted-path, and
// underscore-prefixed ("__proto__") shape; DANGEROUS_FACET_KEYS below
// additionally excludes two all-letters words this regex would otherwise
// accept.
export const FACET_KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{0,49}$/;
export const DANGEROUS_FACET_KEYS = new Set(["constructor", "prototype"]);

const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

// Splits a comma-separated query value into trimmed, deduplicated,
// individually-bounded parts. Returns { values } on success or { error }
// otherwise (empty segment, too many values, a value too long, or a raw
// control character) — never throws, so callers can attach their own field
// path when converting to an HttpError.
export function splitBoundedCsv(raw, { maxValues = MAX_FACET_VALUES, maxValueLength = MAX_FACET_VALUE_LENGTH } = {}) {
  if (typeof raw !== "string" || raw.length === 0) return { error: "must not be empty" };
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.some((p) => p.length === 0)) return { error: "empty value is not allowed" };
  if (parts.length > maxValues) return { error: `at most ${maxValues} values are allowed` };
  if (parts.some((p) => p.length > maxValueLength)) return { error: "value is too long" };
  if (parts.some((p) => CONTROL_CHAR_RE.test(p))) return { error: "invalid character in value" };
  return { values: [...new Set(parts)] };
}

// "true"/"false" only — explicit boolean encoding, never JavaScript
// truthiness over an arbitrary string ("yes", "1", "on", ...).
export function isExplicitBooleanParam(raw) {
  return raw === "true" || raw === "false";
}

// Validates a sort/fields CSV param against an allowlist, each token
// optionally prefixed with "-" (descending sort / field exclusion — the
// same convention Mongoose's own `.sort()`/`.select()` string form uses).
export function validateAllowlistedTokenCsv(raw, allowedSet, { maxTokens = 10 } = {}) {
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length || parts.length > maxTokens) return { error: `must list 1-${maxTokens} fields` };
  for (const part of parts) {
    const bare = part.startsWith("-") ? part.slice(1) : part;
    if (!allowedSet.has(bare)) return { error: `"${bare}" is not a recognized field` };
  }
  return { values: parts };
}

// Validates one numeric price bound (a plain `basePrice=` value or one
// `basePrice[gte]`/[gt]/[lte]/[lt] operator value) — a finite,
// non-negative number within a sane real-world price ceiling, expressed
// with plain digits only (no leading sign, no exponent notation, no
// "Infinity"/"NaN" strings).
export function validateBoundedPriceValue(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return { error: "must be a number" };
  if (!/^\d+(\.\d+)?$/.test(raw.trim())) return { error: "must be a non-negative number" };
  const num = Number(raw.trim());
  if (!Number.isFinite(num) || num > MAX_PRICE_BOUND) return { error: `must be between 0 and ${MAX_PRICE_BOUND}` };
  return { value: num };
}
