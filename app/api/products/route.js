import { NextResponse } from "next/server";

import { getSessionUser, requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { listProducts, createProduct } from "../../../services/productService.js";
import { withRoute, parseQueryParams } from "../../../lib/http.js";
import { getServerLocale } from "../../../lib/i18n/server.js";
import { localizeProductList } from "../../../lib/i18n/localize.js";

export const GET = withRoute(async (request) => {
  const user = await getSessionUser(request).catch(() => null);
  const isAdmin = user?.role === "admin";
  const { searchParams } = new URL(request.url);
  const query = parseQueryParams(searchParams);

  const [result, locale] = await Promise.all([
    listProducts(query, { isAdmin }),
    getServerLocale(),
  ]);
  // Admin requests (the products admin table/edit form) always see raw
  // English + Bangla side by side, never a locale-resolved single value —
  // the admin's own browser may well have the Bangla cookie set (it's the
  // default for a first-time visitor), and silently substituting nameBn
  // into `name` here would let an admin re-save it as the English field,
  // corrupting real product data. Only the real storefront response is
  // ever locale-resolved.
  return NextResponse.json({
    success: true,
    ...result,
    products: isAdmin ? result.products : localizeProductList(result.products, locale),
  });
});

export const POST = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.PRODUCTS_MANAGE);
  const body = await request.json();
  const product = await createProduct(body);
  return NextResponse.json({ success: true, product }, { status: 201 });
});
