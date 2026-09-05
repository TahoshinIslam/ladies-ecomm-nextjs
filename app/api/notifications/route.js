import { NextResponse } from "next/server";

import { requireUser } from "../../../lib/auth.js";
import { getNotifications } from "../../../services/notificationService.js";
import { withRoute } from "../../../lib/http.js";
import { parseQuery } from "../../../lib/validation.js";
import { notificationsQuerySchema } from "../../../schemas/adminSchemas.js";

export const GET = withRoute(async (request) => {
  const user = await requireUser(request);
  const { searchParams } = new URL(request.url);
  const query = parseQuery(searchParams, notificationsQuerySchema);
  const result = await getNotifications(user._id, query);
  return NextResponse.json({ success: true, ...result });
});
