import Product from "../models/productModel.js";
import Category from "../models/categoryModel.js";
import AttributeDefinition from "../models/attributeDefinitionModel.js";
import Brand from "../models/brandModel.js";
import { HttpError } from "../lib/http.js";
import { isDuplicateKeyError } from "../lib/idempotency.js";
import { pruneFramingList as pruneFramingListToUrls } from "../lib/imageFraming.js";
import { emitAdminEvent, emitBestEffort } from "../lib/events.js";
import { requireObjectIdFormat, isObjectIdFormat } from "../lib/validation.js";
import { FASHION_DEPARTMENT_SLUGS, STOREFRONT_DEPARTMENT_SLUGS } from "../lib/storefrontDepartments.js";
import { isLeafCategory } from "./categoryService.js";
import {
  getStorefrontDepartmentIds,
  resetStorefrontScopeCache,
  computeVisibleCategoryIds,
  resolveStorefrontVisibleCategoryIds,
} from "./storefrontScopeService.js";
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

void PRODUCT_SELECT_FIELDS; // `fields=` is now accepted/validated but not applied to the SQL SELECT (see buildFilter's own comment) — every column is always returned, same choice models/userModel.js makes.

// Structural fields — a fixed, known set of flat columns (plus the
// storefront's category/style aliases below).
const ALLOWED_FILTER_FIELDS = new Set(["topCategory", "category", "brand", "ageGroup", "isFeatured", "isActive", "basePrice"]);
const STRUCTURAL_COLUMN = {
  topCategory: "top_category_id",
  category: "category_id",
  brand: "brand_id",
  ageGroup: "age_group",
  isFeatured: "is_featured",
  isActive: "is_active",
};

// Non-filter query keys — everything else that isn't one of these and isn't
// a structural field above is treated as an attribute-key facet filter
// (fabric=, coverageLevel=, occasion=, color=, size=, ...). This is what
// makes the filter system data-driven: adding a new AttributeDefinition
// needs no change here — any key matching a product's attributes[].key
// value just works.
const NON_FILTER_KEYS = new Set(["search", "featured", "discount", "new", "collection", "sort", "limit", "page", "fields", "priceMin", "priceMax"]);

// A real discount requires discount_price > 0 AND discount_price < base_price
// — mirrors lib/utils.js's effectivePrice()/isRealDiscount() (the plain-JS
// version ProductCard.jsx uses). Every price-aware query path — price range
// filtering, the discount collection, and the discount facet count — builds
// on this ONE SQL fragment rather than each re-deriving a slightly
// different definition.
const EFFECTIVE_PRICE_SQL = "(CASE WHEN discount_price IS NOT NULL AND discount_price > 0 AND discount_price < base_price THEN discount_price ELSE base_price END)";
const REAL_DISCOUNT_SQL = "(discount_price IS NOT NULL AND discount_price > 0 AND discount_price < base_price)";

export const AGE_GROUP_VALUES = new Set(AGE_GROUP_VALUES_LIST);

export const NEW_ARRIVAL_WINDOW_DAYS = 30;
export function getNewArrivalCutoff(now = Date.now()) {
  return new Date(now - NEW_ARRIVAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export { FASHION_DEPARTMENT_SLUGS, STOREFRONT_DEPARTMENT_SLUGS };

// Every product's `topCategory` is denormalized to its category's IMMEDIATE
// parent (models/productModel.js's resolveDerivedFields — deliberately one
// level, not a walk-to-root). See the original Mongoose version of this
// file (git history) for the full department/division reasoning — unchanged
// here, only the query engine underneath it.
//
// `slugs` -> those categories plus EVERY descendant (division -> department
// -> style), however deep the tree goes.
export async function resolveScopeIdsForSlugs(slugs) {
  const departments = await Category.findAll();
  const childrenOf = new Map();
  for (const c of departments) {
    if (!c.parent) continue;
    const list = childrenOf.get(c.parent) || [];
    list.push(c._id);
    childrenOf.set(c.parent, list);
  }
  const ids = new Set();
  const queue = departments.filter((d) => slugs.includes(d.slug)).map((d) => d._id);
  while (queue.length) {
    const id = queue.shift();
    if (ids.has(id)) continue;
    ids.add(id);
    queue.push(...(childrenOf.get(id) || []));
  }
  return [...ids];
}

// Storefront visibility (data-driven, see services/storefrontScopeService.js).
export { getStorefrontDepartmentIds, resetStorefrontScopeCache, computeVisibleCategoryIds, resolveStorefrontVisibleCategoryIds };

const isTruthyParam = (v) => v === "true" || v === "1";

// scopeIds: null for admin (unscoped) or the storefront's allowed
// topCategory ids. When the query already names a topCategory/category,
// the requested value(s) are *intersected* with scopeIds rather than
// overwritten. When the query names none, scopeIds becomes the filter
// outright. Returns a raw SQL WHERE fragment + its params — the SQL analog
// of the old Mongo filter-object builder.
export const buildFilter = (query, base = {}, scopeIds = null) => {
  const { search } = query;
  const clauses = [];
  const params = [];
  const attributeClauses = [];
  const collectionClauses = [];
  let topCategoryHandled = false;

  if (search && String(search).trim().length >= 2) {
    const term = String(search).trim();
    if (term.length >= 3) {
      clauses.push("MATCH(name, description, tags_text) AGAINST(? IN NATURAL LANGUAGE MODE)");
      params.push(term);
    } else {
      clauses.push("name LIKE ?");
      params.push(`${term}%`);
    }
  }

  // Product Collection group: New / Featured / Discount. `collection=` is
  // the canonical, single-select param; the three legacy booleans stay
  // readable for old links, but never both at once (parseProductListQuery
  // already rejects mixing them). Multiple legacy booleans OR together.
  if (query.collection) {
    if (query.collection === "new") {
      collectionClauses.push({ sql: "created_at >= ?", params: [getNewArrivalCutoff()] });
    } else if (query.collection === "featured") {
      collectionClauses.push({ sql: "is_featured = 1", params: [] });
    } else if (query.collection === "discount") {
      collectionClauses.push({ sql: REAL_DISCOUNT_SQL, params: [] });
    }
  } else {
    if (isTruthyParam(query.featured)) collectionClauses.push({ sql: "is_featured = 1", params: [] });
    if (isTruthyParam(query.discount)) collectionClauses.push({ sql: REAL_DISCOUNT_SQL, params: [] });
    if (isTruthyParam(query.new)) collectionClauses.push({ sql: "created_at >= ?", params: [getNewArrivalCutoff()] });
  }
  if (collectionClauses.length === 1) {
    clauses.push(collectionClauses[0].sql);
    params.push(...collectionClauses[0].params);
  } else if (collectionClauses.length > 1) {
    clauses.push(`(${collectionClauses.map((c) => c.sql).join(" OR ")})`);
    for (const c of collectionClauses) params.push(...c.params);
  }

  for (const [rawKey, val] of Object.entries(query)) {
    if (NON_FILTER_KEYS.has(rawKey)) continue;
    if (val === undefined || val === "") continue;

    // Storefront URL aliases: ?category= is the department (topCategory),
    // ?style= is the specific subcategory (category).
    const key = rawKey === "category" ? "topCategory" : rawKey === "style" ? "category" : rawKey;

    if (key === "basePrice") {
      // Effective-price filtering: compares against discount_price-if-real
      // ?? base_price, not a raw base_price column match.
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        for (const [op, v] of Object.entries(val)) {
          if (!["gte", "gt", "lte", "lt"].includes(op) || v === "") continue;
          const num = Number(v);
          if (Number.isFinite(num)) {
            clauses.push(`${EFFECTIVE_PRICE_SQL} ${{ gte: ">=", gt: ">", lte: "<=", lt: "<" }[op]} ?`);
            params.push(num);
          }
        }
      } else {
        const nums = String(val).split(",").map((v) => Number(v.trim())).filter(Number.isFinite);
        if (nums.length) {
          clauses.push(`${EFFECTIVE_PRICE_SQL} IN (${nums.map(() => "?").join(",")})`);
          params.push(...nums);
        }
      }
      continue;
    }

    if (key === "availability") {
      if (val === "in_stock") {
        clauses.push("EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = products.id AND pv.stock > 0)");
      } else if (val === "out_of_stock") {
        clauses.push("NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = products.id AND pv.stock > 0)");
      }
      continue;
    }

    if (key === "ratingGte") {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 1 && n <= 5) {
        clauses.push("rating >= ?");
        params.push(n);
      }
      continue;
    }

    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      if (!ALLOWED_FILTER_FIELDS.has(key)) continue;
      const column = STRUCTURAL_COLUMN[key];
      for (const [op, v] of Object.entries(val)) {
        if (!["gte", "gt", "lte", "lt"].includes(op) || v === "") continue;
        const num = Number(v);
        clauses.push(`${column} ${{ gte: ">=", gt: ">", lte: "<=", lt: "<" }[op]} ?`);
        params.push(Number.isFinite(num) ? num : v);
      }
    } else if (ALLOWED_FILTER_FIELDS.has(key)) {
      // A comma-separated value (e.g. ?category=<id1>,<id2>) is an OR
      // across that field.
      const rawValues = String(val).split(",").map((v) => v.trim()).filter(Boolean);
      let values = key === "ageGroup" ? rawValues.filter((v) => AGE_GROUP_VALUES.has(v)) : rawValues;

      // Burqa/Hijab storefront scope — an intersection/whitelist, not a
      // blind overwrite, so a specific in-scope topCategory selection still
      // narrows correctly. An out-of-scope/unrecognized id collapses to
      // "match nothing" rather than silently widening back to full scope.
      // Handled HERE (not after the loop) so the emitted clause's params
      // stay in lockstep with its own `?` placeholders — patching an
      // already-emitted clause back out after the fact would desync
      // `clauses` from `params`.
      if (key === "topCategory" && scopeIds) {
        values = values.filter((id) => scopeIds.includes(id));
        topCategoryHandled = true;
      }

      if (values.length) {
        const column = STRUCTURAL_COLUMN[key];
        if (key === "isFeatured" || key === "isActive") {
          clauses.push(`${column} = ?`);
          params.push(isTruthyParam(values[0]) ? 1 : 0);
        } else {
          clauses.push(`${column} IN (${values.map(() => "?").join(",")})`);
          params.push(...values);
        }
      } else if (key === "topCategory" && scopeIds) {
        clauses.push("1=0");
      }
    } else {
      // Attribute facet: comma-separated values are OR'd within the facet;
      // multiple different facets AND together via separate EXISTS clauses.
      const values = String(val).split(",").map((v) => v.trim()).filter(Boolean);
      if (values.length) {
        attributeClauses.push({
          sql: `EXISTS (SELECT 1 FROM product_attributes pa WHERE pa.product_id = products.id AND pa.attr_key = ? AND pa.attr_value IN (${values.map(() => "?").join(",")}))`,
          params: [rawKey, ...values],
        });
      }
    }
  }

  for (const c of attributeClauses) {
    clauses.push(c.sql);
    params.push(...c.params);
  }

  // The query named no topCategory/category at all -> scopeIds becomes the
  // filter outright (the `topCategoryHandled` branch above already applied
  // the intersection when the query DID name one).
  if (scopeIds && !topCategoryHandled) {
    clauses.push(scopeIds.length ? `top_category_id IN (${scopeIds.map(() => "?").join(",")})` : "1=0");
    if (scopeIds.length) params.push(...scopeIds);
  }
  // The product's own category must be visible too: with only the
  // department checked, a product filed under a DEACTIVATED style would keep
  // showing while its department stayed active.
  if (scopeIds && scopeIds.length) {
    clauses.push(`category_id IN (${scopeIds.map(() => "?").join(",")})`);
    params.push(...scopeIds);
  }

  // Applied last so a query param can never override the caller's base
  // scope (e.g. a non-admin can't set ?isActive=false to see inactive
  // products).
  for (const [key, value] of Object.entries(base)) {
    const column = STRUCTURAL_COLUMN[key] || key;
    clauses.push(`${column} = ?`);
    params.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }

  return { where: clauses.length ? clauses.join(" AND ") : "1=1", params };
};

// Real, database-computed counts for the Age Group and Product Collection
// filter options — never hardcoded/estimated. Each dimension is counted
// against the filter state with *that same dimension* excluded (standard
// faceted-search semantics).
export async function buildFacetCounts(query, baseFilter, scopeIds) {
  const queryWithoutAgeGroup = { ...query };
  delete queryWithoutAgeGroup.ageGroup;
  const ageGroupFilter = buildFilter(queryWithoutAgeGroup, baseFilter, scopeIds);

  const queryWithoutCollection = { ...query };
  delete queryWithoutCollection.collection;
  delete queryWithoutCollection.new;
  delete queryWithoutCollection.featured;
  delete queryWithoutCollection.discount;
  const collectionFilter = buildFilter(queryWithoutCollection, baseFilter, scopeIds);

  const queryWithoutAvailability = { ...query };
  delete queryWithoutAvailability.availability;
  const availabilityFilter = buildFilter(queryWithoutAvailability, baseFilter, scopeIds);

  const queryWithoutRating = { ...query };
  delete queryWithoutRating.ratingGte;
  const ratingFilter = buildFilter(queryWithoutRating, baseFilter, scopeIds);

  const [ageGroupRows, newCount, featuredCount, discountCount, inStockCount, outOfStockCount, r5, r4, r3, r2, r1] =
    await Promise.all([
      Product.groupCountByFilter("age_group", ageGroupFilter.where, ageGroupFilter.params),
      Product.countByFilter(`${collectionFilter.where} AND created_at >= ?`, [...collectionFilter.params, getNewArrivalCutoff()]),
      Product.countByFilter(`${collectionFilter.where} AND is_featured = 1`, collectionFilter.params),
      Product.countByFilter(`${collectionFilter.where} AND ${REAL_DISCOUNT_SQL}`, collectionFilter.params),
      Product.countByFilter(
        `${availabilityFilter.where} AND EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = products.id AND pv.stock > 0)`,
        availabilityFilter.params,
      ),
      Product.countByFilter(
        `${availabilityFilter.where} AND NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = products.id AND pv.stock > 0)`,
        availabilityFilter.params,
      ),
      Product.countByFilter(`${ratingFilter.where} AND rating >= 5`, ratingFilter.params),
      Product.countByFilter(`${ratingFilter.where} AND rating >= 4`, ratingFilter.params),
      Product.countByFilter(`${ratingFilter.where} AND rating >= 3`, ratingFilter.params),
      Product.countByFilter(`${ratingFilter.where} AND rating >= 2`, ratingFilter.params),
      Product.countByFilter(`${ratingFilter.where} AND rating >= 1`, ratingFilter.params),
    ]);

  const ageGroup = { adult: 0, kids: 0, girls: 0 };
  for (const row of ageGroupRows) {
    if (row.grp in ageGroup) ageGroup[row.grp] = row.count;
  }

  return {
    ageGroup,
    collection: { new: newCount, featured: featuredCount, discount: discountCount },
    availability: { in_stock: inStockCount, out_of_stock: outOfStockCount },
    ratingGte: { 5: r5, 4: r4, 3: r3, 2: r2, 1: r1 },
  };
}

export function computePagination(query, total = 0) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Number(query.limit) || 12);
  const skip = (page - 1) * limit;
  const pages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, skip, pages };
}

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

  for (const key of ["page", "limit"]) {
    if (query[key] !== undefined && typeof query[key] !== "string") failQuery(`Invalid ${key}`, key);
    if (query[key] !== undefined) out[key] = query[key];
  }

  if ((query.priceMin !== undefined && query.priceMin !== "") || (query.priceMax !== undefined && query.priceMax !== "")) {
    if (query.basePrice !== undefined && query.basePrice !== "") {
      failQuery("priceMin/priceMax cannot be combined with basePrice", "priceMin");
    }
    const converted = {};
    if (query.priceMin !== undefined && query.priceMin !== "") {
      if (typeof query.priceMin !== "string") failQuery("Invalid priceMin", "priceMin");
      const { value, error } = validateBoundedPriceValue(query.priceMin);
      if (error) failQuery(`Invalid priceMin: ${error}`, "priceMin");
      converted.gte = value;
    }
    if (query.priceMax !== undefined && query.priceMax !== "") {
      if (typeof query.priceMax !== "string") failQuery("Invalid priceMax", "priceMax");
      const { value, error } = validateBoundedPriceValue(query.priceMax);
      if (error) failQuery(`Invalid priceMax: ${error}`, "priceMax");
      converted.lte = value;
    }
    if (converted.gte !== undefined && converted.lte !== undefined && converted.gte > converted.lte) {
      failQuery("priceMin must not exceed priceMax", "priceMin");
    }
    out.basePrice = converted;
  } else if (query.basePrice !== undefined && query.basePrice !== "") {
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
    const defs = await AttributeDefinition.findByKeys(dynamicKeys);
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
// instead. A root department (Cosmetics) or an already-department id
// (Burqa) is returned unchanged.
export async function expandCategoryScope(categoryId) {
  const children = await Category.findByParent(categoryId);
  if (!children.length) return [categoryId];
  const grandchildRows = await Category.findChildIdsByParents(children.map((c) => c._id));
  const isDivision = grandchildRows.length > 0;
  return isDivision ? children.map((c) => c._id) : [categoryId];
}

async function stripInapplicableAttributeFilters(query, deptId) {
  if (!deptId) return query;
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

async function expandCategoryQueryParam(query) {
  const raw = query?.category;
  if (!raw || typeof raw !== "string") return query;
  const ids = raw.split(",").map((v) => v.trim()).filter(Boolean);
  if (ids.length !== 1 || !isObjectIdFormat(ids[0])) return query;
  const expanded = await expandCategoryScope(ids[0]);
  return expanded.length > 1 ? { ...query, category: expanded.join(",") } : query;
}

function resolveSingleDepartmentId(query) {
  const raw = query?.category;
  if (!raw || typeof raw !== "string") return null;
  const ids = raw.split(",").map((v) => v.trim()).filter(Boolean);
  return ids.length === 1 && isObjectIdFormat(ids[0]) ? ids[0] : null;
}

const SORT_COLUMN = { createdAt: "created_at", basePrice: "base_price", rating: "rating", isFeatured: "is_featured", name: "name" };

function parseSort(sortStr) {
  if (!sortStr) return [{ column: "created_at", dir: "DESC" }];
  return sortStr.split(",").map((token) => {
    const desc = token.startsWith("-");
    const field = desc ? token.slice(1) : token;
    return { column: SORT_COLUMN[field] || "created_at", dir: desc ? "DESC" : "ASC" };
  });
}

export async function listProducts(query, { isAdmin = false, includeFacets = true } = {}) {
  query = await expandCategoryQueryParam(query);
  query = await stripInapplicableAttributeFilters(query, resolveSingleDepartmentId(query));
  const baseFilter = isAdmin ? {} : { isActive: true };
  const scopeIds = isAdmin ? null : await getStorefrontDepartmentIds();
  const { where, params } = buildFilter(query, baseFilter, scopeIds);
  const { page, limit, skip } = computePagination(query);
  const sort = parseSort(typeof query.sort === "string" ? query.sort : null);

  const [products, total, facets] = await Promise.all([
    Product.findByFilter(where, params, { sort, skip, limit }),
    Product.countByFilter(where, params),
    isAdmin || !includeFacets ? null : buildFacetCounts(query, baseFilter, scopeIds),
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

const CARD_FIELDS_NOTE = "row-level selection is no longer applied (see models/productModel.js) — every list already returns the full product shape ProductCard.jsx needs, plus more.";
void CARD_FIELDS_NOTE;

export async function getProductByIdOrSlug(idOrSlug) {
  const isId = isObjectIdFormat(idOrSlug);
  const product = await Product.findByIdOrSlug(idOrSlug, isId);
  if (!product) throw new HttpError(404, "Product not found");
  return product;
}

export async function getCompareProducts(ids) {
  const list = (Array.isArray(ids) ? ids : String(ids || "").split(","))
    .map((s) => s.trim())
    .filter(isObjectIdFormat);
  if (!list.length) return [];
  return Product.findByIds(list);
}

export async function listFeatured(limit = 8) {
  const scopeIds = await getStorefrontDepartmentIds();
  const { where, params } = buildFilter({}, { isFeatured: true, isActive: true }, scopeIds);
  return Product.findByFilter(where, params, { sort: [{ column: "rating", dir: "DESC" }], skip: 0, limit });
}

export async function listGroupings(categoryId) {
  if (categoryId) requireObjectIdFormat(categoryId, "category");
  const categories = categoryId ? await Category.findByParent(categoryId) : await Category.findByParent(null);
  if (categories.length === 0) return [];

  const categoryIds = categories.map((c) => c._id);

  if (!categoryId) {
    const childRows = await Category.findChildIdsByParents(categoryIds);
    const childToRoot = new Map(childRows.map((ch) => [ch.id, ch.parent_id]));
    const allScopeIds = [...categoryIds, ...childRows.map((ch) => ch.id)];

    const { where, params } = buildFilter({}, { isActive: true }, null);
    const scoped = allScopeIds.length
      ? `${where} AND top_category_id IN (${allScopeIds.map(() => "?").join(",")})`
      : "1=0";
    const counted = await Product.groupCountByFilter("top_category_id", scoped, [...params, ...allScopeIds]);

    const countByRoot = new Map();
    for (const row of counted) {
      const rootId = childToRoot.get(row.grp) ?? row.grp;
      countByRoot.set(rootId, (countByRoot.get(rootId) ?? 0) + row.count);
    }

    return categories
      .map((c) => ({
        _id: c._id,
        name: c.name,
        nameBn: c.nameBn,
        slug: c.slug,
        count: countByRoot.get(c._id) ?? 0,
        isLeaf: false,
      }))
      .filter((g) => g.count > 0);
  }

  const grandchildRows = await Category.findChildIdsByParents(categoryIds);
  const nonLeafIds = new Set(grandchildRows.map((r) => r.parent_id));
  const leafIds = categoryIds.filter((id) => !nonLeafIds.has(id));
  const nonLeafIdsArr = categoryIds.filter((id) => nonLeafIds.has(id));

  const [leafCounts, nonLeafCounts] = await Promise.all([
    leafIds.length
      ? Product.groupCountByFilter("category_id", `is_active = 1 AND category_id IN (${leafIds.map(() => "?").join(",")})`, leafIds)
      : [],
    nonLeafIdsArr.length
      ? Product.groupCountByFilter("top_category_id", `is_active = 1 AND top_category_id IN (${nonLeafIdsArr.map(() => "?").join(",")})`, nonLeafIdsArr)
      : [],
  ]);

  const countById = new Map();
  for (const row of [...leafCounts, ...nonLeafCounts]) countById.set(row.grp, row.count);

  return categories
    .map((c) => {
      const isLeaf = !nonLeafIds.has(c._id);
      return {
        _id: c._id,
        name: c.name,
        nameBn: c.nameBn,
        slug: c.slug,
        count: countById.get(c._id) ?? 0,
        isLeaf,
      };
    })
    .filter((g) => g.count > 0);
}

export async function listBrandsForCategory(categoryId) {
  if (!categoryId) return Brand.findActive();
  requireObjectIdFormat(categoryId, "category");
  const scopeIds = await expandCategoryScope(categoryId);
  const brandIds = scopeIds.length
    ? await Product.distinctBrandIds(`is_active = 1 AND top_category_id IN (${scopeIds.map(() => "?").join(",")})`, scopeIds)
    : [];
  if (!brandIds.length) return [];
  return Brand.findActiveByIds(brandIds);
}

export async function listRelated(idOrSlug, limit = 8) {
  const current = await getProductByIdOrSlug(idOrSlug);
  const clampedLimit = Math.min(24, Math.max(1, Number(limit) || 8));

  const sameDept = await Product.findByFilter(
    "id != ? AND top_category_id = ? AND is_active = 1",
    [current._id, current.topCategory],
    { sort: [{ column: "created_at", dir: "DESC" }], skip: 0, limit: 500 },
  );

  const currentCategoryId = String(current.category?._id || current.category);
  const currentAttrs = new Map((current.attributes || []).map((a) => [a.key, new Set(a.values)]));
  const isInStock = (p) => (p.variants || []).some((v) => (v.stock ?? 0) > 0);

  const scoreOf = (p) => {
    const sameCategory = String(p.category?._id || p.category) === currentCategoryId ? 1000 : 0;
    const attrOverlap = (p.attributes || []).reduce((sum, a) => {
      const shared = a.values.filter((v) => currentAttrs.get(a.key)?.has(v)).length;
      return sum + shared;
    }, 0);
    const inStockBonus = isInStock(p) ? 2 : 0;
    return sameCategory + attrOverlap + inStockBonus;
  };

  let ranked = sameDept
    .map((product) => ({ product, score: scoreOf(product) }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.product);

  if (ranked.length < clampedLimit) {
    const excludeIds = [current._id, ...ranked.map((p) => p._id)];
    const fillers = await Product.findByFilter(
      `id NOT IN (${excludeIds.map(() => "?").join(",")}) AND is_active = 1`,
      excludeIds,
      { sort: [{ column: "is_featured", dir: "DESC" }, { column: "rating", dir: "DESC" }, { column: "created_at", dir: "DESC" }], skip: 0, limit: clampedLimit - ranked.length },
    );
    ranked = [...ranked, ...fillers];
  }

  return ranked.slice(0, clampedLimit);
}

export async function getProductsByIds(ids) {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).filter(isObjectIdFormat))].slice(0, 12);
  if (!clean.length) return [];
  return Product.findByIds(clean, { activeOnly: true });
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
  "imageFraming",
  "variants",
  "attributes",
  "measurements",
  "includedItems",
  "availability",
  "tags",
  "isFeatured",
  "isActive",
  "metaTitle",
  "metaDescription",
  "metaKeywords",
  "ogImage",
];

const pickWritable = (body) => {
  const out = {};
  for (const key of WRITABLE_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

async function resolveLeafCategory(categoryId) {
  if (!isObjectIdFormat(categoryId)) throw new HttpError(400, "Invalid category id");
  const category = await Category.findById(categoryId);
  if (!category) throw new HttpError(400, "Category not found");
  if (!(await isLeafCategory(category._id))) {
    throw new HttpError(400, `"${category.name}" is a department, not a style — assign a subcategory instead`);
  }
  return category;
}

// SKUs are unique store-wide (uq_product_variants_sku is case-insensitive
// under utf8mb4_unicode_ci, so "NIKE-1" and "nike-1" clash). Checked here so
// the admin gets a message naming the SKU; the DB constraint remains the
// real guarantee against concurrent writers.
async function assertSkusUnique(variants, excludeProductId) {
  const seen = new Map();
  for (const v of variants || []) {
    const key = String(v.sku ?? "").trim().toLowerCase();
    if (!key) throw new HttpError(400, `Variant "${v.variantName}" needs a SKU`);
    if (seen.has(key)) {
      throw new HttpError(400, `SKU "${v.sku}" is used by more than one variant of this product — every variant needs its own SKU`);
    }
    seen.set(key, true);
  }
  const skus = (variants || []).map((v) => v.sku).filter(Boolean);
  if (!skus.length) return;
  const taken = await Product.findVariantClash(skus, excludeProductId);
  if (taken) {
    throw new HttpError(400, `SKU "${taken}" is already used by another product`);
  }
}

// Variant identity attributes (color, size, ...) are DATA-driven: the ones a
// variant may carry are the derivedFromVariant definitions that apply to the
// product's department. Validates the submitted values against them, so the
// server never depends on the form having done it.
async function assertVariantsValid(variants, departmentId, existingVariants = []) {
  const defs = (await resolveAttributesForCategory(departmentId)).filter((d) => d.derivedFromVariant);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const ownIds = new Set(existingVariants.map((v) => String(v._id)));
  const signatures = new Map();

  for (const v of variants || []) {
    const name = v.variantName || v.sku;
    if (v._id && !ownIds.has(String(v._id))) {
      throw new HttpError(400, `Variant "${name}" refers to a variant that doesn't belong to this product`);
    }
    for (const key of Object.keys(v.attributes || {})) {
      if (!byKey.has(key)) {
        throw new HttpError(400, `Variant "${name}": "${key}" isn't an attribute of this department`);
      }
    }
    for (const def of defs) {
      if (def.required && !v.attributes?.[def.key]) {
        throw new HttpError(400, `Variant "${name}": ${def.label} is required`);
      }
    }
    // Two rows with the same identity (Black / 40 twice) are one variant
    // entered twice — a shopper couldn't tell them apart.
    const entries = Object.entries(v.attributes || {}).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length) {
      const sig = JSON.stringify(entries.map(([k, val]) => [k, String(val).toLowerCase()]));
      if (signatures.has(sig)) {
        const label = entries.map(([, val]) => val).join(" / ");
        throw new HttpError(400, `Two variants are both "${label}" — merge them or change one`);
      }
      signatures.set(sig, true);
    }
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
  const allDefs = await AttributeDefinition.findAll();
  const topCategoryIdStr = topCategoryId ? String(topCategoryId) : null;
  const required = allDefs.filter(
    (d) => d.required && (!d.appliesToCategories?.length || d.appliesToCategories.some((c) => String(c) === topCategoryIdStr)),
  );
  if (!required.length) return;

  const provided = new Map((data.attributes || []).map((a) => [a.key, a.values]));
  for (const def of required) {
    const values = provided.get(def.key);
    if (!values || !values.length) {
      throw new HttpError(400, `"${def.label}" is required for this category`);
    }
  }
}

// Every image URL a product actually uses — a saved crop only makes sense
// for one of these, so anything else in a framing map is stale and dropped.
function usedImageUrls(images, variants) {
  const urls = new Set(images || []);
  for (const v of variants || []) for (const u of v.images || []) urls.add(u);
  return urls;
}

function pruneFramingList(list, images, variants) {
  return pruneFramingListToUrls(list, usedImageUrls(images, variants));
}

// Framing is stored via its own statement (models/productModel.js); on a
// database without migration 0006 there is nowhere to put it, so refuse
// loudly BEFORE any write rather than silently dropping the admin's crop.
async function assertImageFramingStorage(list) {
  if (Array.isArray(list) && list.length > 0 && !(await Product.imageFramingInstalled())) {
    throw new HttpError(409, "Image framing storage is not installed on this database — run scripts/runMigrations.mjs (migration 0006_image_framing) first.");
  }
}

export async function createProduct(body, actorId) {
  const data = pickWritable(body);
  await assertImageFramingStorage(data.imageFraming);
  if (!data.category) throw new HttpError(400, "Category is required");
  if (!data.variants?.length) throw new HttpError(400, "At least one variant is required");

  const category = await resolveLeafCategory(data.category);
  await assertSkusUnique(data.variants);
  await assertVariantsValid(data.variants, category.parent ?? category._id);
  assertDiscountsValid(data);
  await assertRequiredAttributes(data, category.parent);

  // assertSkusUnique() above is a read-then-write check with no lock — a
  // real TOCTOU gap under concurrent admin requests (confirmed audit
  // finding). The DB-level `uq_product_variants_sku` constraint (see
  // sql/schema.sql / scripts/migrations/0002_product_variants_sku_unique.mjs)
  // is the actual guarantee; this catch turns a losing concurrent
  // request's raw ER_DUP_ENTRY into the same clean 400 assertSkusUnique()
  // itself would have given if it had won the race instead.
  let product;
  try {
    // Product + variants + attributes + framing: one transaction (models/productModel.js).
    product = await Product.create(data, {
      framingList: pruneFramingList(data.imageFraming, data.images, data.variants),
    });
  } catch (err) {
    if (isDuplicateKeyError(err, "uq_product_variants_sku")) {
      throw new HttpError(400, "That SKU is already used by another product");
    }
    throw err;
  }
  await emitBestEffort(
    emitAdminEvent({ type: "PRODUCT_CREATED", productId: product._id.toString(), name: product.name, actorId }),
  );
  return product;
}

export async function updateProduct(id, body, actorId) {
  requireObjectIdFormat(id, "id");
  const product = await Product.findById(id);
  if (!product) throw new HttpError(404, "Product not found");

  const data = pickWritable(body);
  await assertImageFramingStorage(data.imageFraming);
  const categoryId = data.category ?? String(product.category?._id ?? product.category);
  const category = await resolveLeafCategory(categoryId);

  const variants = data.variants ?? product.variants;
  await assertSkusUnique(variants, product._id);
  if (data.variants) await assertVariantsValid(data.variants, category.parent ?? category._id, product.variants);
  assertDiscountsValid({ ...product, ...data, variants });
  await assertRequiredAttributes({ ...product, ...data }, category.parent);

  // A crop belongs to one specific photo: whenever the framing map, the
  // gallery or a variant's photos changed, rewrite the map limited to the
  // photos still in use (so removed/replaced photos never leave stale crops).
  const framingChanged =
    data.imageFraming !== undefined || data.images !== undefined || data.variants !== undefined;
  Object.assign(product, data);
  try {
    await product.save({
      framingList: framingChanged ? pruneFramingList(product.imageFraming, product.images, product.variants) : undefined,
    });
  } catch (err) {
    if (isDuplicateKeyError(err, "uq_product_variants_sku")) {
      throw new HttpError(400, "That SKU is already used by another product");
    }
    throw err;
  }
  // Product.findById() (unlike findByIdOrSlug(), which the storefront PDP
  // needs populated) is meant to mirror the original bare Mongoose
  // `Model.findById()` this route used before the migration — no
  // populate(), so `category`/`brand` came back as raw ids. hydrate()
  // populates both unconditionally, so re-flatten them to ids here to
  // keep this route's response contract unchanged for its callers.
  product.category = typeof product.category === "object" ? product.category._id : product.category;
  product.brand = typeof product.brand === "object" && product.brand ? product.brand._id : product.brand;
  await emitBestEffort(
    emitAdminEvent({ type: "PRODUCT_UPDATED", productId: product._id.toString(), name: product.name, actorId }),
  );
  return product;
}

// Deleting removes the product from every list (admin and storefront); a full
// snapshot is kept in the deleted_products table. To merely hide a product,
// untick "Active" in its edit form instead.
export async function deleteProduct(id, actorId) {
  requireObjectIdFormat(id, "id");
  const product = await Product.findById(id);
  if (!product) throw new HttpError(404, "Product not found");
  await Product.deleteWithLog(id, { deletedBy: actorId ?? null });
  await emitBestEffort(
    emitAdminEvent({ type: "PRODUCT_DELETED", productId: String(product._id), name: product.name, actorId }),
  );
}
