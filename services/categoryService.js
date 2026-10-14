import Category from "../models/categoryModel.js";

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

