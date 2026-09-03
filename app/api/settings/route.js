import { NextResponse } from "next/server";

import { requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { getSettings, updateSettings } from "../../../services/settingsService.js";
import { withRoute } from "../../../lib/http.js";

export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.SETTINGS_MANAGE);
  const settings = await getSettings();
  return NextResponse.json({ success: true, settings });
});

export const PUT = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.SETTINGS_MANAGE);
  const body = await request.json();
  const settings = await updateSettings(body);
  return NextResponse.json({ success: true, settings });
});
