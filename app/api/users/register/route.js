import { NextResponse } from "next/server";

import { register } from "../../../../services/authService.js";
import { withRoute } from "../../../../lib/http.js";

export const POST = withRoute(async (request) => {
  const body = await request.json();
  const result = await register(body);
  return NextResponse.json({ success: true, ...result }, { status: 201 });
});
