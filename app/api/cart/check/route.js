import { NextResponse } from "next/server";

import { checkItems } from "../../../../services/cartService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseJsonBody } from "../../../../lib/validation.js";
import { cartCheckSchema } from "../../../../schemas/cartSchemas.js";

// Public, read-only: tells a shopper (guest or signed in) whether the items in
// their bag are still offered and in stock, against the store that currently
// supplies the website. Nothing is reserved and nothing is changed.
export const POST = withRoute(async (request) => {
  const { items } = await parseJsonBody(request, cartCheckSchema);
  const results = await checkItems(items);
  return NextResponse.json({ success: true, items: results });
});
