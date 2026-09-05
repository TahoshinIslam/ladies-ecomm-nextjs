import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { updateAttribute, deleteAttribute } from "../../../../services/attributeService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseJsonBody } from "../../../../lib/validation.js";
import { updateAttributeSchema } from "../../../../schemas/catalogSchemas.js";
import { invalidateCacheTags } from "../../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../../lib/cacheTags.js";

export const PUT = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.CATEGORIES_MANAGE);
  const { id } = await params;
  const body = await parseJsonBody(request, updateAttributeSchema);
  const attribute = await updateAttribute(id, body);
  // Option/label changes affect both the dedicated attribute cache and
  // any product-list read whose facet counts/labels depend on it.
  invalidateCacheTags([CACHE_TAGS.ATTRIBUTES, CACHE_TAGS.CATALOG]);
  return NextResponse.json({ success: true, attribute });
});

export const DELETE = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.CATEGORIES_MANAGE);
  const { id } = await params;
  await deleteAttribute(id);
  invalidateCacheTags([CACHE_TAGS.ATTRIBUTES, CACHE_TAGS.CATALOG]);
  return NextResponse.json({ success: true, message: "Attribute deleted" });
});
