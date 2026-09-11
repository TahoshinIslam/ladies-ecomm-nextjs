import { NextResponse } from "next/server";

import { withRoute } from "../../../lib/http.js";
import { getCachedBrands } from "../../../lib/serverDataCache.js";

export const GET = withRoute(async () => {
  const brands = await getCachedBrands();
  return NextResponse.json({ brands });
});
