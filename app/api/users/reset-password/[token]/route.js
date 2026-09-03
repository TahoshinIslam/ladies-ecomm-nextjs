import { NextResponse } from "next/server";

import { resetPassword } from "../../../../../services/userService.js";
import { withRoute } from "../../../../../lib/http.js";

export const POST = withRoute(async (request, { params }) => {
  const { token } = await params;
  const { password } = await request.json();
  const result = await resetPassword(token, password);
  return NextResponse.json({ success: true, ...result });
});
