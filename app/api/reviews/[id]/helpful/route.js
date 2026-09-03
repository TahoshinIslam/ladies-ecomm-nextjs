import { NextResponse } from "next/server";

import { requireUser } from "../../../../../lib/auth.js";
import { markHelpful } from "../../../../../services/reviewService.js";
import { withRoute } from "../../../../../lib/http.js";

export const POST = withRoute(async (request, { params }) => {
  await requireUser(request);
  const { id } = await params;
  const helpfulCount = await markHelpful(id);
  return NextResponse.json({ success: true, helpfulCount });
});
