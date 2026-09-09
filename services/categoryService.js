import Category from "../models/categoryModel.js";
import Product from "../models/productModel.js";
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

// Keeps the tree at most 3 levels: division (parent: null, e.g. Clothes) ->
// department (e.g. Burqa, or a root like Cosmetics that IS a department) ->
// style/leaf. A category can be used as a parent as long as ITS OWN parent
// chain is at most 1 deep already — i.e. rejects only a 4th level. A
// missing `parent` defaults to null (a new root category) — this is what
// lets the existing, unmodified CategoriesPage.jsx form (which has no
// parent field) still create valid root categories.
async function validateParent(parentId) {
  if (!parentId) return null;
  if (!isObjectIdFormat(parentId)) throw new HttpError(400, "Invalid parent category id");
  const parent = await Category.findById(parentId).lean();
  if (!parent) throw new HttpError(400, "Parent category not found");
  if (parent.parent) {
    const grandparent = await Category.findById(parent.parent).select("parent").lean();
    if (grandparent?.parent) {
      throw new HttpError(400, "Categories can only be nested up to 3 levels deep (division -> department -> style)");
    }
  }
  return parent._id;
}

// A category with no children is a real, product-bearing leaf/style.
// Shared by resolveLeafCategory/listGroupings in productService.js instead
// of each re-deriving "is this a leaf" from `!category.parent`, which only
// meant "is a leaf" back when the tree was exactly 2 levels deep.
export async function isLeafCategory(categoryId) {
  return !(await Category.exists({ parent: categoryId }));
}

export async function listCategories() {
  const categories = await Category.find().sort("sortOrder name");
  return categories;
}

export async function createCategory(body) {
  const data = pickWritable(body);
  data.parent = await validateParent(data.parent);
  const category = await Category.create(data);
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
    data.parent = await validateParent(data.parent);
  }
  Object.assign(category, data);
  await category.save();
  return category;
}

export async function deleteCategory(id) {
  requireObjectIdFormat(id, "id");
  const category = await Category.findById(id);
  if (!category) throw new HttpError(404, "Category not found");

  const childCount = await Category.countDocuments({ parent: id });
  if (childCount > 0) {
    throw new HttpError(400, `Cannot delete: ${childCount} subcategor${childCount > 1 ? "ies" : "y"} under this category. Reassign or delete them first.`);
  }
  const productCount = await Product.countDocuments({ category: id });
  if (productCount > 0) {
    throw new HttpError(400, `Cannot delete: ${productCount} product${productCount > 1 ? "s" : ""} use this category. Reassign them first.`);
  }
  await category.deleteOne();
}
