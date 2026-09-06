import { NextResponse } from "next/server";

import { requirePermission } from "../../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../../lib/permissions.js";
import { activateTheme } from "../../../../../services/themeService.js";
import { withRoute } from "../../../../../lib/http.js";
import { invalidateCacheTags } from "../../../../../lib/cacheInvalidation.js";
import { CACHE_TAGS } from "../../../../../lib/cacheTags.js";

export const POST = withRoute(async (request, { params }) => {
  const admin = await requirePermission(request, PERMISSIONS.THEMES_MANAGE);
  const { id } = await params;
  const theme = await activateTheme(id, admin._id);
  invalidateCacheTags([CACHE_TAGS.PUBLIC_THEME]);
  return NextResponse.json({ success: true, theme });
});
