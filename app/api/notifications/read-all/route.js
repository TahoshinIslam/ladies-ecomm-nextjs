import { NextResponse } from "next/server";

import { requireUser } from "../../../../lib/auth.js";
import { markAllAsRead } from "../../../../services/notificationService.js";
import { withRoute } from "../../../../lib/http.js";

export const PATCH = withRoute(async (request) => {
  const user = await requireUser(request);
  await markAllAsRead(user._id);
  return NextResponse.json({ success: true, message: "All notifications marked as read" });
});
