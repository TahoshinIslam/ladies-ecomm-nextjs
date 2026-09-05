import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { getTheme, updateTheme, deleteTheme } from "../../../../services/themeService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseJsonBody } from "../../../../lib/validation.js";
import { updateThemeSchema } from "../../../../schemas/adminSchemas.js";
import { invalidateCacheTags } from "../../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../../lib/cacheTags.js";

export const GET = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.THEMES_MANAGE);
  const { id } = await params;
  const theme = await getTheme(id);
  return NextResponse.json({ success: true, theme });
});

export const PUT = withRoute(async (request, { params }) => {
  const admin = await requirePermission(request, PERMISSIONS.THEMES_MANAGE);
  const { id } = await params;
  const body = await parseJsonBody(request, updateThemeSchema);
  const theme = await updateTheme(id, body, admin._id);
  // Broad invalidation — we can't cheaply tell here whether `id` is the
  // currently active theme, and a stale-but-inactive theme's cache
  // entry costs nothing to also refresh.
  invalidateCacheTags([CACHE_TAGS.PUBLIC_THEME]);
  return NextResponse.json({ success: true, theme });
});

export const DELETE = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.THEMES_MANAGE);
  const { id } = await params;
  await deleteTheme(id);
  invalidateCacheTags([CACHE_TAGS.PUBLIC_THEME]);
  return NextResponse.json({ success: true, message: "Theme deleted" });
});
