import { NextResponse } from "next/server";

import { verifyEmail } from "../../../../../services/userService.js";
import { withRoute } from "../../../../../lib/http.js";

export const GET = withRoute(async (request, { params }) => {
  const { token } = await params;
  const result = await verifyEmail(token);
  return NextResponse.json({ success: true, ...result });
});
