import { NextResponse } from "next/server";

import { requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { getAllThemes, createTheme } from "../../../services/themeService.js";
import { withRoute } from "../../../lib/http.js";
import { parseJsonBody } from "../../../lib/validation.js";
import { createThemeSchema } from "../../../schemas/adminSchemas.js";

export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.THEMES_MANAGE);
  const themes = await getAllThemes();
  return NextResponse.json({ success: true, count: themes.length, themes });
});

export const POST = withRoute(async (request) => {
  const admin = await requirePermission(request, PERMISSIONS.THEMES_MANAGE);
  const body = await parseJsonBody(request, createThemeSchema);
  const theme = await createTheme(body, admin._id);
  return NextResponse.json({ success: true, theme }, { status: 201 });
});
