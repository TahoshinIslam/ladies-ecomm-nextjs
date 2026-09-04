import { NextResponse } from "next/server";

import { register } from "../../../../services/authService.js";
import { withRoute } from "../../../../lib/http.js";
import { readSessionTokenFromRequest, setSessionCookie, setCsrfCookie } from "../../../../lib/cookies.js";

export const POST = withRoute(async (request) => {
  const body = await request.json();
  const presented = readSessionTokenFromRequest(request);
  const { rawToken, rawCsrfToken, user } = await register(body, presented, {
    userAgent: request.headers.get("user-agent") || "",
  });

  const response = NextResponse.json(
    { success: true, user },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
  setSessionCookie(response, rawToken);
  setCsrfCookie(response, rawCsrfToken);
  return response;
});
