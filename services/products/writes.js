import Product from "../../models/productModel.js";
import Category from "../../models/categoryModel.js";
import AttributeDefinition from "../../models/attributeDefinitionModel.js";
import { HttpError } from "../../lib/http.js";
import { isDuplicateKeyError } from "../../lib/idempotency.js";
import { pruneFramingList as pruneFramingListToUrls } from "../../lib/imageFraming.js";
import { emitAdminEvent, emitBestEffort } from "../../lib/events.js";
import { requireObjectIdFormat, isObjectIdFormat } from "../../lib/validation.js";
import { isLeafCategory } from "../categoryService.js";
import { resolveAttributesForCategory } from "../attributeService.js";

/** Creating, updating and deleting products, with their validation. */
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
