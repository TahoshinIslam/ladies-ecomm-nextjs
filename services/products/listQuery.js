import Product from "../../models/productModel.js";
import Category from "../../models/categoryModel.js";
import AttributeDefinition from "../../models/attributeDefinitionModel.js";
import { HttpError } from "../../lib/http.js";
import { isObjectIdFormat } from "../../lib/validation.js";
import { resolveAttributesForCategory } from "../attributeService.js";
import { PRODUCT_SORT_FIELDS, PRODUCT_SELECT_FIELDS, FACET_KEY_RE, DANGEROUS_FACET_KEYS, MAX_PRODUCT_QUERY_LENGTH, MAX_DYNAMIC_FACETS, MAX_FACET_KEY_LENGTH, MAX_FACET_VALUES, MAX_FACET_VALUE_LENGTH, splitBoundedCsv, isExplicitBooleanParam, validateAllowlistedTokenCsv, validateBoundedPriceValue, AGE_GROUP_VALUES_LIST } from "../../schemas/catalogSchemas.js";

/** Turning a product-list request into a safe, scoped query: filters, facets, sorting, paging. */
// Structural fields — a fixed, known set of flat columns (plus the
// storefront's category/style aliases below).
// "Published" on the shop: switched on AND with at least one variant offered
// online (a variant can be point-of-sale only). Qualified with `products.` so it
// works in any query whose FROM is the products table.
export const PUBLISHED_SQL =
  "is_active = 1 AND EXISTS (SELECT 1 FROM product_variants pov WHERE pov.organization_id = products.organization_id AND pov.product_id = products.id AND pov.sell_online = 1 AND online_listed(pov.organization_id, pov.id) = 1)";


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




// Every product's `topCategory` is denormalized to its category's IMMEDIATE
// parent (models/productModel.js's resolveDerivedFields — deliberately one
// level, not a walk-to-root).
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


const isTruthyParam = (v) => v === "true" || v === "1";


// scopeIds: null for admin (unscoped) or the storefront's allowed
// topCategory ids. When the query already names a topCategory/category,
// the requested value(s) are *intersected* with scopeIds rather than
// overwritten. When the query names none, scopeIds becomes the filter
// outright. Returns a raw SQL WHERE fragment + its params.
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
    //
    // listProducts has already expanded each id to itself plus every category beneath it and `?category=` matches the product's OWN
    // category, so a node at any depth finds every product filed anywhere under it. (The denormalised `top_category_id` is only the
    // product's immediate parent and cannot answer that for a tree of unlimited depth.)
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
        clauses.push("EXISTS (SELECT 1 FROM product_variants pv WHERE pv.organization_id = products.organization_id AND pv.product_id = products.id AND pv.stock > 0)");
      } else if (val === "out_of_stock") {
        clauses.push("NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.organization_id = products.organization_id AND pv.product_id = products.id AND pv.stock > 0)");
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

        } else if (rawKey === "category" && key === "topCategory") {
          // listProducts passes the whole subtree here, so the product's own category matches at any depth. A caller that passes a bare
          // department id (no expansion) still matches through the denormalised immediate parent.
          const marks = values.map(() => "?").join(",");
          clauses.push(`(category_id IN (${marks}) OR ${column} IN (${marks}))`);
          params.push(...values, ...values);
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
          sql: `EXISTS (SELECT 1 FROM product_attributes pa WHERE pa.organization_id = products.organization_id AND pa.product_id = products.id AND pa.attr_key = ? AND pa.attr_value IN (${values.map(() => "?").join(",")}))`,
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
    // A published product with no variant offered online has nothing to sell
    // on the shop, so it is not listed (a variant can be point-of-sale only).
    if (key === "isActive" && value === true) {
      clauses.push("EXISTS (SELECT 1 FROM product_variants pov WHERE pov.organization_id = products.organization_id AND pov.product_id = products.id AND pov.sell_online = 1 AND online_listed(pov.organization_id, pov.id) = 1)");
    }
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
        `${availabilityFilter.where} AND EXISTS (SELECT 1 FROM product_variants pv WHERE pv.organization_id = products.organization_id AND pv.product_id = products.id AND pv.stock > 0)`,
        availabilityFilter.params,
      ),
      Product.countByFilter(
        `${availabilityFilter.where} AND NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.organization_id = products.organization_id AND pv.product_id = products.id AND pv.stock > 0)`,
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


// A category plus every category beneath it, at any depth. One read of the (small) category table, then a walk in memory.
export async function categorySubtreeIds(rootIds) {
  const all = await Category.findAll();
  const childrenOf = new Map();
  for (const c of all) {
    if (!c.parent) continue;
    const list = childrenOf.get(c.parent) || [];
    list.push(c._id);
    childrenOf.set(c.parent, list);
  }
  const out = new Set();
  const queue = [...rootIds];
  while (queue.length) {
    const id = queue.shift();
    if (out.has(id)) continue;
    out.add(id);
    queue.push(...(childrenOf.get(id) || []));
  }
  return [...out];
}


// Kept for callers that ask "which categories does this one cover?" — itself and everything beneath it.
export async function expandCategoryScope(categoryId) {
  return categorySubtreeIds([categoryId]);
}


export async function stripInapplicableAttributeFilters(query, deptId) {
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


// ?category=<id>[,<id>] and ?style=<id>[,<id>]: each valid id becomes itself plus every descendant, so the product filter works for a
// category at any depth (Food, Snacks, Biscuits, ... all return the products filed beneath them). Anything that is not a well-formed id
// is passed through untouched and simply matches nothing.
export async function expandCategoryQueryParam(query) {
  const out = { ...query };
  let changed = false;
  for (const key of ["category", "style"]) {
    const raw = query?.[key];
    if (!raw || typeof raw !== "string") continue;
    const ids = raw.split(",").map((v) => v.trim()).filter(Boolean);
    if (!ids.length || !ids.every(isObjectIdFormat)) continue;
    out[key] = (await categorySubtreeIds(ids)).join(",");
    changed = true;
  }
  return changed ? out : query;
}


// The single department id a query names, if it names exactly one — used to drop attribute filters that do not apply to it. Only a
// department in the old sense (a category whose children are all leaves) has attribute definitions of its own; a higher node does not.
export async function resolveSingleDepartmentId(query) {
  const raw = query?.category;
  if (!raw || typeof raw !== "string") return null;
  const ids = raw.split(",").map((v) => v.trim()).filter(Boolean);
  if (ids.length !== 1 || !isObjectIdFormat(ids[0])) return null;
  const children = await Category.findByParent(ids[0]);
  if (!children.length) return ids[0];
  const grandchildren = await Category.findChildIdsByParents(children.map((c) => c._id));
  return grandchildren.length ? null : ids[0];
}


const SORT_COLUMN = { createdAt: "created_at", basePrice: "base_price", rating: "rating", isFeatured: "is_featured", name: "name" };


export function parseSort(sortStr) {
  if (!sortStr) return [{ column: "created_at", dir: "DESC" }];
  return sortStr.split(",").map((token) => {
    const desc = token.startsWith("-");
    const field = desc ? token.slice(1) : token;
    return { column: SORT_COLUMN[field] || "created_at", dir: desc ? "DESC" : "ASC" };
  });
}
