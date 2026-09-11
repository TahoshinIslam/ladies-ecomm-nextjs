import { NextResponse } from "next/server";

import { getSessionUser, requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { createAttribute } from "../../../services/attributeService.js";
import { withRoute } from "../../../lib/http.js";
import { getServerLocale } from "../../../lib/i18n/server.js";
import { localizeAttributeDefinitionList } from "../../../lib/i18n/localize.js";
import { parseJsonBody, requireObjectIdFormat } from "../../../lib/validation.js";
import { createAttributeSchema } from "../../../schemas/catalogSchemas.js";
import { invalidateCacheTags } from "../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../lib/cacheTags.js";
import { getCachedAllAttributes, getCachedAttributesForCategory } from "../../../lib/serverDataCache.js";

// GET /api/attributes           -> full raw list (Attributes admin page —
//                                   never localized, the admin form needs
//                                   both label/labelBn to edit them)
// GET /api/attributes?category= -> filtered + label-resolved for that
//                                   top-level category id. Two real
//                                   consumers share this: the admin
//                                   product form's Step 2 (needs raw
//                                   English labels to edit reliably) and
//                                   the storefront filter panel/PDP (needs
//                                   the locale-resolved label). Admin
//                                   requests are detected the same way as
//                                   app/api/products/route.js and always
//                                   get the raw, unlocalized list — see
//                                   that file's comment for why silently
//                                   localizing here would risk an admin
//                                   re-saving labelBn over the real label.
export const GET = withRoute(async (request) => {
  const category = new URL(request.url).searchParams.get("category");
  if (!category) {
    const attributes = await getCachedAllAttributes();
    return NextResponse.json({ attributes });
  }
  requireObjectIdFormat(category, "category");
  const user = await getSessionUser(request).catch(() => null);
  const isAdmin = user?.role === "admin";
  const [attributes, locale] = await Promise.all([
    getCachedAttributesForCategory(category),
    getServerLocale(),
  ]);
  return NextResponse.json({
    attributes: isAdmin ? attributes : localizeAttributeDefinitionList(attributes, locale),
  });
});

export const POST = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.CATEGORIES_MANAGE);
  const body = await parseJsonBody(request, createAttributeSchema);
  const attribute = await createAttribute(body);
  invalidateCacheTags([CACHE_TAGS.ATTRIBUTES, CACHE_TAGS.CATALOG]);
  return NextResponse.json({ success: true, attribute }, { status: 201 });
});
