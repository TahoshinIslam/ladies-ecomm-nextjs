import OrdersPageClient from "./OrdersPageClient.jsx";
import { getAllOrders } from "../../services/orderService.js";
import { requireServerPermission } from "../../lib/serverPageAuth.js";
import { serializeForClient } from "../../lib/serialize.js";
import { parseAdminTableParams } from "../../lib/adminTableParams.js";
import { PERMISSIONS } from "../../lib/permissions.js";

// Real Server Component: authenticates and checks this page's own
// specific permission (orders.view — orders.manage also satisfies it, see
// lib/permissions.js's MANAGE_IMPLIES_VIEW) BEFORE reading any order data,
// then calls services/orderService.js's getAllOrders() directly — the
// same function GET /api/orders itself calls, never a self-HTTP round
// trip. The URL (`searchParams`) is parsed with the exact same rules
// hooks/useTableQueryState.js uses client-side (lib/adminTableParams.js),
// so the args this fetch runs with are byte-identical to what
// OrdersPageClient.jsx's own RTK Query hook will compute for that same
// URL — which is what lets it seed the client cache from this result
// instead of re-fetching the same page on mount.
export default async function AdminOrdersPage({ searchParams }) {
  await requireServerPermission(PERMISSIONS.ORDERS_VIEW, "/admin/orders");

  const rawSearchParams = await searchParams;
  const { page, limit, search, sortBy, sortOrder, filters } = parseAdminTableParams(rawSearchParams, {
    defaultLimit: 20,
    defaultSortBy: "createdAt",
    defaultSortOrder: "desc",
    filterKeys: ["status"],
  });

  const initialParams = {
    page,
    limit,
    search: search || undefined,
    sortBy,
    sortOrder,
    status: filters.status || undefined,
  };

  const rawData = await getAllOrders(initialParams);
  const initialData = serializeForClient(rawData);

  return <OrdersPageClient initialData={initialData} initialParams={initialParams} />;
}
