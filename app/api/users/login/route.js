import { NextResponse } from "next/server";

import { login } from "../../../../services/authService.js";
import { withRoute } from "../../../../lib/http.js";

export const POST = withRoute(async (request) => {
  const body = await request.json();
  const result = await login(body);
  return NextResponse.json({ success: true, ...result });
});
