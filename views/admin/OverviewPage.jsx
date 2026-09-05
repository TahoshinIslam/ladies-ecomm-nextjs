import OverviewCharts from "./OverviewCharts.jsx";
import {
  getOverview,
  getSalesSeries,
  getTopProducts,
  getStatusBreakdown,
  getRevenueByMethod,
} from "../../services/analyticsService.js";
import { requireServerPermission } from "../../lib/serverPageAuth.js";
import { serializeForClient } from "../../lib/serialize.js";
import { PERMISSIONS } from "../../lib/permissions.js";

// Phase 7 — real, protected Server Component: enforces the actual
// dashboard.view permission server-side (requireServerPermission —
// redirects home if the session is missing or under-permissioned, the
// same rule GET /api/analytics/* already enforces via requirePermission())
// before any analytics query runs, then fetches all five independent
// reads in parallel. Only OverviewCharts (Recharts genuinely needs a
// browser) is a Client Component; everything above it, including the
// permission check, runs on the server.
export default async function AdminOverviewPage() {
  await requireServerPermission(PERMISSIONS.DASHBOARD_VIEW, "/admin");

  const [overview, series, topProducts, statusBreakdown, revenueByMethod] = await Promise.all([
    getOverview(),
    getSalesSeries(30),
    getTopProducts(5),
    getStatusBreakdown(),
    getRevenueByMethod(),
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
        overview={serializeForClient(overview)}
        series={serializeForClient(series.series)}
        topProducts={serializeForClient(topProducts)}
        statusBreakdown={serializeForClient(statusBreakdown)}
        revenueByMethod={serializeForClient(revenueByMethod)}
      />
    </div>
  );
}
