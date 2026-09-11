import { NextResponse } from "next/server";

import { getSessionUser, requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { createCategory } from "../../../services/categoryService.js";
import { getCachedCategories } from "../../../lib/serverDataCache.js";
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
  // Cached (900s TTL, invalidated on any category create/update/delete
  // below and in [id]/route.js) — this is the storefront's own nav/filter
  // read, fired on every single page load, previously hitting MongoDB
  // fresh every time despite being public, rarely-changing data with the
  // exact same cache infrastructure the home page's server render already
  // uses for this identical read.
  const [categories, locale] = await Promise.all([getCachedCategories(), getServerLocale()]);
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
