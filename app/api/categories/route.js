import { NextResponse } from "next/server";

import { getSessionUser, requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { listCategories, createCategory } from "../../../services/categoryService.js";
import { withRoute } from "../../../lib/http.js";
import { getServerLocale } from "../../../lib/i18n/server.js";
import { localizeCategoryList } from "../../../lib/i18n/localize.js";
import { parseJsonBody } from "../../../lib/validation.js";
import { createCategorySchema } from "../../../schemas/catalogSchemas.js";
import { invalidateCacheTags } from "../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../lib/cacheTags.js";

// Shared by the storefront (department nav, filter chips) and the admin
// Categories/Products pages. Admin requests always get raw English +
// Bangla side by side, never locale-resolved — see the matching comment in
// app/api/products/route.js for why (an admin's own browser can easily
// have the Bangla cookie set, and localizing here would let them re-save
// nameBn over the real English name).
export const GET = withRoute(async (request) => {
  const user = await getSessionUser(request).catch(() => null);
  const isAdmin = user?.role === "admin";
  const [categories, locale] = await Promise.all([listCategories(), getServerLocale()]);
  return NextResponse.json({
    categories: isAdmin ? categories : localizeCategoryList(categories, locale),
  });
});

export const POST = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.CATEGORIES_MANAGE);
  const body = await parseJsonBody(request, createCategorySchema);
  const category = await createCategory(body);
  invalidateCacheTags([CACHE_TAGS.CATEGORIES, CACHE_TAGS.CATALOG]);
  return NextResponse.json({ success: true, category }, { status: 201 });
});
