import { NextResponse } from "next/server";

import { register } from "../../../../services/authService.js";
import { withRoute } from "../../../../lib/http.js";
import { readSessionTokenFromRequest, setSessionCookie, setCsrfCookie } from "../../../../lib/cookies.js";
import { requireClientIp } from "../../../../lib/clientIp.js";
import { enforceRateLimit, ClientIpUnavailableError } from "../../../../lib/rateLimit.js";
import { REGISTER_IP_LIMIT, REGISTER_IP_WINDOW_MS } from "../../../../lib/rateLimitConfig.js";
import { validateData } from "../../../../lib/validation.js";
import { registerSchema } from "../../../../schemas/authSchemas.js";

export const POST = withRoute(async (request) => {
  // Parsed raw (not yet schema-validated) — the rate-limit check below
  // must run regardless of whether the body turns out to be well-formed,
  // so a malformed body can't dodge the limiter by failing validation
  // first.
  let raw;
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }

  // Per trusted client IP only, to prevent bulk account creation — there
  // is no per-account dimension to fall back on here (no account exists
  // yet), so this is this route's ONLY protection. Phase 3B: in
  // production, if no trustworthy IP is available at all, this route must
  // fail closed (503) rather than silently proceed unprotected — see
  // lib/clientIp.js's requireClientIp() for the full policy (non-
  // production environments skip the IP dimension instead, for
  // testability; this can never happen in a real deployment).
  const { ok, identity: ip } = requireClientIp(request);
  if (!ok) throw new ClientIpUnavailableError();
  if (ip) await enforceRateLimit([{ identity: ip, action: "register:ip", limit: REGISTER_IP_LIMIT, windowMs: REGISTER_IP_WINDOW_MS }]);

  const body = validateData(raw, registerSchema);

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
