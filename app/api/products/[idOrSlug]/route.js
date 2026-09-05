import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import {
  getProductByIdOrSlug,
  updateProduct,
  deleteProduct,
} from "../../../../services/productService.js";
import { withRoute } from "../../../../lib/http.js";
import { getServerLocale } from "../../../../lib/i18n/server.js";
import { localizeProduct } from "../../../../lib/i18n/localize.js";
import { parseJsonBody } from "../../../../lib/validation.js";
import { updateProductSchema } from "../../../../schemas/catalogSchemas.js";
import { invalidateCacheTags } from "../../../../lib/cacheInvalidation.js";
import { CACHE_TAGS, productTag } from "../../../../lib/cacheTags.js";

// Route params are async in Next.js 16 and must be awaited.
export const GET = withRoute(async (request, { params }) => {
  const { idOrSlug } = await params;
  const [product, locale] = await Promise.all([getProductByIdOrSlug(idOrSlug), getServerLocale()]);
  return NextResponse.json({ success: true, product: localizeProduct(product, locale) });
});

export const PUT = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.PRODUCTS_MANAGE);
  const { idOrSlug } = await params;
  const body = await parseJsonBody(request, updateProductSchema);
  const product = await updateProduct(idOrSlug, body);
  // updateProduct() requires a real ObjectId (never a slug) — see its own
  // requireObjectIdFormat() call, already passed by the time we're here.
  // Price/discount/stock/images/variants/attributes/activation can all
  // change through this one route, so every cached read that could be
  // showing this product (by id OR by slug — the broad CATALOG tag
  // covers slug-keyed lookups a specific product:<id> tag can't reach)
  // is invalidated.
  invalidateCacheTags([CACHE_TAGS.CATALOG, productTag(idOrSlug)]);
  return NextResponse.json({ success: true, product });
});

export const DELETE = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.PRODUCTS_MANAGE);
  const { idOrSlug } = await params;
  await deleteProduct(idOrSlug);
  // Deactivation must not leave a stale, still-"active" cached copy
  // publicly visible.
  invalidateCacheTags([CACHE_TAGS.CATALOG, productTag(idOrSlug)]);
  return NextResponse.json({ success: true, message: "Product deactivated" });
});
