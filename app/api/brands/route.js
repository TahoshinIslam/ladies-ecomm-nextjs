import { NextResponse } from "next/server";

import { withRoute } from "../../../lib/http.js";
import { getCachedBrands } from "../../../lib/serverDataCache.js";
import { listBrandsForCategory } from "../../../services/productService.js";
import { serializeForClient } from "../../../lib/serialize.js";

// `?category=<id>` scopes the brand list to whichever category is
// currently being browsed (see listBrandsForCategory()'s own comment) —
// used by the storefront's Brand filter facet. With no `category`, this
// keeps its original behavior (every active brand, cached) — the admin
// product form's brand dropdown relies on that unscoped shape to let an
// admin assign any brand to any product regardless of category. withRoute()
// already connects to the DB before this handler runs.
export const GET = withRoute(async (request) => {
  const category = new URL(request.url).searchParams.get("category");
  if (!category) {
    const brands = await getCachedBrands();
    return NextResponse.json({ brands });
  }
  const brands = serializeForClient(await listBrandsForCategory(category));
  return NextResponse.json({ brands });
});
