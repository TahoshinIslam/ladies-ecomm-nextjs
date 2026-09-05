import { NextResponse } from "next/server";

import { resetPassword } from "../../../../../services/userService.js";
import { withRoute } from "../../../../../lib/http.js";
import { clearSessionCookie, clearCsrfCookie } from "../../../../../lib/cookies.js";
import { requireClientIp } from "../../../../../lib/clientIp.js";
import { enforceRateLimit, ClientIpUnavailableError } from "../../../../../lib/rateLimit.js";
import { RESET_PASSWORD_IP_LIMIT, RESET_PASSWORD_IP_WINDOW_MS } from "../../../../../lib/rateLimitConfig.js";
import { parseJsonBody } from "../../../../../lib/validation.js";
import { resetPasswordSchema } from "../../../../../schemas/authSchemas.js";

export const POST = withRoute(async (request, { params }) => {
  const { token } = await params;

  // Per trusted client IP only — the raw reset token is NEVER used as a
  // rate-limit identity (it's already single-use and hashed at rest by
  // resetPassword() itself; there is no reason to also hash it into a
  // counter key) — which also means IP is this route's ONLY dimension.
  // Phase 3B: in production, with no trustworthy IP available, this route
  // must fail closed (503) rather than proceed unprotected — see
  // lib/clientIp.js's requireClientIp().
  const { ok, identity: ip } = requireClientIp(request);
  if (!ok) throw new ClientIpUnavailableError();
  if (ip) await enforceRateLimit([{ identity: ip, action: "reset-password:ip", limit: RESET_PASSWORD_IP_LIMIT, windowMs: RESET_PASSWORD_IP_WINDOW_MS }]);

  const { password } = await parseJsonBody(request, resetPasswordSchema);
  const result = await resetPassword(token, password);

  // resetPassword() already revoked every session server-side; also clear
  // whatever cookie THIS browser happens to be carrying, in case it was
  // one of them (defense in depth — a stale cookie left in the browser
  // that just always 401s is worse UX than one that's actively cleared).
  const response = NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  clearSessionCookie(response);
  clearCsrfCookie(response);
  return response;
});
