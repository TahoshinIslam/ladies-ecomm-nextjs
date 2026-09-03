import { NextResponse } from "next/server";

import { requirePermission } from "../../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../../lib/permissions.js";
import { activateTheme } from "../../../../../services/themeService.js";
import { withRoute } from "../../../../../lib/http.js";

export const POST = withRoute(async (request, { params }) => {
  const admin = await requirePermission(request, PERMISSIONS.THEMES_MANAGE);
  const { id } = await params;
  const theme = await activateTheme(id, admin._id);
  return NextResponse.json({ success: true, theme });
});
