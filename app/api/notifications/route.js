import { NextResponse } from "next/server";

import { requireUser } from "../../../lib/auth.js";
import { getNotifications } from "../../../services/notificationService.js";
import { withRoute } from "../../../lib/http.js";

export const GET = withRoute(async (request) => {
  const user = await requireUser(request);
  const { searchParams } = new URL(request.url);
  const result = await getNotifications(user._id, {
    page: searchParams.get("page") || undefined,
    limit: searchParams.get("limit") || undefined,
    unreadOnly: searchParams.get("unreadOnly") || undefined,
  });
  return NextResponse.json({ success: true, ...result });
});
