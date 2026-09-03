import { NextResponse } from "next/server";

import { getSessionUser, requireUser } from "../../../../lib/auth.js";
import { getMe } from "../../../../services/authService.js";
import { updateMe } from "../../../../services/userService.js";
import { HttpError, withRoute } from "../../../../lib/http.js";

export const GET = withRoute(async (request) => {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no token");
  return NextResponse.json({ success: true, user: getMe(user) });
});

export const PUT = withRoute(async (request) => {
  const sessionUser = await requireUser(request);
  const body = await request.json();
  const user = await updateMe(sessionUser._id, body);
  return NextResponse.json({ success: true, user });
});
