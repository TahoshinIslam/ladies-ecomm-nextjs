import { NextResponse } from "next/server";

import { listGroupings } from "../../../../services/productService.js";
import { withRoute } from "../../../../lib/http.js";
import { getServerLocale } from "../../../../lib/i18n/server.js";
import { localizeCategoryList } from "../../../../lib/i18n/localize.js";

// Sneaker-era "distinct model names" endpoint, repurposed: returns product
// groupings by category (departments, or that department's subcategories
// when ?category= is given), each with a live product count. Its previous
// only consumer (ShopPage.jsx's "Model" filter) was removed — model names
// don't exist in the modest-fashion schema — but the endpoint itself stays
// real and Mongo-backed for whatever consumes category groupings next.
export const GET = withRoute(async (request) => {
  const category = new URL(request.url).searchParams.get("category");
  const [groupings, locale] = await Promise.all([
    listGroupings(category || undefined),
    getServerLocale(),
  ]);
  return NextResponse.json({ success: true, groupings: localizeCategoryList(groupings, locale) });
});
