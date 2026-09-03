import { NextResponse } from "next/server";

import { listGroupings } from "../../../../services/productService.js";
import { withRoute } from "../../../../lib/http.js";

// Sneaker-era "distinct model names" endpoint, repurposed: returns product
// groupings by category (departments, or that department's subcategories
// when ?category= is given), each with a live product count. Its previous
// only consumer (ShopPage.jsx's "Model" filter) was removed — model names
// don't exist in the modest-fashion schema — but the endpoint itself stays
// real and Mongo-backed for whatever consumes category groupings next.
export const GET = withRoute(async (request) => {
  const category = new URL(request.url).searchParams.get("category");
  const groupings = await listGroupings(category || undefined);
  return NextResponse.json({ success: true, groupings });
});
