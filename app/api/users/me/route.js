import { NextResponse } from "next/server";

import { getSessionUser, requireUser } from "../../../../lib/auth.js";
import { getMe } from "../../../../services/authService.js";
import { updateMe } from "../../../../services/userService.js";
import { HttpError, withRoute } from "../../../../lib/http.js";
import { revokeAllSessionsForUser } from "../../../../lib/session.js";
import { readSessionTokenFromRequest, clearSessionCookie, clearCsrfCookie } from "../../../../lib/cookies.js";

export const GET = withRoute(async (request) => {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no session");
  return NextResponse.json({ success: true, user: getMe(user) }, { headers: { "Cache-Control": "no-store" } });
});

export const PUT = withRoute(async (request) => {
  const sessionUser = await requireUser(request);
  const body = await request.json();
  const user = await updateMe(sessionUser._id, body);

  const response = NextResponse.json({ success: true, user }, { headers: { "Cache-Control": "no-store" } });

  // Password change: revoke every session for this user (including the
  // one making this request) and clear the cookie on this response —
  // "require the user to sign in again" is the preferred behavior per the
  // Phase 2 spec, rather than silently leaving other sessions (or this
  // one, past this response) valid.
  if (body?.newPassword) {
    await revokeAllSessionsForUser(sessionUser._id);
    clearSessionCookie(response);
    clearCsrfCookie(response);
  }

  return response;
});
