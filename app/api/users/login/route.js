import { NextResponse } from "next/server";

import { login } from "../../../../services/authService.js";
import { withRoute } from "../../../../lib/http.js";
import { readSessionTokenFromRequest, setSessionCookie, setCsrfCookie } from "../../../../lib/cookies.js";
import { getClientIp } from "../../../../lib/clientIp.js";
import { enforceRateLimit, normalizeEmail } from "../../../../lib/rateLimit.js";
import { LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS, LOGIN_ACCOUNT_LIMIT, LOGIN_ACCOUNT_WINDOW_MS } from "../../../../lib/rateLimitConfig.js";

export const POST = withRoute(async (request) => {
  const body = await request.json();

  // Two independent dimensions, per Phase 3 section E — this does not
  // replace or interact with userModel.js's own failed-attempt lockout
  // (a separate, per-account mechanism that persists across windows);
  // both must pass. The IP check only runs when the deployment has
  // explicitly configured proxy trust (see lib/clientIp.js) — until then,
  // per-account is this endpoint's only rate-limit dimension.
  const rateLimitChecks = [];
  const ip = getClientIp(request);
  if (ip) rateLimitChecks.push({ identity: ip, action: "login:ip", limit: LOGIN_IP_LIMIT, windowMs: LOGIN_IP_WINDOW_MS });
  if (body?.email) {
    rateLimitChecks.push({ identity: normalizeEmail(body.email), action: "login:account", limit: LOGIN_ACCOUNT_LIMIT, windowMs: LOGIN_ACCOUNT_WINDOW_MS });
  }
  if (rateLimitChecks.length) await enforceRateLimit(rateLimitChecks);

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
