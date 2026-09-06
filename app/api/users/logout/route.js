import { NextResponse } from "next/server";

import { withRoute } from "../../../../lib/http.js";
import { revokeSessionByToken } from "../../../../lib/session.js";
import {
  readSessionTokenFromRequest,
  clearSessionCookie,
  clearCsrfCookie,
} from "../../../../lib/cookies.js";

// Phase 2: a real server-side operation now — revokes the exact session
// record the presented cookie names, so replaying that cookie afterward is
// rejected (see lib/session.js's validateSessionToken, which checks
// revokedAt). Always returns success, including when no session/cookie was
// present at all — logging out twice, or logging out after the session
// already expired, must behave identically to a client and must not leak
// whether a given cookie value was ever valid.
export const POST = withRoute(async (request) => {
  const rawToken = readSessionTokenFromRequest(request);
  if (rawToken) await revokeSessionByToken(rawToken);

  const response = NextResponse.json(
    { success: true, message: "Logged out" },
    { headers: { "Cache-Control": "no-store" } },
  );
  clearSessionCookie(response);
  clearCsrfCookie(response);
  return response;
});
