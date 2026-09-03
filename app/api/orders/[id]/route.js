import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/auth.js";
import { getOrder } from "../../../../services/orderService.js";
import { withRoute } from "../../../../lib/http.js";

// Route params are async in Next.js 16 and must be awaited.
export const GET = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { id } = await params;
  const order = await getOrder(user._id, user.role, id);
  return NextResponse.json({ success: true, order });
});
