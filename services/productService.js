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
const NON_FILTER_KEYS = new Set(["search", "featured", "sort", "limit", "page", "fields"]);

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildFilter = (query, base = {}) => {
  const { search, featured } = query;
  const filter = {};
  const attributeConditions = [];

  if (search && String(search).trim().length >= 2) {
    const term = String(search).trim();
    if (term.length >= 3) {
      filter.$text = { $search: term };
    } else {
      filter.name = new RegExp(`^${escapeRegex(term)}`, "i");
    }
  }
  if (featured === "true" || featured === "1") filter.isFeatured = true;

  for (const [rawKey, val] of Object.entries(query)) {
    if (NON_FILTER_KEYS.has(rawKey)) continue;
    if (val === undefined || val === "") continue;

    // Storefront URL aliases: ?category= is the department (topCategory),
    // ?style= is the specific subcategory (category) — see Phase 3 plan §2.
    const key = rawKey === "category" ? "topCategory" : rawKey === "style" ? "category" : rawKey;

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
      filter[key] = val;
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

  // Applied last so a query param can never override the caller's base scope
  // (e.g. a non-admin can't set ?isActive=false to see inactive products).
  Object.assign(filter, base);
  return filter;
};

export async function listProducts(query, { isAdmin = false } = {}) {
  const baseFilter = isAdmin ? {} : { isActive: true };
  const filter = buildFilter(query, baseFilter);

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Number(query.limit) || 12);
  const skip = (page - 1) * limit;

  const sortStr = typeof query.sort === "string" ? query.sort.split(",").join(" ") : "-createdAt";
  const fieldsStr = typeof query.fields === "string" ? query.fields.split(",").join(" ") : "-__v";

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(sortStr)
      .select(fieldsStr)
      .skip(skip)
      .limit(limit)
      .populate("brand", "name slug")
      .populate("category", "name slug")
      .lean(),
    Product.countDocuments(filter),
  ]);

  return {
    page,
    limit,
    total,
    pages: Math.max(1, Math.ceil(total / limit)),
    count: products.length,
    products,
  };
}

export async function getProductByIdOrSlug(idOrSlug) {
  const isId = mongoose.isValidObjectId(idOrSlug);
  const product = await Product.findOne(isId ? { _id: idOrSlug } : { slug: idOrSlug })
    .populate("brand", "name slug")
    .populate("category", "name slug");
  if (!product) throw new HttpError(404, "Product not found");
  return product;
}

export async function listFeatured(limit = 8) {
  return Product.find({ isFeatured: true, isActive: true })
    .sort("-rating")
    .limit(limit)
    .populate("brand", "name slug")
    .populate("category", "name slug")
    .lean();
}

// Sneaker-era "distinct model names scoped by brand" replaced with its
// modest-fashion equivalent: product groupings by category. With no
// `category` param, groups at the department level (6 top-level counts);
// with one, groups by the subcategories under that department. Only
// categories/departments with at least one active product are included.
export async function listGroupings(categoryId) {
  const parentFilter = categoryId ? { parent: categoryId } : { parent: null };
  const categories = await Category.find(parentFilter).sort("sortOrder name").lean();

  const groupings = await Promise.all(
    categories.map(async (c) => {
      const scopeIds = categoryId
        ? [c._id]
        : [c._id, ...(await Category.find({ parent: c._id }).distinct("_id"))];
      const count = await Product.countDocuments({
        isActive: true,
        [categoryId ? "category" : "topCategory"]: categoryId ? c._id : { $in: scopeIds },
      });
      return { _id: c._id, name: c.name, slug: c.slug, count };
    }),
  );

  return groupings.filter((g) => g.count > 0);
}

// Related = same leaf category ranks above same-department-only, and within
// each tier, products sharing more attribute values (fabric, color, etc.)
// with the current product rank higher.
export async function listRelated(idOrSlug, limit = 4) {
  const current = await getProductByIdOrSlug(idOrSlug);

  const candidates = await Product.find({
    _id: { $ne: current._id },
    topCategory: current.topCategory,
    isActive: true,
  })
    .populate("brand", "name slug")
    .populate("category", "name slug")
    .lean();

  const currentCategoryId = String(current.category?._id || current.category);
  const currentAttrs = new Map((current.attributes || []).map((a) => [a.key, new Set(a.values)]));

  const scored = candidates.map((p) => {
    const sameCategory = String(p.category?._id || p.category) === currentCategoryId ? 1000 : 0;
    const attrOverlap = (p.attributes || []).reduce((sum, a) => {
      const shared = a.values.filter((v) => currentAttrs.get(a.key)?.has(v)).length;
      return sum + shared;
    }, 0);
    return { product: p, score: sameCategory + attrOverlap };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.product);
}

const WRITABLE_FIELDS = [
  "name",
  "description",
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

// Resolves the leaf category and validates it's actually a leaf (a bare
// department can't be assigned directly to a product) — also returns the
// department id for the required-attribute check below.
async function resolveLeafCategory(categoryId) {
  const category = await Category.findById(categoryId).lean();
  if (!category) throw new HttpError(400, "Category not found");
  if (!category.parent) {
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
  return product;
}

export async function updateProduct(id, body) {
  const product = await Product.findById(id);
  if (!product) throw new HttpError(404, "Product not found");

  const data = pickWritable(body);
  const categoryId = data.category ?? product.category;
  const category = await resolveLeafCategory(categoryId);

  const variants = data.variants ?? product.variants;
  await assertSkusUnique(variants, product._id);
  assertDiscountsValid({ ...product.toObject(), ...data, variants });
  await assertRequiredAttributes({ ...product.toObject(), ...data }, category.parent);

  Object.assign(product, data);
  await product.save();
  return product;
}

export async function deleteProduct(id) {
  const product = await Product.findById(id);
  if (!product) throw new HttpError(404, "Product not found");
  product.isActive = false;
  await product.save();
}
