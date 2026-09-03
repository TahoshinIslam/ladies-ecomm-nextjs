"use client";

import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Star,
} from "lucide-react";

import Skeleton from "../../components/ui/Skeleton.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import AdminErrorState from "../../components/admin/AdminErrorState.jsx";
import {
  useGetOverviewQuery,
  useGetSalesSeriesQuery,
  useGetTopProductsQuery,
  useGetStatusBreakdownQuery,
  useGetRevenueByMethodQuery,
} from "../../store/shopApi.js";
import { formatCurrency, cn } from "../../lib/utils.js";

const PIE_COLORS = [
  "rgb(var(--color-accent))",
  "rgb(var(--color-primary))",
  "rgb(var(--color-success))",
  "rgb(var(--color-warning))",
  "rgb(var(--color-danger))",
  "rgb(var(--color-muted-foreground))",
  "#8b5cf6",
];

export default function AdminOverviewPage() {
  const {
    data: overview,
    isLoading: loadingOverview,
    isError: overviewError,
    error: overviewErrorDetail,
    refetch: refetchOverview,
  } = useGetOverviewQuery();
  const { data: series, isLoading: loadingSeries, isError: seriesError, refetch: refetchSeries } = useGetSalesSeriesQuery(30);
  const { data: top, isLoading: loadingTop, isError: topError, refetch: refetchTop } = useGetTopProductsQuery(5);
  const { data: status, isError: statusError, refetch: refetchStatus } = useGetStatusBreakdownQuery();
  const { data: byMethod, isError: methodError, refetch: refetchMethod } = useGetRevenueByMethodQuery();

  const o = overview?.overview;

  // All five queries share the same admin auth boundary — in practice a
  // bad/expired session fails them together, so one full-page error state
  // (rather than five separate inline ones) is what actually happened here.
  if (overviewError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-3xl font-black">Overview</h1>
        </div>
        <AdminErrorState
          title="Couldn't load dashboard data"
          message={overviewErrorDetail?.data?.message || "Your session may have expired. Try again."}
          onRetry={() => {
            refetchOverview();
            refetchSeries();
            refetchTop();
            refetchStatus();
            refetchMethod();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-black">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Store performance at a glance.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={DollarSign}
          label="Total revenue"
          value={o ? formatCurrency(o.totalRevenue) : "—"}
          loading={loadingOverview}
          sub={o && `This month: ${formatCurrency(o.monthlyRevenue)}`}
          tone="accent"
        />
        <KpiCard
          icon={ShoppingCart}
          label="Orders"
          value={o?.totalOrders ?? "—"}
          loading={loadingOverview}
          sub={o && `${o.pendingOrders} pending`}
          tone={o?.pendingOrders > 0 ? "warning" : "default"}
        />
        <KpiCard
          icon={Users}
          label="Customers"
          value={o?.totalUsers ?? "—"}
          loading={loadingOverview}
          sub={o && `+${o.newUsersLast30} last 30 days`}
          tone="success"
          trendUp
        />
        <KpiCard
          icon={Package}
          label="Products"
          value={o?.totalProducts ?? "—"}
          loading={loadingOverview}
          sub={o && `${o.outOfStockProducts} out of stock`}
          tone={o?.outOfStockProducts > 0 ? "danger" : "default"}
        />
      </div>

      {/* Secondary KPIs */}
      {o && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-4">
            <Star className="h-5 w-5 text-yellow-500" />
            <div>
              <p className="text-xs text-muted-foreground">Average rating</p>
              <p className="text-xl font-bold">{o.avgRating || "No reviews"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-4">
            <AlertTriangle className={cn("h-5 w-5", o.outOfStockProducts > 0 ? "text-warning" : "text-muted-foreground")} />
            <div>
              <p className="text-xs text-muted-foreground">Low/out of stock</p>
              <p className="text-xl font-bold">{o.outOfStockProducts} products</p>
            </div>
          </div>
        </div>
      )}

      {/* Sales line chart */}
      <Card title="Revenue (last 30 days)">
        {loadingSeries ? (
          <Skeleton className="h-64 w-full" />
        ) : seriesError ? (
          <AdminErrorState compact title="Couldn't load revenue" onRetry={refetchSeries} />
        ) : !series?.series?.length ? (
          <EmptyState icon={TrendingUp} title="No sales yet" message="Revenue will appear here." />
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series.series}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgb(var(--color-accent))" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="rgb(var(--color-accent))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "rgb(var(--color-muted-foreground))" }}
                  tickFormatter={(d) => d.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "rgb(var(--color-muted-foreground))" }}
                  tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgb(var(--color-background))",
                    border: "1px solid rgb(var(--color-border))",
                    borderRadius: "var(--radius)",
                    fontSize: 12,
                  }}
                  formatter={(v) => formatCurrency(v)}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="rgb(var(--color-accent))"
                  strokeWidth={2}
                  fill="url(#colorRev)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top products */}
        <Card title="Top selling products">
          {loadingTop ? (
            <Skeleton className="h-64 w-full" />
          ) : topError ? (
            <AdminErrorState compact title="Couldn't load top products" onRetry={refetchTop} />
          ) : !top?.products?.length ? (
            <EmptyState icon={Package} title="No sales yet" />
          ) : (
            <ul className="space-y-3">
              {top.products.map((p, i) => (
                <li key={p._id} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-bold text-accent">
                    {i + 1}
                  </span>
                  <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                    {p.image && (
                      <img src={p.image} alt={p.name} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.totalSold} sold · {formatCurrency(p.revenue)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Order status pie */}
        <Card title="Order status breakdown">
          {statusError ? (
            <AdminErrorState compact title="Couldn't load order status" onRetry={refetchStatus} />
          ) : !status?.data?.length ? (
            <EmptyState icon={ShoppingCart} title="No orders yet" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={status.data}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    innerRadius={40}
                    paddingAngle={2}
                    label={(e) => `${e.status}: ${e.count}`}
                    labelLine={false}
                  >
                    {status.data.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "rgb(var(--color-background))",
                      border: "1px solid rgb(var(--color-border))",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Revenue by payment method */}
      <Card title="Revenue by payment method">
        {methodError ? (
          <AdminErrorState compact title="Couldn't load payment data" onRetry={refetchMethod} />
        ) : !byMethod?.data?.length ? (
          <EmptyState icon={DollarSign} title="No payments yet" />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMethod.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-border))" />
                <XAxis
                  dataKey="method"
                  tick={{ fontSize: 11, fill: "rgb(var(--color-muted-foreground))" }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "rgb(var(--color-muted-foreground))" }}
                  tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgb(var(--color-background))",
                    border: "1px solid rgb(var(--color-border))",
                    borderRadius: "var(--radius)",
                    fontSize: 12,
                  }}
                  formatter={(v) => formatCurrency(v)}
                />
                <Bar
                  dataKey="revenue"
                  fill="rgb(var(--color-accent))"
                  radius={[8, 8, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, loading, tone = "default", trendUp }) {
  const tones = {
    default: "bg-muted text-foreground",
    accent: "bg-accent/10 text-accent",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    danger: "bg-danger/10 text-danger",
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-border bg-background p-5"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-24" />
          ) : (
            <p className="mt-2 font-heading text-2xl font-black">{value}</p>
          )}
          {sub && !loading && (
            <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
              {trendUp && <TrendingUp className="h-3 w-3 text-success" />}
              {sub}
            </p>
          )}
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-md", tones[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </motion.div>
  );
}

function Card({ title, children }) {
  return (
    <div className="rounded-lg border border-border bg-background p-5">
      <h3 className="mb-4 font-heading font-bold">{title}</h3>
      {children}
    </div>
  );
}
