import { NextResponse } from "next/server";

import { requirePermission } from "../../../lib/auth.js";
import { PERMISSIONS } from "../../../lib/permissions.js";
import { listUsers } from "../../../services/userService.js";
import { withRoute } from "../../../lib/http.js";

// GET /api/users?search=&role=&sortBy=&sortOrder=&page=&limit=
export const GET = withRoute(async (request) => {
  await requirePermission(request, PERMISSIONS.USERS_MANAGE);
  const { searchParams } = new URL(request.url);
  const result = await listUsers({
    page: searchParams.get("page") || 1,
    limit: searchParams.get("limit") || 20,
    search: searchParams.get("search") || undefined,
    sortBy: searchParams.get("sortBy") || undefined,
    sortOrder: searchParams.get("sortOrder") || undefined,
    role: searchParams.get("role") || undefined,
  });
  return NextResponse.json({ success: true, ...result });
});
