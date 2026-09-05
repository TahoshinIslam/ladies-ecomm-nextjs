import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { getTheme, updateTheme, deleteTheme } from "../../../../services/themeService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseJsonBody } from "../../../../lib/validation.js";
import { updateThemeSchema } from "../../../../schemas/adminSchemas.js";

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
  return NextResponse.json({ success: true, theme });
});

export const DELETE = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.THEMES_MANAGE);
  const { id } = await params;
  await deleteTheme(id);
  return NextResponse.json({ success: true, message: "Theme deleted" });
});
