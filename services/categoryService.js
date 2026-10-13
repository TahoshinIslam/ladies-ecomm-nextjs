import Category from "../models/categoryModel.js";
import Product from "../models/productModel.js";
import AttributeDefinition from "../models/attributeDefinitionModel.js";
import { resetStorefrontScopeCache } from "./storefrontScopeService.js";
import { HttpError } from "../lib/http.js";
import { isObjectIdFormat, requireObjectIdFormat } from "../lib/validation.js";

const WRITABLE_FIELDS = ["name", "nameBn", "parent", "image", "description", "descriptionBn", "sortOrder", "isActive"];

const pickWritable = (body) => {
  const out = {};
  for (const key of WRITABLE_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
};

// Categories nest as deep as the shop needs (Food -> Snacks -> Biscuits -> Milk Biscuits -> ...). The only limits are the ones that
// protect the tree itself: the parent must exist, a category cannot sit under itself or under one of its own descendants (that would cut
// both off from the root), and a very large depth is refused as a safety bound against a runaway loop, not as a product rule. A missing
// `parent` defaults to null (a new root category).
export const MAX_CATEGORY_DEPTH = 32;

async function validateParent(parentId, categoryId = null) {
  if (!parentId) return null;
  if (!isObjectIdFormat(parentId)) throw new HttpError(400, "Invalid parent category id");
  const parent = await Category.findById(parentId);
  if (!parent) throw new HttpError(400, "Parent category not found");

  // Walk up from the proposed parent: meeting the category itself means the move would make it its own ancestor.
  let cursor = parent;
  let hops = 0;
  while (cursor) {
    if (categoryId && String(cursor._id) === String(categoryId)) {
      throw new HttpError(400, "A category cannot be moved under itself or one of its own subcategories");
    }
    hops += 1;
    if (hops > MAX_CATEGORY_DEPTH) throw new HttpError(400, `Categories can nest ${MAX_CATEGORY_DEPTH} levels deep at most`);
    cursor = cursor.parent ? await Category.findById(cursor.parent) : null;
  }
  return parent._id;
}

// A category with no children is a real, product-bearing leaf/style.
// Shared by resolveLeafCategory/listGroupings in productService.js instead
// of each re-deriving "is this a leaf" from `!category.parent`, which only
// meant "is a leaf" back when the tree was exactly 2 levels deep.
export async function isLeafCategory(categoryId) {
  return !(await Category.existsWithParent(categoryId));
}

export async function listCategories() {
  return Category.findAll();
}

export async function createCategory(body) {
  const data = pickWritable(body);
  data.parent = await validateParent(data.parent);
  const category = await Category.create(data);
  // A new department is storefront-visible immediately: drop the (short-lived)
  // cached visibility set so the very next listing includes it.
  resetStorefrontScopeCache();
  return category;
}

export async function updateCategory(id, body) {
  requireObjectIdFormat(id, "id");
  const category = await Category.findById(id);
  if (!category) throw new HttpError(404, "Category not found");

  const data = pickWritable(body);
  if (data.parent !== undefined) {
    if (String(data.parent) === String(id)) {
      throw new HttpError(400, "A category cannot be its own parent");
    }
    data.parent = await validateParent(data.parent, id);
  }
  Object.assign(category, data);
  await category.save();
  // Activating/deactivating/moving a category changes what is visible.
  resetStorefrontScopeCache();
  return category;
}


