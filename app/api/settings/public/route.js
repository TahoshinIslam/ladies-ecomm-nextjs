import { NextResponse } from "next/server";

import { getCachedPublicSettings } from "../../../../lib/serverDataCache.js";
import { withRoute } from "../../../../lib/http.js";

// Phase 8 — this endpoint is hit by every single page load (client-side
// SettingsContext), making it one of the highest-traffic reads in the
// app; now served from the shared cache (lib/serverDataCache.js, 900s TTL
// + invalidation on PUT /api/settings).
export const GET = withRoute(async () => {
  const settings = await getCachedPublicSettings();
  return NextResponse.json({ settings });
});
