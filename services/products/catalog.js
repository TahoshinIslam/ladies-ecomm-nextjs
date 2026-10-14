import Product from "../../models/productModel.js";
import Category from "../../models/categoryModel.js";
import Brand from "../../models/brandModel.js";
import { HttpError } from "../../lib/http.js";
import { requireObjectIdFormat, isObjectIdFormat } from "../../lib/validation.js";
import { getStorefrontDepartmentIds } from "../storefrontScopeService.js";
import { PUBLISHED_SQL, buildFilter, buildFacetCounts, computePagination, categorySubtreeIds, stripInapplicableAttributeFilters, expandCategoryQueryParam, resolveSingleDepartmentId, parseSort } from "./listQuery.js";

/** Reading the catalogue a shopper sees: lists, a product, comparisons, related items. */
export async function listProducts(query, { isAdmin = false, includeFacets = true } = {}) {
  // Decide which attribute filters apply from the category the shopper actually named, then widen the category filters to whole subtrees.
  query = await stripInapplicableAttributeFilters(query, await resolveSingleDepartmentId(query));
  query = await expandCategoryQueryParam(query);
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
  // No variant offered online (every one is POS-only): nothing to show or sell here.
  if (!product || !product.variants?.length) throw new HttpError(404, "Product not found");
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


// The tiles under a category (or the top-level ones when none is named). Each tile's count covers everything filed anywhere beneath it,
// however deep, so "Snacks" counts its biscuits and noodles too. `isLeaf` says whether the tile has subcategories of its own.
export async function listGroupings(categoryId) {
  if (categoryId) requireObjectIdFormat(categoryId, "category");
  const all = await Category.findAll();
  const childrenOf = new Map();
  for (const c of all) {
    const key = c.parent || null;
    const list = childrenOf.get(key) || [];
    list.push(c);
    childrenOf.set(key, list);
  }

  const tiles = childrenOf.get(categoryId || null) || [];
  if (tiles.length === 0) return [];

  const subtreeOf = (id) => {
    const out = [];
    const queue = [id];
    const seen = new Set();
    while (queue.length) {
      const next = queue.shift();
      if (seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      for (const child of childrenOf.get(next) || []) queue.push(child._id);
    }
    return out;
  };

  const everyId = [...new Set(tiles.flatMap((t) => subtreeOf(t._id)))];
  const { where, params } = buildFilter({}, { isActive: true }, null);
  const counted = await Product.groupCountByFilter("category_id", `${where} AND category_id IN (${everyId.map(() => "?").join(",")})`, [...params, ...everyId]);
  const countOf = new Map(counted.map((row) => [row.grp, row.count]));

  return tiles
    .map((c) => ({
      _id: c._id,
      name: c.name,
      nameBn: c.nameBn,
      slug: c.slug,
      count: subtreeOf(c._id).reduce((sum, id) => sum + (countOf.get(id) ?? 0), 0),
      // A top-level tile is always something to open (a department), even one with no subcategories of its own.
      isLeaf: categoryId ? !(childrenOf.get(c._id) || []).length : false,
    }))
    .filter((g) => g.count > 0);
}


export async function listBrandsForCategory(categoryId) {
  if (!categoryId) return Brand.findActive();
  requireObjectIdFormat(categoryId, "category");
  const scopeIds = await categorySubtreeIds([categoryId]);
  const brandIds = scopeIds.length
    ? await Product.distinctBrandIds(`${PUBLISHED_SQL} AND category_id IN (${scopeIds.map(() => "?").join(",")})`, scopeIds)
    : [];
  if (!brandIds.length) return [];
  return Brand.findActiveByIds(brandIds);
}


export async function listRelated(idOrSlug, limit = 8) {
  const current = await getProductByIdOrSlug(idOrSlug);
  const clampedLimit = Math.min(24, Math.max(1, Number(limit) || 8));

  const sameDept = await Product.findByFilter(
    `id != ? AND top_category_id = ? AND ${PUBLISHED_SQL}`,
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
      `id NOT IN (${excludeIds.map(() => "?").join(",")}) AND ${PUBLISHED_SQL}`,
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
