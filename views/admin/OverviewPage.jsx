import { Suspense } from "react";

import OverviewCharts from "./OverviewCharts.jsx";
import OverviewSkeleton from "./OverviewSkeleton.jsx";
import {
  getCachedOverview,
  getCachedSalesSeries,
  getCachedTopProducts,
  getCachedStatusBreakdown,
  getCachedRevenueByMethod,
} from "../../lib/serverDataCache.js";
import { requireServerPermission } from "../../lib/serverPageAuth.js";
import { PERMISSIONS } from "../../lib/permissions.js";

// Split out from AdminOverviewPage below so the five analytics reads can
// sit behind their own <Suspense> boundary — the heading renders
// immediately, and this streams in once ready (mostly instant on a warm
// cache, but a genuine skeleton instead of a blank gap on a cold one)
// instead of the whole page waiting on all five before anything paints.
// Safe to Suspend here specifically because requireServerPermission()
// below has ALREADY resolved (redirected, if needed) before this
// component is even reached — see OverviewSkeleton.jsx's own comment for
// why a boundary is never introduced any higher than this.
async function OverviewData() {
  const [overview, series, topProducts, statusBreakdown, revenueByMethod] = await Promise.all([
    getCachedOverview(),
    getCachedSalesSeries(30),
    getCachedTopProducts(5),
    getCachedStatusBreakdown(),
    getCachedRevenueByMethod(),
  ]);

  return (
    <OverviewCharts
      overview={overview}
      series={series.series}
      topProducts={topProducts}
      statusBreakdown={statusBreakdown}
      revenueByMethod={revenueByMethod}
    />
  );
}

// Phase 7 — real, protected Server Component: enforces the actual
// dashboard.view permission server-side (requireServerPermission —
// redirects home if the session is missing or under-permissioned, the
// same rule GET /api/analytics/* already enforces via requirePermission())
// BEFORE any analytics query runs. Only OverviewCharts (Recharts genuinely
// needs a browser) is a Client Component; everything above it, including
// the permission check and the data fetch, runs on the server.
//
// Phase 8 — the five reads are now cached (lib/serverDataCache.js, 45s
// TTL + mutation invalidation) since the values are identical for every
// authorized administrator. The permission check above still runs first,
// unconditionally, on every request — only the DATA is shared-cached,
// never the authorization decision itself.
export default async function AdminOverviewPage() {
  await requireServerPermission(PERMISSIONS.DASHBOARD_VIEW, "/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-black">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Store performance at a glance.
        </p>
      </div>
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewData />
      </Suspense>
    </div>
  );
}
