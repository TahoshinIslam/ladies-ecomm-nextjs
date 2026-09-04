import { NextResponse } from "next/server";

import { login } from "../../../../services/authService.js";
import { withRoute } from "../../../../lib/http.js";
import { readSessionTokenFromRequest, setSessionCookie, setCsrfCookie } from "../../../../lib/cookies.js";

export const POST = withRoute(async (request) => {
  const body = await request.json();
  const presented = readSessionTokenFromRequest(request);
  const { rawToken, rawCsrfToken, user } = await login(body, presented, {
    userAgent: request.headers.get("user-agent") || "",
  });

  // The raw session/CSRF tokens travel ONLY via Set-Cookie — never in this
  // JSON body.
  const response = NextResponse.json({ success: true, user }, { headers: { "Cache-Control": "no-store" } });
  setSessionCookie(response, rawToken);
  setCsrfCookie(response, rawCsrfToken);
  return response;
});
