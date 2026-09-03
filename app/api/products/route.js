import { NextResponse } from "next/server";

import { getSessionUser, requireAdmin } from "../../../lib/auth.js";
import { listProducts, createProduct } from "../../../services/productService.js";
import { withRoute } from "../../../lib/http.js";

export const GET = withRoute(async (request) => {
  const user = await getSessionUser(request).catch(() => null);
  const { searchParams } = new URL(request.url);
  const query = Object.fromEntries(searchParams.entries());

  const result = await listProducts(query, { isAdmin: user?.role === "admin" });
  return NextResponse.json({ success: true, ...result });
});

export const POST = withRoute(async (request) => {
  await requireAdmin(request);
  const body = await request.json();
  const product = await createProduct(body);
  return NextResponse.json({ success: true, product }, { status: 201 });
});
