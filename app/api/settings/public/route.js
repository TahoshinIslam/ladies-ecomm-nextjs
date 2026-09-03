import { NextResponse } from "next/server";

import { getPublicSettings } from "../../../../services/settingsService.js";
import { withRoute } from "../../../../lib/http.js";

export const GET = withRoute(async () => {
  const settings = await getPublicSettings();
  return NextResponse.json({ settings });
});
