import { NextResponse } from "next/server";

import { getSessionUser } from "../../../../lib/auth.js";
import { previewOrder } from "../../../../services/orderService.js";
import { withRoute } from "../../../../lib/http.js";
import { parseJsonBody } from "../../../../lib/validation.js";
import { previewOrderSchema } from "../../../../schemas/orderSchemas.js";

// Guests can preview totals too (matches CheckoutPage.jsx letting guests
// browse checkout) — only placing the order itself requires login.
export const POST = withRoute(async (request) => {
  const user = await getSessionUser(request).catch(() => null);
  const body = await parseJsonBody(request, previewOrderSchema);
  const preview = await previewOrder(user?._id, body);
  return NextResponse.json({ success: true, preview });
});
