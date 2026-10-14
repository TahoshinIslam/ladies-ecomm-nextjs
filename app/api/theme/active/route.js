import { NextResponse } from "next/server";

import { getCachedActiveTheme } from "../../../../lib/serverDataCache.js";
import { withRoute } from "../../../../lib/http.js";

// Same reasoning as GET /api/settings/public: fetched on every
// page load client-side (ThemeProvider), now served from the shared
// cache (900s TTL + invalidation on theme update/activate/delete).
export const GET = withRoute(async () => {
  const theme = await getCachedActiveTheme();
  return NextResponse.json({ theme });
});
