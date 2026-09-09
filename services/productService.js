import mongoose from "mongoose";

import Product from "../models/productModel.js";
import Category from "../models/categoryModel.js";
import AttributeDefinition from "../models/attributeDefinitionModel.js";
// Not referenced directly — imported so mongoose.model("brands", ...) is
// registered before .populate("brand") runs (Mongoose needs the schema
// registered somewhere in the process, and nothing else in this route's
// module graph otherwise loads it).
import "../models/brandModel.js";
import { HttpError } from "../lib/http.js";
import { emitAdminEvent, emitBestEffort } from "../lib/events.js";
import { requireObjectIdFormat, isObjectIdFormat } from "../lib/validation.js";
import { isLeafCategory } from "./categoryService.js";
import { resolveAttributesForCategory } from "./attributeService.js";
import {
  PRODUCT_SORT_FIELDS,
  PRODUCT_SELECT_FIELDS,
  FACET_KEY_RE,
  DANGEROUS_FACET_KEYS,
  MAX_PRODUCT_QUERY_LENGTH,
  MAX_DYNAMIC_FACETS,
  MAX_FACET_KEY_LENGTH,
  MAX_FACET_VALUES,
  MAX_FACET_VALUE_LENGTH,
  splitBoundedCsv,
  isExplicitBooleanParam,
  validateAllowlistedTokenCsv,
  validateBoundedPriceValue,
  AGE_GROUP_VALUES_LIST,
} from "../schemas/catalogSchemas.js";

// Structural fields — a fixed, known set of flat schema paths (plus the
// storefront's category/style aliases below). Ported from
// controllers/productController.js's buildFilter, adapted for the new
// schema (gender/color/material/model dropped, topCategory/ageGroup added).
const ALLOWED_FILTER_FIELDS = new Set(["topCategory", "category", "brand", "ageGroup", "isFeatured", "isActive", "basePrice"]);

// Non-filter query keys — everything else that isn't one of these and isn't
// a structural field above is treated as an attribute-key facet filter
// (fabric=, coverageLevel=, occasion=, color=, size=, ...). This is what
// makes the filter system data-driven: adding a 10th AttributeDefinition
// needs no change here — any key matching a product's attributes[].key
// value just works.
const NON_FILTER_KEYS = new Set(["search", "featured", "discount", "new", "collection", "sort", "limit", "page", "fields"]);

// A real discount requires discountPrice > 0 AND discountPrice < basePrice
// — the exact invariant assertDiscountsValid() already enforces at write
// time (see below); this Mongo expression is the read-time/query-time
// mirror of that same rule, and of lib/utils.js's effectivePrice()/
// isRealDiscount() (the plain-JS version used by ProductCard.jsx and
// facet-count post-processing). Every price-aware query path — price
// range filtering, price sorting, collection=discount matching, and the
// discount facet count — builds on this ONE expression rather than each
// re-deriving a slightly different definition.
const EFFECTIVE_PRICE_EXPR = {
  $cond: [
    { $and: [{ $gt: ["$discountPrice", 0] }, { $lt: ["$discountPrice", "$basePrice"] }] },
    "$discountPrice",
    "$basePrice",
  ],
};
const REAL_DISCOUNT_MATCH = {
  $expr: { $and: [{ $ne: ["$discountPrice", null] }, { $gt: ["$discountPrice", 0] }, { $lt: ["$discountPrice", "$basePrice"] }] },
};

// Whitelisted ageGroup values — anything else in ?ageGroup= is dropped
// rather than passed through to Mongo (Section 6: "reject or safely ignore
// unsupported values"). "girls" was added without touching the meaning of
// the pre-existing "adult"/"kids" values (see productModel.js).
export const AGE_GROUP_VALUES = new Set(AGE_GROUP_VALUES_LIST);

// "New" has no admin-managed field — it's derived from real createdAt
// timestamps within one rolling window, defined here once so the cutoff is
// never a magic number scattered across the filter/facet/test code.
export const NEW_ARRIVAL_WINDOW_DAYS = 30;
export function getNewArrivalCutoff(now = Date.now()) {
  return new Date(now - NEW_ARRIVAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

// The storefront (non-admin reads) is scoped to these departments and their
// subcategories. Admin reads are never scoped (an admin manages the whole
// catalog, including any pre-existing product outside this scope). All 6
// launch departments are live; narrow this list again to soft-launch a
// subset.
export const STOREFRONT_DEPARTMENT_SLUGS = [
  "burqa",
  "hijab",
  "niqab",
  "abaya",
  "khimar",
  "modest-sets",
  "t-shirt",
  "shirts",
  "jeans",
  "cosmetics",
  "shoes",
  "sunglasses",
];

// Every product's `topCategory` is already denormalized to its department
// id (see productModel.js's pre-validate hook; resolveLeafCategory below
// guarantees a product can only ever be assigned a *subcategory*, never a
// bare department or division) — so these department ids alone are a
// complete, correct scope filter with no need to also resolve their child
// categories. Matched by slug alone (not `parent: null`) — Burqa/Hijab/
// Niqab/Abaya/Khimar/Modest-Sets/T-shirt now sit under a "Clothes" division
// (parent set), while Cosmetics/Shoes/Sunglasses stay root departments
// (parent: null) — both are equally valid "departments" here.
export async function getStorefrontDepartmentIds() {
  const departments = await Category.find({ slug: { $in: STOREFRONT_DEPARTMENT_SLUGS } })
    .select("_id")
    .lean();
  return departments.map((d) => d._id.toString());
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isTruthyParam = (v) => v === "true" || v === "1";

// scopeIds: null for admin (unscoped) or the storefront's allowed
// topCategory ids. When the query already names a topCategory/category,
// the requested value(s) are *intersected* with scopeIds rather than
// overwritten — so picking "Burqa" alone still narrows to Burqa instead of
// being widened back out to the full Burqa+Hijab scope. When the query
// names none, scopeIds becomes the filter outright.
export const buildFilter = (query, base = {}, scopeIds = null) => {
  const { search } = query;
  const filter = {};
  const attributeConditions = [];
  const collectionConditions = [];
  const priceExprConditions = [];

  if (search && String(search).trim().length >= 2) {
    const term = String(search).trim();
    if (term.length >= 3) {
      filter.$text = { $search: term };
    } else {
      filter.name = new RegExp(`^${escapeRegex(term)}`, "i");
    }
  }

  // Product Collection group: New / Featured / Discount. `collection=` is
  // the canonical, single-select param (the tab UI only ever emits this);
  // the three legacy booleans stay readable for old links, but never both
  // at once — parseProductListQuery() already rejects a request mixing
  // canonical and legacy shapes, so this function never has to arbitrate
  // between them. Multiple legacy booleans set together still OR (e.g.
  // Featured+Discount both checked returns products matching either).
  if (query.collection) {
    if (query.collection === "new") collectionConditions.push({ createdAt: { $gte: getNewArrivalCutoff() } });
    else if (query.collection === "featured") collectionConditions.push({ isFeatured: true });
    else if (query.collection === "discount") collectionConditions.push(REAL_DISCOUNT_MATCH);
  } else {
    if (isTruthyParam(query.featured)) collectionConditions.push({ isFeatured: true });
    if (isTruthyParam(query.discount)) collectionConditions.push(REAL_DISCOUNT_MATCH);
    if (isTruthyParam(query.new)) collectionConditions.push({ createdAt: { $gte: getNewArrivalCutoff() } });
  }
  if (collectionConditions.length === 1) {
    Object.assign(filter, collectionConditions[0]);
  } else if (collectionConditions.length > 1) {
    filter.$or = collectionConditions;
  }

  for (const [rawKey, val] of Object.entries(query)) {
    if (NON_FILTER_KEYS.has(rawKey)) continue;
    if (val === undefined || val === "") continue;

    // Storefront URL aliases: ?category= is the department (topCategory),
    // ?style= is the specific subcategory (category) — see Phase 3 plan §2.
    const key = rawKey === "category" ? "topCategory" : rawKey === "style" ? "category" : rawKey;

    if (key === "basePrice") {
      // Effective-price filtering: compares against discountPrice-if-real
      // ?? basePrice (EFFECTIVE_PRICE_EXPR), not a raw basePrice field
      // match — a discounted product correctly falls inside a price range
      // keyed to what a shopper actually pays, matching ProductCard.jsx's
      // own display and lib/utils.js's effectivePrice().
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        for (const [op, v] of Object.entries(val)) {
          if (!["gte", "gt", "lte", "lt"].includes(op) || v === "") continue;
          const num = Number(v);
          if (Number.isFinite(num)) priceExprConditions.push({ [`$${op}`]: [EFFECTIVE_PRICE_EXPR, num] });
        }
      } else {
        const nums = String(val)
          .split(",")
          .map((v) => Number(v.trim()))
          .filter(Number.isFinite);
        if (nums.length) priceExprConditions.push({ $in: [EFFECTIVE_PRICE_EXPR, nums] });
      }
      continue;
    }

    if (key === "availability") {
      if (val === "in_stock") filter.variants = { $elemMatch: { stock: { $gt: 0 } } };
      else if (val === "out_of_stock") filter.variants = { $not: { $elemMatch: { stock: { $gt: 0 } } } };
      continue;
    }

    if (key === "ratingGte") {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 1 && n <= 5) filter.rating = { $gte: n };
      continue;
    }

    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      if (!ALLOWED_FILTER_FIELDS.has(key)) continue;
      const converted = {};
      for (const [op, v] of Object.entries(val)) {
        if (["gte", "gt", "lte", "lt"].includes(op) && v !== "") {
          const num = Number(v);
          converted[`$${op}`] = Number.isFinite(num) ? num : v;
        }
      }
      if (Object.keys(converted).length) filter[key] = converted;
    } else if (ALLOWED_FILTER_FIELDS.has(key)) {
      // A comma-separated value (e.g. ?category=<burqaId>,<hijabId>) is an
      // OR across that field — same CSV-to-$in convention the attribute
      // facets below already use, just for the structural fields.
      const rawValues = String(val).split(",").map((v) => v.trim()).filter(Boolean);
      const values = key === "ageGroup" ? rawValues.filter((v) => AGE_GROUP_VALUES.has(v)) : rawValues;
      if (values.length) filter[key] = values.length > 1 ? { $in: values } : values[0];
    } else {
      // Attribute facet: comma-separated values are OR'd within the facet;
      // multiple different facets AND together. A single `attributes` key
      // can't hold two separate $elemMatch conditions (the second would
      // overwrite the first), so each facet gets its own $and entry.
      const values = String(val).split(",").map((v) => v.trim()).filter(Boolean);
      if (values.length) {
        attributeConditions.push({ attributes: { $elemMatch: { key: rawKey, values: { $in: values } } } });
      }
    }
  }

  if (attributeConditions.length) filter.$and = attributeConditions;
  if (priceExprConditions.length) {
    // Merge with (never overwrite) an existing filter.$expr — the single-
    // condition collection branch above can already have set filter.$expr
    // directly (REAL_DISCOUNT_MATCH, via Object.assign when it's the only
    // collection condition); both must survive together, AND'd.
    const priceExpr = priceExprConditions.length > 1 ? { $and: priceExprConditions } : priceExprConditions[0];
    filter.$expr = filter.$expr ? { $and: [filter.$expr, priceExpr] } : priceExpr;
  }

  // Burqa/Hijab storefront scope — an intersection/whitelist, not a blind
  // overwrite, so a specific in-scope selection still narrows correctly.
  // An out-of-scope or unrecognized topCategory collapses to "match
  // nothing" ($in: []) rather than silently widening back to full scope.
  if (scopeIds) {
    if (filter.topCategory) {
      const requested = filter.topCategory.$in ?? [filter.topCategory];
      const allowed = requested.filter((id) => scopeIds.includes(String(id)));
      filter.topCategory = { $in: allowed };
    } else {
      filter.topCategory = { $in: scopeIds };
    }
  }

  // Applied last so a query param can never override the caller's base scope
  // (e.g. a non-admin can't set ?isActive=false to see inactive products).
  Object.assign(filter, base);
  return filter;
};

// Mongoose auto-casts string ids to ObjectId for Model.find()/.countDocuments()
// (it walks the schema for those query builders) but NOT for Model.aggregate()
// — an aggregation pipeline goes to MongoDB largely as-is. Without this, a
// string-valued topCategory/category/brand in a $match stage would silently
// match nothing at all, since the stored field is actually BSON ObjectId.
const OBJECT_ID_FILTER_FIELDS = ["topCategory", "category", "brand"];

function castObjectIdFieldsForAggregate(filter) {
  const out = { ...filter };
  for (const key of OBJECT_ID_FILTER_FIELDS) {
    const val = out[key];
    if (val == null) continue;
    if (typeof val === "string") {
      if (mongoose.isValidObjectId(val)) out[key] = new mongoose.Types.ObjectId(val);
    } else if (Array.isArray(val.$in)) {
      out[key] = { $in: val.$in.filter((v) => mongoose.isValidObjectId(v)).map((v) => new mongoose.Types.ObjectId(v)) };
    }
  }
  return out;
}

// Real, database-computed counts for the Age Group and Product Collection
// filter options — never hardcoded/estimated. Each dimension is counted
// against the filter state with *that same dimension* excluded (standard
// faceted-search semantics), so e.g. the Kids count reflects "how many
// products would show if I picked Kids," not "how many match my current
// ageGroup selection already."
// Exported (only `listProducts` calls it in real request handling — export
// exists purely so tests can exercise the self-exclusion logic directly
// with an explicit scopeIds, independent of getStorefrontDepartmentIds()'s
// real department allowlist).
export async function buildFacetCounts(query, baseFilter, scopeIds) {
  const queryWithoutAgeGroup = { ...query };
  delete queryWithoutAgeGroup.ageGroup;
  const ageGroupFilter = castObjectIdFieldsForAggregate(buildFilter(queryWithoutAgeGroup, baseFilter, scopeIds));

  const queryWithoutCollection = { ...query };
  delete queryWithoutCollection.collection;
  delete queryWithoutCollection.new;
  delete queryWithoutCollection.featured;
  delete queryWithoutCollection.discount;
  const collectionFilter = castObjectIdFieldsForAggregate(buildFilter(queryWithoutCollection, baseFilter, scopeIds));

  const queryWithoutAvailability = { ...query };
  delete queryWithoutAvailability.availability;
  const availabilityFilter = castObjectIdFieldsForAggregate(buildFilter(queryWithoutAvailability, baseFilter, scopeIds));

  const queryWithoutRating = { ...query };
  delete queryWithoutRating.ratingGte;
  const ratingFilter = castObjectIdFieldsForAggregate(buildFilter(queryWithoutRating, baseFilter, scopeIds));

  const [ageGroupRows, collectionRows, availabilityRows, ratingRows] = await Promise.all([
    Product.aggregate([{ $match: ageGroupFilter }, { $group: { _id: "$ageGroup", count: { $sum: 1 } } }]),
    Product.aggregate([
      { $match: collectionFilter },
      {
        $facet: {
          new: [{ $match: { createdAt: { $gte: getNewArrivalCutoff() } } }, { $count: "count" }],
          featured: [{ $match: { isFeatured: true } }, { $count: "count" }],
          discount: [{ $match: REAL_DISCOUNT_MATCH }, { $count: "count" }],
        },
      },
    ]),
    Product.aggregate([
      { $match: availabilityFilter },
      {
        $facet: {
          in_stock: [{ $match: { variants: { $elemMatch: { stock: { $gt: 0 } } } } }, { $count: "count" }],
          out_of_stock: [{ $match: { variants: { $not: { $elemMatch: { stock: { $gt: 0 } } } } } }, { $count: "count" }],
        },
      },
    ]),
    Product.aggregate([
      { $match: ratingFilter },
      {
        $facet: {
          5: [{ $match: { rating: { $gte: 5 } } }, { $count: "count" }],
          4: [{ $match: { rating: { $gte: 4 } } }, { $count: "count" }],
          3: [{ $match: { rating: { $gte: 3 } } }, { $count: "count" }],
          2: [{ $match: { rating: { $gte: 2 } } }, { $count: "count" }],
          1: [{ $match: { rating: { $gte: 1 } } }, { $count: "count" }],
        },
      },
    ]),
  ]);

  const ageGroup = { adult: 0, kids: 0, girls: 0 };
  for (const row of ageGroupRows) {
    if (row._id in ageGroup) ageGroup[row._id] = row.count;
  }

  const rawCollection = collectionRows[0] || {};
  const collection = {
    new: rawCollection.new?.[0]?.count || 0,
    featured: rawCollection.featured?.[0]?.count || 0,
    discount: rawCollection.discount?.[0]?.count || 0,
  };

  const rawAvailability = availabilityRows[0] || {};
  const availability = {
    in_stock: rawAvailability.in_stock?.[0]?.count || 0,
    out_of_stock: rawAvailability.out_of_stock?.[0]?.count || 0,
  };

  const rawRating = ratingRows[0] || {};
  const ratingGte = {
    5: rawRating[5]?.[0]?.count || 0,
    4: rawRating[4]?.[0]?.count || 0,
    3: rawRating[3]?.[0]?.count || 0,
    2: rawRating[2]?.[0]?.count || 0,
    1: rawRating[1]?.[0]?.count || 0,
  };

  return { ageGroup, collection, availability, ratingGte };
}

// Pure pagination math, extracted so it can be unit tested without a DB.
// `total` is only known after the count query resolves, so callers compute
// `skip`/`limit` from a first pass (total unused then) and re-derive
// `pages` once the real total is in.
export function computePagination(query, total = 0) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Number(query.limit) || 12);
  const skip = (page - 1) * limit;
  const pages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, skip, pages };
}

// Phase 5D — the hybrid GET /api/products query contract. Runs BEFORE
// buildFilter()/listProducts() ever see the query: every fixed field is
// bounded/typed here, and every remaining key must name a real, filterable
// AttributeDefinition — buildFilter() itself is otherwise unchanged (it
// still does its own CSV-split/escape/cast work on whatever this function
// hands it), so a normalized, already-safe plain object is all this adds.
// Throws HttpError(400) on the first violation found; never silently
// drops an unrecognized key the way the pre-5D code implicitly did.
const PRODUCT_LIST_FIXED_KEYS = new Set([...ALLOWED_FILTER_FIELDS, "style", ...NON_FILTER_KEYS, "availability", "ratingGte"]);
const OBJECT_ID_CSV_FIELDS = ["category", "style", "brand", "topCategory"];
const EXPLICIT_BOOLEAN_FIELDS = ["isActive", "isFeatured", "featured", "discount", "new"];
const COLLECTION_VALUES = new Set(["new", "featured", "discount"]);
const AVAILABILITY_FILTER_VALUES = new Set(["in_stock", "out_of_stock"]);

function failQuery(message, path) {
  throw new HttpError(400, message, path ? [{ path, message }] : undefined);
}

function queryStringLength(query) {
  return Object.entries(query).reduce((sum, [key, val]) => {
    const valLen = typeof val === "string" ? val.length : JSON.stringify(val ?? "").length;
    return sum + key.length + valLen;
  }, 0);
}

export async function parseProductListQuery(query) {
  if (queryStringLength(query) > MAX_PRODUCT_QUERY_LENGTH) {
    failQuery("Query is too large");
  }

  const out = {};

  for (const rawKey of OBJECT_ID_CSV_FIELDS) {
    const val = query[rawKey];
    if (val === undefined || val === "") continue;
    if (typeof val !== "string") failQuery(`Invalid ${rawKey}`, rawKey);
    const { values, error } = splitBoundedCsv(val, { maxValues: 20, maxValueLength: 24 });
    if (error) failQuery(`Invalid ${rawKey}: ${error}`, rawKey);
    if (!values.every(isObjectIdFormat)) failQuery(`Invalid ${rawKey}`, rawKey);
    out[rawKey] = values.join(",");
  }

  if (query.ageGroup !== undefined && query.ageGroup !== "") {
    if (typeof query.ageGroup !== "string") failQuery("Invalid ageGroup", "ageGroup");
    const { values, error } = splitBoundedCsv(query.ageGroup, { maxValues: 10, maxValueLength: 20 });
    if (error) failQuery(`Invalid ageGroup: ${error}`, "ageGroup");
    // Unrecognized values are safely ignored, not rejected — preserves the
    // pre-existing, tested behavior: "an unrecognized ageGroup value is
    // safely ignored, not passed to Mongo"
    // (tests/http/productFilters.integration.test.mjs).
    const recognized = values.filter((v) => AGE_GROUP_VALUES.has(v));
    if (recognized.length) out.ageGroup = recognized.join(",");
  }

  for (const key of EXPLICIT_BOOLEAN_FIELDS) {
    const val = query[key];
    if (val === undefined || val === "") continue;
    if (typeof val !== "string" || !isExplicitBooleanParam(val)) {
      failQuery(`Invalid ${key}: must be "true" or "false"`, key);
    }
    out[key] = val;
  }

  // Canonical `collection=` and any legacy boolean (new/featured/discount)
  // must never both appear on one request — the new tab UI only ever
  // emits `collection=`; a request mixing both shapes is rejected outright
  // rather than buildFilter() having to silently arbitrate one over the
  // other.
  if (query.collection !== undefined && query.collection !== "") {
    if (typeof query.collection !== "string" || !COLLECTION_VALUES.has(query.collection)) {
      failQuery("Invalid collection", "collection");
    }
    const hasLegacy = ["new", "featured", "discount"].some((k) => out[k] !== undefined);
    if (hasLegacy) {
      failQuery("collection cannot be combined with legacy new/featured/discount params", "collection");
    }
    out.collection = query.collection;
  }

  if (query.availability !== undefined && query.availability !== "") {
    if (typeof query.availability !== "string" || !AVAILABILITY_FILTER_VALUES.has(query.availability)) {
      failQuery("Invalid availability", "availability");
    }
    out.availability = query.availability;
  }

  if (query.ratingGte !== undefined && query.ratingGte !== "") {
    if (typeof query.ratingGte !== "string" || !/^[1-5]$/.test(query.ratingGte)) {
      failQuery("Invalid ratingGte", "ratingGte");
    }
    out.ratingGte = query.ratingGte;
  }

  if (query.search !== undefined && query.search !== "") {
    if (typeof query.search !== "string") failQuery("Invalid search", "search");
    // Deliberately NOT splitBoundedCsv here — a search term legitimately
    // contains commas (e.g. "abaya, black"); only length and control
    // characters are bounded, matching buildFilter()'s own >=2-char
    // threshold before it becomes a $text/regex query.
    const search = query.search.trim();
    if (search.length > 200) failQuery("search is too long", "search");
    if (/[\x00-\x1f\x7f]/.test(search)) failQuery("Invalid search", "search");
    if (search.length) out.search = search;
  }

  if (query.sort !== undefined && query.sort !== "") {
    if (typeof query.sort !== "string") failQuery("Invalid sort", "sort");
    const { values, error } = validateAllowlistedTokenCsv(query.sort, new Set(PRODUCT_SORT_FIELDS), { maxTokens: 5 });
    if (error) failQuery(`Invalid sort: ${error}`, "sort");
    out.sort = values.join(",");
  }

  if (query.fields !== undefined && query.fields !== "") {
    if (typeof query.fields !== "string") failQuery("Invalid fields", "fields");
    const { values, error } = validateAllowlistedTokenCsv(query.fields, new Set(PRODUCT_SELECT_FIELDS), { maxTokens: 20 });
    if (error) failQuery(`Invalid fields: ${error}`, "fields");
    out.fields = values.join(",");
  }

  // page/limit deliberately keep the pre-existing, tested LENIENT contract
  // — a malformed value falls back to computePagination()'s own default
  // rather than rejecting outright ("malformed pagination params don't
  // crash the request", same file). This is an intentional, evidence-based
  // divergence from the strict boundedIntParam() contract other list
  // routes use (schemas/commonSchemas.js) — computePagination()'s
  // `Math.max(1, Number(query.page) || 1)` already makes any non-numeric
  // value safe by construction (never reaches Mongo as anything but a
  // clamped integer), so only the shape (plain scalar string, never an
  // object/array smuggled via bracket notation) is checked here.
  for (const key of ["page", "limit"]) {
    if (query[key] !== undefined && typeof query[key] !== "string") failQuery(`Invalid ${key}`, key);
    if (query[key] !== undefined) out[key] = query[key];
  }

  if (query.basePrice !== undefined && query.basePrice !== "") {
    const val = query.basePrice;
    if (typeof val === "string") {
      const { values, error } = splitBoundedCsv(val, { maxValues: 10, maxValueLength: 20 });
      if (error) failQuery(`Invalid basePrice: ${error}`, "basePrice");
      const nums = values.map((v) => {
        const { value, error: numErr } = validateBoundedPriceValue(v);
        if (numErr) failQuery(`Invalid basePrice: ${numErr}`, "basePrice");
        return value;
      });
      out.basePrice = nums.join(",");
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      const allowedOps = new Set(["gte", "gt", "lte", "lt"]);
      const converted = {};
      for (const [op, v] of Object.entries(val)) {
        if (!allowedOps.has(op)) failQuery(`Invalid basePrice operator: ${op}`, `basePrice.${op}`);
        if (v === "") continue;
        const { value, error } = validateBoundedPriceValue(v);
        if (error) failQuery(`Invalid basePrice[${op}]: ${error}`, `basePrice.${op}`);
        converted[op] = value;
      }
      const min = converted.gte ?? converted.gt;
      const max = converted.lte ?? converted.lt;
      if (min !== undefined && max !== undefined && min > max) {
        failQuery("basePrice minimum must not exceed maximum", "basePrice");
      }
      if (Object.keys(converted).length) out.basePrice = converted;
    } else {
      failQuery("Invalid basePrice", "basePrice");
    }
  }

  // ---- Dynamic attribute facets: every remaining key must name a real,
  // filterable AttributeDefinition. ----
  const dynamicKeys = Object.keys(query).filter((k) => !PRODUCT_LIST_FIXED_KEYS.has(k));
  if (dynamicKeys.length > MAX_DYNAMIC_FACETS) {
    failQuery(`At most ${MAX_DYNAMIC_FACETS} filter facets are allowed`);
  }
  for (const key of dynamicKeys) {
    if (key.length > MAX_FACET_KEY_LENGTH || DANGEROUS_FACET_KEYS.has(key) || !FACET_KEY_RE.test(key)) {
      failQuery("Unrecognized filter key");
    }
  }

  if (dynamicKeys.length) {
    const defs = await AttributeDefinition.find({ key: { $in: dynamicKeys } }).lean();
    const defsByKey = new Map(defs.map((d) => [d.key, d]));

    for (const key of dynamicKeys) {
      const def = defsByKey.get(key);
      if (!def || def.filterable === false) {
        failQuery(`Unrecognized filter: ${key}`, key);
      }
      const val = query[key];
      if (typeof val !== "string") failQuery(`Invalid ${key}`, key);
      const { values, error } = splitBoundedCsv(val, { maxValues: MAX_FACET_VALUES, maxValueLength: MAX_FACET_VALUE_LENGTH });
      if (error) failQuery(`Invalid ${key}: ${error}`, key);

      if (def.type === "text") {
        out[key] = values.join(",");
      } else {
        // select / swatch / boolean all validate against the definition's
        // real, admin-configured option values — "boolean" renders as a
        // multi-select checkbox group over def.options in the admin
        // product form (views/admin/ProductsPage.jsx's AttributeField),
        // not a literal true/false, so it shares the same options-based
        // validation as select/swatch.
        const allowed = new Set((def.options || []).map((o) => o.value));
        if (!values.every((v) => allowed.has(v))) {
          failQuery(`Invalid value for ${key}`, key);
        }
        out[key] = values.join(",");
      }
    }
  }

  return out;
}

// If `categoryId` is a division (Clothes) whose children are themselves
// departments (Burqa, with further leaf children of its own) rather than
// leaves, no product's `topCategory` is ever the division's own id — it
// expands to the division's direct children (the real departments)
// instead. A root department (Cosmetics, whose children — Lipstick,
// Foundation — are leaves) or an already-department id (Burqa) is
// returned unchanged, matching today's single-id behavior exactly.
// One aggregation round trip instead of two sequential queries (a plain
// find() for children plus a separate exists() for grandchildren) — same
// result, half the latency on every single product-list request that
// names a category, which matters since this runs unconditionally in
// listProducts()'s pipeline below.
async function expandCategoryScope(categoryId) {
  const [result] = await Category.aggregate([
    { $match: { parent: new mongoose.Types.ObjectId(categoryId) } },
    { $lookup: { from: Category.collection.name, localField: "_id", foreignField: "parent", as: "grandchildren" } },
    {
      $group: {
        _id: null,
        ids: { $push: "$_id" },
        isDivision: { $max: { $gt: [{ $size: "$grandchildren" }, 0] } },
      },
    },
  ]);
  if (!result) return [categoryId];
  return result.isDivision ? result.ids.map((id) => id.toString()) : [categoryId];
}

// Explicit pipeline step (parse -> resolve category context/definitions ->
// validate contextual attributes -> build filter), separate from and
// running BEFORE buildFilter — buildFilter itself stays a plain
// synchronous function with no hidden async work inside it. Only
// meaningful when exactly one real department is unambiguously selected
// (`deptId`): browsing "All," or a division-expanded multi-department
// scope, can't be narrowed this way without guessing which department's
// attributes should apply, so nothing is stripped in either of those
// cases — parseProductListQuery's existing "is this a real, filterable
// AttributeDefinition at all" check still applies regardless. When a
// single department IS selected, any dynamic-looking key that isn't in
// that department's real AttributeDefinition set (e.g. a stale `fabric=`
// left over from browsing Clothes, now viewing Cosmetics) is dropped here
// — defensively, never a 400, and never left in to silently zero out the
// result set the way an unscoped $elemMatch on a nonexistent key would.
async function stripInapplicableAttributeFilters(query, deptId) {
  if (!deptId) return query;
  // Nothing outside the fixed/style keys is present at all — there is no
  // dynamic attribute facet that could possibly be inapplicable, so skip
  // the resolveAttributesForCategory() round trip entirely. This is the
  // overwhelmingly common case (browsing a department with no attribute
  // filter applied yet), and avoiding the extra DB call here keeps
  // listProducts() from doing needless work on every single request.
  const candidateKeys = Object.keys(query).filter((k) => !PRODUCT_LIST_FIXED_KEYS.has(k) && k !== "style");
  if (candidateKeys.length === 0) return query;
  const defs = await resolveAttributesForCategory(deptId);
  const applicableKeys = new Set(defs.map((d) => d.key));
  const out = { ...query };
  for (const key of candidateKeys) {
    if (!applicableKeys.has(key)) delete out[key];
  }
  return out;
}

// `?category=` (aliased to `topCategory` inside buildFilter) is the one
// query param that can name either a department or a division — every
// other structural/facet field already means exactly what it says.
// Expands it here, once, before buildFilter/buildFacetCounts ever see the
// query, reusing buildFilter's existing CSV-to-$in handling rather than
// needing a signature change there.
async function expandCategoryQueryParam(query) {
  const raw = query?.category;
  if (!raw || typeof raw !== "string") return query;
  const ids = raw.split(",").map((v) => v.trim()).filter(Boolean);
  if (ids.length !== 1 || !isObjectIdFormat(ids[0])) return query;
  const expanded = await expandCategoryScope(ids[0]);
  return expanded.length > 1 ? { ...query, category: expanded.join(",") } : query;
}

// The single unambiguous department id `?category=` currently names, or
// null if it names none (browsing "All") or several (a division was
// expanded to multiple real departments) — used only to decide whether
// stripInapplicableAttributeFilters() has enough context to act.
function resolveSingleDepartmentId(query) {
  const raw = query?.category;
  if (!raw || typeof raw !== "string") return null;
  const ids = raw.split(",").map((v) => v.trim()).filter(Boolean);
  return ids.length === 1 && isObjectIdFormat(ids[0]) ? ids[0] : null;
}

export async function listProducts(query, { isAdmin = false } = {}) {
  query = await expandCategoryQueryParam(query);
  query = await stripInapplicableAttributeFilters(query, resolveSingleDepartmentId(query));
  const baseFilter = isAdmin ? {} : { isActive: true };
  const scopeIds = isAdmin ? null : await getStorefrontDepartmentIds();
  const filter = buildFilter(query, baseFilter, scopeIds);
  const { page, limit, skip } = computePagination(query);

  const sortStr = typeof query.sort === "string" ? query.sort.split(",").join(" ") : "-createdAt";
  const fieldsStr = typeof query.fields === "string" ? query.fields.split(",").join(" ") : "-__v";

  // Admin's product table has no use for storefront facet counts — skip the
  // extra aggregate queries on every admin list/search/paginate request.
  const [products, total, facets] = await Promise.all([
    Product.find(filter)
      .sort(sortStr)
      .select(fieldsStr)
      .skip(skip)
      .limit(limit)
      .populate("brand", "name slug")
      .populate("category", "name slug")
      .lean(),
    Product.countDocuments(filter),
    isAdmin ? null : buildFacetCounts(query, baseFilter, scopeIds),
  ]);

  return {
    page,
    limit,
    total,
    pages: computePagination(query, total).pages,
    count: products.length,
    products,
    facets,
  };
}

// Everything ProductCard.jsx actually reads (see its prop usage) — used
// wherever we return a *list* of products for a card grid/rail, so those
// queries never pull full documents (careInstructions text, timestamps,
// admin-only bookkeeping) just to render a thumbnail and a price.
const CARD_FIELDS =
  "name nameBn slug images basePrice discountPrice availability variants category brand attributes topCategory isActive isFeatured rating createdAt";

export async function getProductByIdOrSlug(idOrSlug) {
  const isId = mongoose.isValidObjectId(idOrSlug);
  const product = await Product.findOne(isId ? { _id: idOrSlug } : { slug: idOrSlug })
    .populate("brand", "name slug")
    .populate("category", "name slug");
  if (!product) throw new HttpError(404, "Product not found");
  return product;
}

// Powers /compare — was previously silently unreachable: nothing under
// app/api/products/ handled "/compare" as anything other than the dynamic
// [idOrSlug] route, which tried to look up a product literally named
// "compare" and 404'd every time. ids arrives as a comma-separated string
// (see store/productApi.js's getCompareProducts).
export async function getCompareProducts(ids) {
  const list = (Array.isArray(ids) ? ids : String(ids || "").split(","))
    .map((s) => s.trim())
    .filter((id) => mongoose.isValidObjectId(id));
  if (!list.length) return [];

  return Product.find({ _id: { $in: list } })
    .populate("brand", "name slug")
    .populate("category", "name slug")
    .lean();
}

export async function listFeatured(limit = 8) {
  const scopeIds = await getStorefrontDepartmentIds();
  return Product.find({ isFeatured: true, isActive: true, topCategory: { $in: scopeIds } })
    .sort("-rating")
    .limit(limit)
    .populate("brand", "name slug")
    .populate("category", "name slug")
    .lean();
}

// Sneaker-era "distinct model names scoped by brand" replaced with its
// modest-fashion equivalent: product groupings by category. With no
// `category` param, groups at the top level (one count per division/root
// department, e.g. Clothes/Cosmetics/Shoes/Sunglasses); with one, groups by
// that category's direct children — which, since Clothes introduced a real
// 3rd level, can themselves be either departments (Burqa under Clothes,
// still with further leaf children of their own) or genuine leaves/styles
// (Lipstick under Cosmetics). Only categories/departments with at least
// one active product are included.
export async function listGroupings(categoryId) {
  if (categoryId) requireObjectIdFormat(categoryId, "category");
  const parentFilter = categoryId ? { parent: categoryId } : { parent: null };
  const categories = await Category.find(parentFilter).sort("sortOrder name").lean();

  const groupings = await Promise.all(
    categories.map(async (c) => {
      if (!categoryId) {
        // Top level: c is a division (Clothes) or a root department
        // (Cosmetics/Shoes/Sunglasses). A real product's topCategory is at
        // most one hop below c either way — c's own id (a root department
        // like Cosmetics) or one of c's direct children (a division's
        // departments, like Burqa under Clothes) — so counting across c
        // plus its direct children covers both shapes in one query.
        const scopeIds = [c._id, ...(await Category.find({ parent: c._id }).distinct("_id"))];
        const count = await Product.countDocuments({ isActive: true, topCategory: { $in: scopeIds } });
        return { _id: c._id, name: c.name, nameBn: c.nameBn, slug: c.slug, count, isLeaf: false };
      }
      // Drilling into a specific category: c is either a real leaf/style
      // (matched via `category`, e.g. Cosmetics' Lipstick or a clothing
      // style) or itself a department with further leaf children of its
      // own (matched via `topCategory`, e.g. Clothes' child Burqa) — no
      // product's `category` field is ever a department, so the two must
      // be told apart per-child rather than assumed from `categoryId` alone.
      const isLeaf = await isLeafCategory(c._id);
      const count = await Product.countDocuments({
        isActive: true,
        [isLeaf ? "category" : "topCategory"]: c._id,
      });
      return { _id: c._id, name: c.name, nameBn: c.nameBn, slug: c.slug, count, isLeaf };
    }),
  );

  return groupings.filter((g) => g.count > 0);
}

// Related = same leaf category ranks above same-department-only, and within
// each tier, products sharing more attribute values (fabric, color, etc.)
// with the current product rank higher.
// Ranks real same-department candidates by category/attribute overlap
// (see scoreOf), then — since the current catalog is small enough that a
// given department can easily have zero other active products — fills any
// remaining slots with real active products ranked by the schema's actual
// signals (isFeatured, rating, recency). Nothing here is invented: every
// field scored or sorted on already exists on Product and is populated by
// real seed/admin data, and a product never appears with a fabricated label
// (ProductCard has no "Best Seller" badge to begin with).
export async function listRelated(idOrSlug, limit = 8) {
  const current = await getProductByIdOrSlug(idOrSlug);
  const clampedLimit = Math.min(24, Math.max(1, Number(limit) || 8));

  const sameDept = await Product.find({
    _id: { $ne: current._id },
    topCategory: current.topCategory,
    isActive: true,
  })
    .select(CARD_FIELDS)
    .populate("brand", "name slug")
    .populate("category", "name slug")
    .lean();

  const currentCategoryId = String(current.category?._id || current.category);
  const currentAttrs = new Map((current.attributes || []).map((a) => [a.key, new Set(a.values)]));
  const isInStock = (p) => (p.variants || []).some((v) => (v.stock ?? 0) > 0);

  const scoreOf = (p) => {
    const sameCategory = String(p.category?._id || p.category) === currentCategoryId ? 1000 : 0;
    const attrOverlap = (p.attributes || []).reduce((sum, a) => {
      const shared = a.values.filter((v) => currentAttrs.get(a.key)?.has(v)).length;
      return sum + shared;
    }, 0);
    // A small, real tiebreaker — prefer purchasable products — not a
    // fabricated popularity signal.
    const inStockBonus = isInStock(p) ? 2 : 0;
    return sameCategory + attrOverlap + inStockBonus;
  };

  let ranked = sameDept
    .map((product) => ({ product, score: scoreOf(product) }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.product);

  // Fallback fill: real active products the catalog actually has, ranked by
  // real signals (featured flag, rating, recency) — only reached when the
  // same-department pool alone can't fill the rail.
  if (ranked.length < clampedLimit) {
    const excludeIds = [current._id, ...ranked.map((p) => p._id)];
    const fillers = await Product.find({ _id: { $nin: excludeIds }, isActive: true })
      .select(CARD_FIELDS)
      .populate("brand", "name slug")
      .populate("category", "name slug")
      .sort({ isFeatured: -1, rating: -1, createdAt: -1 })
      .limit(clampedLimit - ranked.length)
      .lean();
    ranked = [...ranked, ...fillers];
  }

  return ranked.slice(0, clampedLimit);
}

// Recently Viewed's server side: given a list of ids read back from the
// visitor's own localStorage, resolve them against real, current MongoDB
// data in one query — never trust the stored snapshot for price/stock/name,
// only for "which products and in what order." Silently drops anything
// invalid, deleted, or deactivated since it was viewed; the caller
// re-applies the visitor's stored order afterward (a $in query does not
// preserve input order).
export async function getProductsByIds(ids) {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => mongoose.isValidObjectId(id)))].slice(
    0,
    12,
  );
  if (!clean.length) return [];

  return Product.find({ _id: { $in: clean }, isActive: true })
    .select(CARD_FIELDS)
    .populate("brand", "name slug")
    .populate("category", "name slug")
    .lean();
}

const WRITABLE_FIELDS = [
  "name",
  "nameBn",
  "description",
  "descriptionBn",
  "category",
  "brand",
  "ageGroup",
  "basePrice",
  "discountPrice",
  "images",
  "variants",
  "attributes",
  "measurements",
  "includedItems",
  "availability",
  "tags",
  "isFeatured",
  "isActive",
];

const pickWritable = (body) => {
  const out = {};
  for (const key of WRITABLE_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

// Resolves the leaf category and validates it's actually a leaf (a
// department, or a division like Clothes, can't be assigned directly to a
// product) — also returns the department id for the required-attribute
// check below. "Leaf" means "has no children of its own" — NOT "has a
// parent", since a department (e.g. Burqa) now has a parent (Clothes) too
// but still isn't a valid product category.
async function resolveLeafCategory(categoryId) {
  if (!isObjectIdFormat(categoryId)) throw new HttpError(400, "Invalid category id");
  const category = await Category.findById(categoryId).lean();
  if (!category) throw new HttpError(400, "Category not found");
  if (!(await isLeafCategory(category._id))) {
    throw new HttpError(400, `"${category.name}" is a department, not a style — assign a subcategory instead`);
  }
  return category;
}

async function assertSkusUnique(variants, excludeProductId) {
  const skus = (variants || []).map((v) => v.sku).filter(Boolean);
  if (!skus.length) return;
  const dupeQuery = { "variants.sku": { $in: skus } };
  if (excludeProductId) dupeQuery._id = { $ne: excludeProductId };
  const clash = await Product.findOne(dupeQuery).select("variants.sku").lean();
  if (clash) {
    const taken = clash.variants.map((v) => v.sku).find((sku) => skus.includes(sku));
    throw new HttpError(400, `SKU "${taken}" is already used by another product`);
  }
}

function assertDiscountsValid(data) {
  if (data.discountPrice != null && data.basePrice != null && data.discountPrice >= data.basePrice) {
    throw new HttpError(400, "discountPrice must be less than basePrice");
  }
  for (const v of data.variants || []) {
    const effectivePrice = v.price ?? data.basePrice;
    if (v.discountPrice != null && effectivePrice != null && v.discountPrice >= effectivePrice) {
      throw new HttpError(400, `Variant "${v.variantName}": discountPrice must be less than its price`);
    }
  }
}

async function assertRequiredAttributes(data, topCategoryId) {
  const required = await AttributeDefinition.find({
    required: true,
    $or: [{ appliesToCategories: { $size: 0 } }, { appliesToCategories: topCategoryId }],
  }).lean();
  if (!required.length) return;

  const provided = new Map((data.attributes || []).map((a) => [a.key, a.values]));
  for (const def of required) {
    const values = provided.get(def.key);
    if (!values || !values.length) {
      throw new HttpError(400, `"${def.label}" is required for this category`);
    }
  }
}

export async function createProduct(body) {
  const data = pickWritable(body);
  if (!data.category) throw new HttpError(400, "Category is required");
  if (!data.variants?.length) throw new HttpError(400, "At least one variant is required");

  const category = await resolveLeafCategory(data.category);
  await assertSkusUnique(data.variants);
  assertDiscountsValid(data);
  await assertRequiredAttributes(data, category.parent);

  const product = new Product(data);
  await product.save();
  // Non-transactional (a plain single-document save) — awaited so a
  // failure is observed/logged before returning, but never fails the
  // already-succeeded product creation itself. See lib/events.js's
  // emitBestEffort() for the documented policy.
  await emitBestEffort(emitAdminEvent({ type: "PRODUCT_CREATED", productId: product._id.toString(), name: product.name }));
  return product;
}

export async function updateProduct(id, body) {
  requireObjectIdFormat(id, "id");
  const product = await Product.findById(id);
  if (!product) throw new HttpError(404, "Product not found");

  const data = pickWritable(body);
  // `product` is a hydrated Mongoose document (not `.lean()`), so its
  // `category` field is a real ObjectId instance, not a string — falling
  // back to it directly used to fail resolveLeafCategory's
  // isObjectIdFormat() check (which requires typeof === "string"), making
  // any partial update that omitted `category` wrongly 400 with "Invalid
  // category id". Stringify the fallback so an omitted `category` behaves
  // like the existing value, while an explicitly-supplied `data.category`
  // is still validated exactly as before.
  const categoryId = data.category ?? String(product.category);
  const category = await resolveLeafCategory(categoryId);

  const variants = data.variants ?? product.variants;
  await assertSkusUnique(variants, product._id);
  assertDiscountsValid({ ...product.toObject(), ...data, variants });
  await assertRequiredAttributes({ ...product.toObject(), ...data }, category.parent);

  Object.assign(product, data);
  await product.save();
  await emitBestEffort(emitAdminEvent({ type: "PRODUCT_UPDATED", productId: product._id.toString(), name: product.name }));
  return product;
}

export async function deleteProduct(id) {
  requireObjectIdFormat(id, "id");
  const product = await Product.findById(id);
  if (!product) throw new HttpError(404, "Product not found");
  product.isActive = false;
  await product.save();
}
