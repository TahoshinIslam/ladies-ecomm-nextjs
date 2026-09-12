import UsersPageClient from "./UsersPageClient.jsx";
import { listUsers } from "../../services/userService.js";
import { requireServerPermission } from "../../lib/serverPageAuth.js";
import { serializeForClient } from "../../lib/serialize.js";
import { parseAdminTableParams } from "../../lib/adminTableParams.js";
import { PERMISSIONS } from "../../lib/permissions.js";

// Real Server Component — same shape as views/admin/OrdersPage.jsx: checks
// this page's own specific permission (users.manage) before reading any
// user data, calls services/userService.js's listUsers() directly (never
// a self-HTTP round trip to GET /api/users), and parses the URL with the
// exact rules hooks/useTableQueryState.js uses client-side so the client
// can seed its RTK Query cache from this same result instead of
// re-fetching it.
export default async function AdminUsersPage({ searchParams }) {
  await requireServerPermission(PERMISSIONS.USERS_MANAGE, "/admin/users");

  const rawSearchParams = await searchParams;
  const { page, limit, search, sortBy, sortOrder, filters } = parseAdminTableParams(rawSearchParams, {
    defaultLimit: 20,
    defaultSortBy: "createdAt",
    defaultSortOrder: "desc",
    filterKeys: ["role"],
  });

  const initialParams = {
    page,
    limit,
    search: search || undefined,
    sortBy,
    sortOrder,
    role: filters.role || undefined,
  };

  const rawData = await listUsers(initialParams);
  const initialData = serializeForClient(rawData);

  return <UsersPageClient initialData={initialData} initialParams={initialParams} />;
}
