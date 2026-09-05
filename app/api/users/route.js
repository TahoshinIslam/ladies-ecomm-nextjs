import { NextResponse } from "next/server";

import { requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { listUsers } from "../../../services/userService.js";
import { withRoute } from "../../../lib/http.js";
import { parseQuery } from "../../../lib/validation.js";
import { adminUserListQuerySchema } from "../../../schemas/authSchemas.js";

// GET /api/users?search=&role=&sortBy=&sortOrder=&page=&limit=
export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.USERS_MANAGE);
  const { searchParams } = new URL(request.url);
  const query = parseQuery(searchParams, adminUserListQuerySchema);
  const result = await listUsers(query);
  return NextResponse.json({ success: true, ...result });
});
