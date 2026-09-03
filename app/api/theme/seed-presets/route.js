import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { seedPresets } from "../../../../services/themeService.js";
import { withRoute } from "../../../../lib/http.js";

export const POST = withRoute(async (request) => {
  const admin = await requirePermission(request, PERMISSIONS.THEMES_MANAGE);
  const created = await seedPresets(admin._id);
  return NextResponse.json({ success: true, created: created.length, themes: created }, { status: 201 });
});
