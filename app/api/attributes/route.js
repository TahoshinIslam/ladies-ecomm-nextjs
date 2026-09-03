import { NextResponse } from "next/server";

import { requireAdmin } from "../../../lib/auth.js";
import {
  listAttributes,
  resolveAttributesForCategory,
  createAttribute,
} from "../../../services/attributeService.js";
import { withRoute } from "../../../lib/http.js";

// GET /api/attributes           -> full raw list (Attributes admin page)
// GET /api/attributes?category= -> filtered + label-resolved for that
//                                   top-level category id (product form
//                                   Step 2 now; storefront filter panel in
//                                   Phase 3 — same resolver, same route)
export const GET = withRoute(async (request) => {
  const category = new URL(request.url).searchParams.get("category");
  const attributes = category
    ? await resolveAttributesForCategory(category)
    : await listAttributes();
  return NextResponse.json({ attributes });
});

export const POST = withRoute(async (request) => {
  await requireAdmin(request);
  const body = await request.json();
  const attribute = await createAttribute(body);
  return NextResponse.json({ success: true, attribute }, { status: 201 });
});
