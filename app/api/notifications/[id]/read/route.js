import { NextResponse } from "next/server";

import { requireUser } from "../../../../../lib/auth.js";
import { markAsRead } from "../../../../../services/notificationService.js";
import { withRoute } from "../../../../../lib/http.js";

export const PATCH = withRoute(async (request, { params }) => {
  const user = await requireUser(request);
  const { id } = await params;
  const notification = await markAsRead(user._id, id);
  return NextResponse.json({ success: true, notification });
});
