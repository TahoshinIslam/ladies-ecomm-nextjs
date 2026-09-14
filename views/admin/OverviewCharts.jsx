"use client";

// Phase 7 — Recharts genuinely needs a browser (canvas/SVG measurement,
// ResizeObserver, hover interactivity), so the charts themselves stay a
// Client Component — but all the data they render arrives as plain,
// already-fetched arrays from the Server Component (views/admin/
// OverviewPage.jsx), not from RTK Query. No loading states are needed
// here (there's nothing left to load); the existing EmptyState fallbacks
// for a genuinely empty array are preserved as-is.
import Image from "next/image";
import { motion } from "framer-motion";
import {
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
  ResponsiveContainer,
} from "recharts";
import {
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  TrendingUp,
  AlertTriangle,
  Star,
} from "lucide-react";

import EmptyState from "../../components/ui/EmptyState.jsx";
import { formatCurrency, cn, resolveImage } from "../../lib/utils.js";

const PIE_COLORS = [
  "rgb(var(--color-accent))",
  "rgb(var(--color-primary))",
  "rgb(var(--color-success))",
  "rgb(var(--color-warning))",
  "rgb(var(--color-danger))",
  "rgb(var(--color-muted-foreground))",
  "#8b5cf6",
];

export default function OverviewCharts({ overview, series, topProducts, statusBreakdown, revenueByMethod }) {
  const o = overview;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={DollarSign}
          label="Total revenue"
          value={formatCurrency(o.totalRevenue)}
          sub={`This month: ${formatCurrency(o.monthlyRevenue)}`}
          tone="accent"
        />
        <KpiCard
          icon={ShoppingCart}
          label="Orders"
          value={o.totalOrders}
          sub={`${o.pendingOrders} pending`}
          tone={o.pendingOrders > 0 ? "warning" : "default"}
        />
        <KpiCard
          icon={Users}
          label="Customers"
          value={o.totalUsers}
          sub={`+${o.newUsersLast30} last 30 days`}
          tone="success"
          trendUp
        />
        <KpiCard
          icon={Package}
          label="Products"
          value={o.totalProducts}
          sub={`${o.outOfStockProducts} out of stock`}
          tone={o.outOfStockProducts > 0 ? "danger" : "default"}
        />
      </div>

      {/* Secondary KPIs — flat surface, border-first, no gradient wash */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-4">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-warning text-white">
            <Star className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs text-muted-foreground">Average rating</p>
            <p className="text-xl font-bold">{o.avgRating || "No reviews"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-4">
          <span
            className={cn(
              "flex h-9 w-9 flex-none items-center justify-center rounded-md",
              o.outOfStockProducts > 0 ? "bg-warning text-white" : "bg-ink text-canvas",
            )}
          >
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs text-muted-foreground">Low/out of stock</p>
            <p className="text-xl font-bold">{o.outOfStockProducts} products</p>
          </div>
        </div>
      </div>

      {/* Sales line chart */}
      <Card title="Revenue (last 30 days)">
        {!series?.length ? (
          <EmptyState icon={TrendingUp} title="No sales yet" message="Revenue will appear here." />
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
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
          {!topProducts?.length ? (
            <EmptyState icon={Package} title="No sales yet" />
          ) : (
            <ul className="space-y-3">
              {topProducts.map((p, i) => (
                <li key={p._id} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-bold text-accent">
                    {i + 1}
                  </span>
                  <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                    {p.image && (
                      <Image
                        src={resolveImage(p.image, 80)}
                        alt={p.name}
                        fill
                        sizes="40px"
                        loading="lazy"
                        className="object-contain"
                      />
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
          {!statusBreakdown?.length ? (
            <EmptyState icon={ShoppingCart} title="No orders yet" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusBreakdown}
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
                    {statusBreakdown.map((_, i) => (
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
        {!revenueByMethod?.length ? (
          <EmptyState icon={DollarSign} title="No payments yet" />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueByMethod}>
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

// Leo's card language is flat and border-first — "no resting shadow,
// no gradients" (see the design system's own visual-foundations notes).
// Each tone still gives a KPI an unmistakable identity, but through a
// solid-colored icon chip and a thin top accent line, not a gradient wash
// or a shadowed circle — the same restrained treatment as every other
// surface in the app now.
const KPI_TONES = {
  default: { icon: "bg-ink text-canvas", bar: "bg-line" },
  accent: { icon: "bg-accent text-accent-foreground", bar: "bg-accent" },
  success: { icon: "bg-success text-white", bar: "bg-success" },
  warning: { icon: "bg-warning text-white", bar: "bg-warning" },
  danger: { icon: "bg-danger text-white", bar: "bg-danger" },
};

function KpiCard({ icon: Icon, label, value, sub, tone = "default", trendUp }) {
  const toneClasses = KPI_TONES[tone] ?? KPI_TONES.default;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-lg border border-border bg-background transition-colors hover:border-ink/20"
    >
      <div className={cn("h-[3px]", toneClasses.bar)} />
      <div className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </p>
          <p className="font-heading mt-2 text-2xl font-extrabold">{value}</p>
          {sub && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              {trendUp && <TrendingUp className="h-3 w-3 text-success" />}
              {sub}
            </p>
          )}
        </div>
        <div className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-md", toneClasses.icon)}>
          <Icon className="h-[18px] w-[18px]" />
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
