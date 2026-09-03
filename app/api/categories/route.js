import { NextResponse } from "next/server";

import { requireAdmin } from "../../../lib/auth.js";
import { listCategories, createCategory } from "../../../services/categoryService.js";
import { withRoute } from "../../../lib/http.js";

export const GET = withRoute(async () => {
  const categories = await listCategories();
  return NextResponse.json({ categories });
});

export const POST = withRoute(async (request) => {
  await requireAdmin(request);
  const body = await request.json();
  const category = await createCategory(body);
  return NextResponse.json({ success: true, category }, { status: 201 });
});
