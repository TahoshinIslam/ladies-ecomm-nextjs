import { NextResponse } from "next/server";

import { getSessionUser } from "../../../../lib/auth.js";
import { previewOrder } from "../../../../services/orderService.js";
import { withRoute } from "../../../../lib/http.js";

// Guests can preview totals too (matches CheckoutPage.jsx letting guests
// browse checkout) — only placing the order itself requires login.
export const POST = withRoute(async (request) => {
  const user = await getSessionUser(request).catch(() => null);
  const body = await request.json();
  const preview = await previewOrder(user?._id, body);
  return NextResponse.json({ success: true, preview });
});
