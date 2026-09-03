import { NextResponse } from "next/server";

import { getActiveTheme } from "../../../../services/themeService.js";
import { withRoute } from "../../../../lib/http.js";

export const GET = withRoute(async () => {
  const theme = await getActiveTheme();
  return NextResponse.json({ theme });
});
