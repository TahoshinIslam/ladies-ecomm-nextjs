import { NextResponse } from "next/server";

import { requirePermission } from "../../../../lib/auth.js";
import { PERMISSIONS } from "../../../../lib/permissions.js";
import { getUserById, updateUser, deleteUser } from "../../../../services/userService.js";
import { withRoute } from "../../../../lib/http.js";

export const GET = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.USERS_MANAGE);
  const { id } = await params;
  const user = await getUserById(id);
  return NextResponse.json({ success: true, user });
});

export const PUT = withRoute(async (request, { params }) => {
  const actingUser = await requirePermission(request, PERMISSIONS.USERS_MANAGE);
  const { id } = await params;
  const body = await request.json();
  const user = await updateUser(id, body, actingUser);
  return NextResponse.json({ success: true, user });
});

export const DELETE = withRoute(async (request, { params }) => {
  await requirePermission(request, PERMISSIONS.USERS_MANAGE);
  const { id } = await params;
  await deleteUser(id);
  return NextResponse.json({ success: true, message: "User deleted" });
});
