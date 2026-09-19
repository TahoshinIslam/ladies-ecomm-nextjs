import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { updateCategory, deleteCategory } from "../../../../services/categoryService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseJsonBody } from "../../../../lib/validation.js";
import { updateCategorySchema } from "../../../../schemas/catalogSchemas.js";
import { invalidateCacheTags } from "../../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../../lib/cacheTags.js";

export const PUT = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.CATEGORIES_MANAGE);
  const { id } = await params;
  const body = await parseJsonBody(request, updateCategorySchema);
  const category = await updateCategory(id, body);
  invalidateCacheTags([CACHE_TAGS.CATEGORIES, CACHE_TAGS.CATALOG]);
  return NextResponse.json({ success: true, category });
});

export const DELETE = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.CATEGORIES_MANAGE);
  const { id } = await params;
  await deleteCategory(id);
  // ATTRIBUTES too: deleting a category also removes its attribute assignments.
  invalidateCacheTags([CACHE_TAGS.CATEGORIES, CACHE_TAGS.CATALOG, CACHE_TAGS.ATTRIBUTES]);
  return NextResponse.json({ success: true, message: "Category deleted" });
});
