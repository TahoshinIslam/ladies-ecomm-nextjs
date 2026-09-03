import { NextResponse } from "next/server";

import { forgotPassword } from "../../../../services/userService.js";
import { withRoute } from "../../../../lib/http.js";

export const POST = withRoute(async (request) => {
  const { email } = await request.json();
  const result = await forgotPassword(email);
  return NextResponse.json({ success: true, ...result });
});
