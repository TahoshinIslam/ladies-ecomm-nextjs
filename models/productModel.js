import slugify from "slugify";

import { query, withConnection } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import Category from "./categoryModel.js";
import AttributeDefinition from "./attributeDefinitionModel.js";
import Brand from "./brandModel.js";

// SQL-backed replacement for the old Mongoose product model. See
// models/README-migration.md for the general per-model pattern. This one
// additionally owns the child tables that used to be Mongo subdocuments/
// denormalized arrays: product_variants, product_attributes (the
// denormalized facet table), plus JSON columns for images/tags/included_items.
//
// Unlike most other models, `find()`/`count()`/`groupCount()` here take a
// raw SQL WHERE fragment + params (built by services/productService.js's
// buildFilter(), which mirrors the old Mongo-filter-object builder but
// emits SQL instead) rather than a Mongo-shaped filter object — the filter
// DSL products support (structural fields, dynamic attribute facets, price
// expressions, full-text search) is too open-ended to usefully re-express
// as a small fixed set of supported filter keys the way simpler models do.

function jsonArray(value) {
  return typeof value === "string" ? JSON.parse(value) : value || [];
}

async function loadVariants(productIds) {
  if (!productIds.length) return new Map();
  const rows = await query(
    `SELECT * FROM product_variants WHERE product_id IN (${productIds.map(() => "?").join(",")}) ORDER BY position ASC`,
    productIds,
  );
  const map = new Map();
  for (const r of rows) {
    const list = map.get(r.product_id) || [];
    list.push({
      _id: r.id,
      variantName: r.variant_name,
      sku: r.sku,
      attributes: typeof r.attributes === "string" ? JSON.parse(r.attributes) : r.attributes || {},
      price: r.price,
      discountPrice: r.discount_price,
      stock: r.stock,
      images: jsonArray(r.images),
    });
    map.set(r.product_id, list);
  }
  return map;
}

async function loadAttributes(productIds) {
  if (!productIds.length) return new Map();
  const rows = await query(
    `SELECT * FROM product_attributes WHERE product_id IN (${productIds.map(() => "?").join(",")}) ORDER BY position ASC`,
    productIds,
  );
  const byProduct = new Map();
  for (const r of rows) {
    const byKey = byProduct.get(r.product_id) || new Map();
    const list = byKey.get(r.attr_key) || [];
    list.push(r.attr_value);
    byKey.set(r.attr_key, list);
    byProduct.set(r.product_id, byKey);
  }
  const out = new Map();
  for (const [productId, byKey] of byProduct) {
    out.set(productId, [...byKey.entries()].map(([key, values]) => ({ key, values })));
  }
  return out;
}

async function loadRefs(rows) {
  if (!rows.length) return { brands: new Map(), categories: new Map() };
  const brandIds = [...new Set(rows.map((r) => r.brand_id).filter(Boolean))];
  const categoryIds = [...new Set(rows.map((r) => r.category_id).filter(Boolean))];
  const [brands, categories] = await Promise.all([
    brandIds.length ? Brand.findByIds(brandIds) : [],
    categoryIds.length ? Category.findByIds(categoryIds) : [],
  ]);
  return {
    brands: new Map(brands.map((b) => [b._id, { _id: b._id, name: b.name, slug: b.slug }])),
    categories: new Map(categories.map((c) => [c._id, { _id: c._id, name: c.name, slug: c.slug }])),
  };
}

function rowToProduct(row, { variants, attributes, brand, category } = {}) {
  if (!row) return null;
  const product = {
    _id: row.id,
    name: row.name,
    nameBn: row.name_bn,
    slug: row.slug,
    description: row.description,
    descriptionBn: row.description_bn,
    category: category ?? row.category_id,
    topCategory: row.top_category_id,
    brand: brand ?? row.brand_id,
    ageGroup: row.age_group,
    basePrice: Number(row.base_price),
    discountPrice: row.discount_price == null ? null : Number(row.discount_price),
    // Transitional BDT-migration flag — see sql/schema.sql's column
    // comment and docs/CURRENCY_MIGRATION_PLAN.md. 'USD' (the DB default)
    // for every not-yet-migrated product; callers computing a charge/
    // display price must check this before applying the exchange rate.
    priceCurrency: row.price_currency || "USD",
    images: jsonArray(row.images),
    variants: variants || [],
    attributes: attributes || [],
    measurements: {
      heightRange: row.measurement_height_range || "",
      chest: row.measurement_chest || "",
      sleeveLength: row.measurement_sleeve_length || "",
    },
    includedItems: jsonArray(row.included_items),
    availability: row.availability,
    tags: jsonArray(row.tags),
    rating: Number(row.rating || 0),
    numReviews: row.num_reviews,
    isFeatured: !!row.is_featured,
    isActive: !!row.is_active,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    metaKeywords: row.meta_keywords,
    ogImage: row.og_image,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  product.totalStock = product.variants.reduce((sum, v) => sum + (v.stock || 0), 0);
  attachInstanceMethods(product);
  return product;
}

function attachInstanceMethods(product) {
  product.save = async function save() {
    return saveProduct(this);
  };
}

async function hydrate(rows, { populate = true } = {}) {
  const ids = rows.map((r) => r.id);
  const [variantsMap, attributesMap, refs] = await Promise.all([
    loadVariants(ids),
    loadAttributes(ids),
    populate ? loadRefs(rows) : { brands: new Map(), categories: new Map() },
  ]);
  return rows.map((row) =>
    rowToProduct(row, {
      variants: variantsMap.get(row.id) || [],
      attributes: attributesMap.get(row.id) || [],
      brand: row.brand_id ? refs.brands.get(row.brand_id) || row.brand_id : null,
      category: refs.categories.get(row.category_id) || row.category_id,
    }),
  );
}

async function findById(id) {
  if (!id) return null;
  const rows = await query("SELECT * FROM products WHERE id = ?", [id]);
  if (!rows.length) return null;
  return (await hydrate(rows))[0];
}

/** Exact-name lookup — used only by scripts/seedCatalog.mjs's upsert-by-name seeding. */
async function findByName(name) {
  const rows = await query("SELECT * FROM products WHERE name = ?", [name]);
  if (!rows.length) return null;
  return (await hydrate(rows))[0];
}

async function findBySlug(slug) {
  const rows = await query("SELECT * FROM products WHERE slug = ?", [slug]);
  if (!rows.length) return null;
  return (await hydrate(rows))[0];
}

async function findByIdOrSlug(idOrSlug, isId) {
  return isId ? findById(idOrSlug) : findBySlug(idOrSlug);
}

async function findByIds(ids, { activeOnly = false } = {}) {
  if (!ids.length) return [];
  const activeClause = activeOnly ? " AND is_active = 1" : "";
  const rows = await query(
    `SELECT * FROM products WHERE id IN (${ids.map(() => "?").join(",")})${activeClause}`,
    ids,
  );
  return hydrate(rows);
}

/**
 * List query — `whereSql`/`params` is a raw SQL fragment built by
 * services/productService.js's buildFilter(). `sort` is an array of
 * `{ column, dir }` (already validated against the sort allowlist there).
 */
async function findByFilter(whereSql, params, { sort = [{ column: "created_at", dir: "DESC" }], skip = 0, limit = 12 } = {}) {
  const orderBy = sort.map((s) => `${s.column} ${s.dir}`).join(", ") || "created_at DESC";
  const rows = await query(
    `SELECT * FROM products WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(skip)],
  );
  return hydrate(rows);
}

async function countByFilter(whereSql, params) {
  const rows = await query(`SELECT COUNT(*) AS n FROM products WHERE ${whereSql}`, params);
  return rows[0].n;
}

/** GROUP BY helper for facet counts (replaces Mongo $group aggregations). */
async function groupCountByFilter(column, whereSql, params) {
  return query(`SELECT ${column} AS grp, COUNT(*) AS count FROM products WHERE ${whereSql} GROUP BY ${column}`, params);
}

async function distinctBrandIds(whereSql, params) {
  const rows = await query(
    `SELECT DISTINCT brand_id FROM products WHERE ${whereSql} AND brand_id IS NOT NULL`,
    params,
  );
  return rows.map((r) => r.brand_id);
}

/** Narrow projection for app/sitemap.js — only slug + updatedAt, active products only. */
async function findSitemapEntries() {
  const rows = await query("SELECT id, slug, updated_at FROM products WHERE is_active = 1");
  return rows.map((r) => ({ _id: r.id, slug: r.slug, updatedAt: r.updated_at }));
}

async function countActiveByCategory(categoryId) {
  const rows = await query("SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND is_active = 1", [categoryId]);
  return rows[0].n;
}

async function findVariantClash(skus, excludeProductId) {
  const ph = skus.map(() => "?").join(",");
  const excludeClause = excludeProductId ? "AND pv.product_id != ?" : "";
  const params = excludeProductId ? [...skus, excludeProductId] : skus;
  const rows = await query(
    `SELECT pv.sku FROM product_variants pv WHERE pv.sku IN (${ph}) ${excludeClause} LIMIT 1`,
    params,
  );
  return rows[0]?.sku || null;
}

const dedupe = (arr) => [...new Set(arr.filter((v) => v != null && v !== ""))];

function buildSlug(name, id) {
  return `${slugify(name, { lower: true, strict: true })}-${id.slice(-6)}`;
}

/** Recomputes denormalized topCategory + attribute facets — the SQL port of the old pre-validate hook. */
async function resolveDerivedFields(data) {
  const category = await Category.findById(data.category);
  const topCategory = category?.parent ?? category?._id ?? data.category;

  const defs = await AttributeDefinition.findDerivedFromVariant();
  const topCategoryId = topCategory ? String(topCategory) : null;
  const applicableDefs = defs.filter(
    (d) => !d.appliesToCategories?.length || d.appliesToCategories.some((c) => String(c) === topCategoryId),
  );
  const derived = {};
  for (const { key } of applicableDefs) {
    derived[key] = dedupe((data.variants || []).map((v) => v.attributes?.[key]));
  }
  const byKey = new Map((data.attributes || []).map((a) => [a.key, a.values]));
  for (const [key, values] of Object.entries(derived)) {
    if (values.length) byKey.set(key, values);
  }
  const attributes = [...byKey.entries()].map(([key, values]) => ({ key, values }));
  return { topCategory, attributes };
}

async function writeVariantsAndAttributes(conn, productId, product) {
  await conn.query("DELETE FROM product_variants WHERE product_id = ?", [productId]);
  await conn.query("DELETE FROM product_attributes WHERE product_id = ?", [productId]);

  const variants = product.variants || [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    await conn.query(
      `INSERT INTO product_variants (id, product_id, variant_name, sku, attributes, price, discount_price, stock, images, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        v._id || generateObjectId(),
        productId,
        v.variantName,
        v.sku,
        JSON.stringify(v.attributes || {}),
        v.price ?? null,
        v.discountPrice ?? null,
        v.stock || 0,
        JSON.stringify(v.images || []),
        i,
      ],
    );
  }

  let pos = 0;
  for (const a of product.attributes || []) {
    for (const value of a.values || []) {
      await conn.query(
        "INSERT INTO product_attributes (product_id, attr_key, attr_value, position) VALUES (?, ?, ?, ?)",
        [productId, a.key, value, pos++],
      );
    }
  }
}

function tagsText(tags) {
  return (tags || []).join(" ");
}

async function saveProduct(product) {
  const derived = await resolveDerivedFields(product);
  product.topCategory = derived.topCategory;
  product.attributes = derived.attributes;
  product.slug = buildSlug(product.name, product._id);

  await withConnection(async (conn) => {
    await conn.query(
      `UPDATE products SET
         name=?, name_bn=?, slug=?, description=?, description_bn=?, category_id=?, top_category_id=?,
         brand_id=?, age_group=?, base_price=?, discount_price=?, images=?, measurement_height_range=?,
         measurement_chest=?, measurement_sleeve_length=?, included_items=?, availability=?, tags=?,
         tags_text=?, is_featured=?, is_active=?, meta_title=?, meta_description=?, meta_keywords=?, og_image=?
       WHERE id=?`,
      [
        product.name,
        product.nameBn || "",
        product.slug,
        product.description,
        product.descriptionBn || "",
        typeof product.category === "object" ? product.category._id : product.category,
        product.topCategory,
        product.brand ? (typeof product.brand === "object" ? product.brand._id : product.brand) : null,
        product.ageGroup || "adult",
        product.basePrice,
        product.discountPrice ?? null,
        JSON.stringify(product.images || []),
        product.measurements?.heightRange || "",
        product.measurements?.chest || "",
        product.measurements?.sleeveLength || "",
        JSON.stringify(product.includedItems || []),
        product.availability || "readyStock",
        JSON.stringify(product.tags || []),
        tagsText(product.tags),
        product.isFeatured ? 1 : 0,
        product.isActive === false ? 0 : 1,
        product.metaTitle || "",
        product.metaDescription || "",
        product.metaKeywords || "",
        product.ogImage || "",
        product._id,
      ],
    );
    await writeVariantsAndAttributes(conn, product._id, product);
  });
  return findById(product._id);
}

async function create(data) {
  const id = generateObjectId();
  const draft = { ...data, _id: id, variants: data.variants || [], attributes: data.attributes || [] };
  const derived = await resolveDerivedFields(draft);
  const slug = buildSlug(draft.name, id);

  await withConnection(async (conn) => {
    await conn.query(
      `INSERT INTO products
         (id, name, name_bn, slug, description, description_bn, category_id, top_category_id, brand_id,
          age_group, base_price, discount_price, price_currency, images, measurement_height_range, measurement_chest,
          measurement_sleeve_length, included_items, availability, tags, tags_text, rating, num_reviews,
          is_featured, is_active, meta_title, meta_description, meta_keywords, og_image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        draft.name,
        draft.nameBn || "",
        slug,
        draft.description,
        draft.descriptionBn || "",
        draft.category,
        derived.topCategory,
        draft.brand || null,
        draft.ageGroup || "adult",
        draft.basePrice,
        draft.discountPrice ?? null,
        // Explicit, not left to the schema DEFAULT — this store is
        // BDT-only (see docs/CURRENCY_MIGRATION_PLAN.md); any caller that
        // still needs to create a legacy USD row (there should be none
        // going forward) must pass priceCurrency: "USD" explicitly.
        draft.priceCurrency === "USD" ? "USD" : "BDT",
        JSON.stringify(draft.images || []),
        draft.measurements?.heightRange || "",
        draft.measurements?.chest || "",
        draft.measurements?.sleeveLength || "",
        JSON.stringify(draft.includedItems || []),
        draft.availability || "readyStock",
        JSON.stringify(draft.tags || []),
        tagsText(draft.tags),
        // Real admin-facing creation never sets these (rating/numReviews
        // are always recalculated from actual reviews — see
        // recalcProductRating() in reviewModel.js), but test fixtures
        // legitimately need to seed an already-rated product — see the
        // identical usedCount precedent in models/couponModel.js.
        draft.rating ?? 0,
        draft.numReviews ?? 0,
        draft.isFeatured ? 1 : 0,
        draft.isActive === false ? 0 : 1,
        draft.metaTitle || "",
        draft.metaDescription || "",
        draft.metaKeywords || "",
        draft.ogImage || "",
      ],
    );
    await writeVariantsAndAttributes(conn, id, { variants: draft.variants, attributes: derived.attributes });
  });
  return findById(id);
}

/** Atomic, guarded stock decrement inside an order-creation transaction — see services/orderService.js. Returns true if the row matched (enough stock) and was decremented. */
async function decrementVariantStock(conn, productId, variantId, qty) {
  const [result] = await conn.query(
    "UPDATE product_variants SET stock = stock - ? WHERE id = ? AND product_id = ? AND stock >= ?",
    [qty, variantId, productId, qty],
  );
  return result.affectedRows === 1;
}

/** Restores stock on order cancellation — non-guarded (always succeeds), mirrors the old $inc. */
async function incrementVariantStock(conn, productId, variantId, qty) {
  await conn.query(
    "UPDATE product_variants SET stock = stock + ? WHERE id = ? AND product_id = ?",
    [qty, variantId, productId],
  );
}

/** Reads a single variant's current stock/name — used by the post-order low-stock check. */
async function findVariantForLowStockCheck(productId, variantId) {
  const rows = await query(
    "SELECT p.name AS product_name, pv.variant_name, pv.stock FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = ? AND pv.product_id = ?",
    [variantId, productId],
  );
  return rows[0] || null;
}

const Product = {
  findById,
  findByName,
  findBySlug,
  findByIdOrSlug,
  findByIds,
  findByFilter,
  countByFilter,
  groupCountByFilter,
  distinctBrandIds,
  countActiveByCategory,
  findSitemapEntries,
  findVariantClash,
  create,
  decrementVariantStock,
  incrementVariantStock,
  findVariantForLowStockCheck,
};

export default Product;
