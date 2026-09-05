import OverviewCharts from "./OverviewCharts.jsx";
import {
  getCachedOverview,
  getCachedSalesSeries,
  getCachedTopProducts,
  getCachedStatusBreakdown,
  getCachedRevenueByMethod,
} from "../../lib/serverDataCache.js";
import { requireServerPermission } from "../../lib/serverPageAuth.js";
import { PERMISSIONS } from "../../lib/permissions.js";

// Phase 7 — real, protected Server Component: enforces the actual
// dashboard.view permission server-side (requireServerPermission —
// redirects home if the session is missing or under-permissioned, the
// same rule GET /api/analytics/* already enforces via requirePermission())
// BEFORE any analytics query runs, then fetches all five independent
// reads in parallel. Only OverviewCharts (Recharts genuinely needs a
// browser) is a Client Component; everything above it, including the
// permission check, runs on the server.
//
// Phase 8 — the five reads are now cached (lib/serverDataCache.js, 45s
// TTL + mutation invalidation) since the values are identical for every
// authorized administrator. The permission check above still runs first,
// unconditionally, on every request — only the DATA is shared-cached,
// never the authorization decision itself.
export default async function AdminOverviewPage() {
  await requireServerPermission(PERMISSIONS.DASHBOARD_VIEW, "/admin");

  const [overview, series, topProducts, statusBreakdown, revenueByMethod] = await Promise.all([
    getCachedOverview(),
    getCachedSalesSeries(30),
    getCachedTopProducts(5),
    getCachedStatusBreakdown(),
    getCachedRevenueByMethod(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-black">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Store performance at a glance.
        </p>
      </div>
      <OverviewCharts
        overview={overview}
        series={series.series}
        topProducts={topProducts}
        statusBreakdown={statusBreakdown}
        revenueByMethod={revenueByMethod}
      />
    </div>
  );
}
