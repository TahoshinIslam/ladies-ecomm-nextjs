import { NextResponse } from "next/server";

import { getSessionUser } from "../../../../lib/auth.js";
import { getMe } from "../../../../services/authService.js";
import { HttpError, withRoute } from "../../../../lib/http.js";

export const GET = withRoute(async (request) => {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no token");
  return NextResponse.json({ success: true, user: getMe(user) });
});
