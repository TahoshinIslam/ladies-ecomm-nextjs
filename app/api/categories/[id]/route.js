import { NextResponse } from "next/server";

import { requireAdmin } from "../../../../lib/auth.js";
import { updateCategory, deleteCategory } from "../../../../services/categoryService.js";
import { withRoute } from "../../../../lib/http.js";

export const PUT = withRoute(async (request, { params }) => {
  await requireAdmin(request);
  const { id } = await params;
  const body = await request.json();
  const category = await updateCategory(id, body);
  return NextResponse.json({ success: true, category });
});

export const DELETE = withRoute(async (request, { params }) => {
  await requireAdmin(request);
  const { id } = await params;
  await deleteCategory(id);
  return NextResponse.json({ success: true, message: "Category deleted" });
});
