import { NextResponse } from "next/server";

import { resetPassword } from "../../../../../services/userService.js";
import { withRoute } from "../../../../../lib/http.js";
import { clearSessionCookie, clearCsrfCookie } from "../../../../../lib/cookies.js";

export const POST = withRoute(async (request, { params }) => {
  const { token } = await params;
  const { password } = await request.json();
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
