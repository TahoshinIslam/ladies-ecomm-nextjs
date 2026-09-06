import { NextResponse } from "next/server";

import { forgotPassword } from "../../../../services/userService.js";
import { withRoute } from "../../../../lib/http.js";
import { getClientIp } from "../../../../lib/clientIp.js";
import { enforceRateLimit, normalizeEmail } from "../../../../lib/rateLimit.js";
import {
  FORGOT_PASSWORD_IP_LIMIT,
  FORGOT_PASSWORD_IP_WINDOW_MS,
  FORGOT_PASSWORD_ACCOUNT_LIMIT,
  FORGOT_PASSWORD_ACCOUNT_WINDOW_MS,
} from "../../../../lib/rateLimitConfig.js";
import { validateData } from "../../../../lib/validation.js";
import { forgotPasswordSchema } from "../../../../schemas/authSchemas.js";

export const POST = withRoute(async (request) => {
  let raw;
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  const email = raw?.email;

  // Both dimensions key off the SUBMITTED email string only — never a
  // database lookup to decide whether to rate-limit — so the limiter
  // itself cannot introduce an enumeration signal: an existing and a
  // nonexistent account are rate-limited identically, and (below,
  // unchanged) forgotPassword() already returns the same generic response
  // for both regardless of whether the limiter allowed the request.
  const rateLimitChecks = [];
  const ip = getClientIp(request);
  if (ip) rateLimitChecks.push({ identity: ip, action: "forgot-password:ip", limit: FORGOT_PASSWORD_IP_LIMIT, windowMs: FORGOT_PASSWORD_IP_WINDOW_MS });
  if (email) {
    rateLimitChecks.push({
      identity: normalizeEmail(email),
      action: "forgot-password:account",
      limit: FORGOT_PASSWORD_ACCOUNT_LIMIT,
      windowMs: FORGOT_PASSWORD_ACCOUNT_WINDOW_MS,
    });
  }
  if (rateLimitChecks.length) await enforceRateLimit(rateLimitChecks);

  const validated = validateData(raw, forgotPasswordSchema);
  const result = await forgotPassword(validated.email);
  return NextResponse.json({ success: true, ...result });
});
