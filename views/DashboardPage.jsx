import Link from "next/link";
import {
  Home,
  LayoutDashboard,
  Package,
  Banknote,
  XCircle,
  Truck,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

import Badge from "../components/ui/Badge.jsx";
import Button from "../components/ui/Button.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Breadcrumb from "../components/ui/Breadcrumb.jsx";

import { getMyOrders } from "../services/orderService.js";
import { requireServerUser } from "../lib/serverPageAuth.js";
import { serializeForClient } from "../lib/serialize.js";
import { cn, formatCurrency } from "../lib/utils.js";
import { formatDhakaDateTime } from "../lib/date.js";
import { getT, getServerLocale } from "../lib/i18n/server.js";

// Same "real spend" definition services/analyticsService.js's getOverview()
// uses for the admin dashboard (a locally-duplicated, not shared, constant
// — that file's own REVENUE_STATUSES isn't exported, and this page's only
// use of it is this one sum) — pending/cancelled/refunded orders were never
// actually paid for, so they don't count as spend.
const REVENUE_STATUSES = new Set(["paid", "processing", "shipped", "delivered"]);
const ACTIVE_STATUSES = new Set(["pending", "paid", "processing", "shipped"]);

const statusVariant = {
  pending: "warning",
  paid: "success",
  processing: "accent",
  shipped: "accent",
  delivered: "success",
  cancelled: "danger",
  refunded: "outline",
};

const statusLabelKey = {
  pending: "orders.statusPending",
  paid: "orders.statusPaid",
  processing: "orders.statusProcessing",
  shipped: "orders.statusShipped",
  delivered: "orders.statusDelivered",
  cancelled: "orders.statusCancelled",
  refunded: "orders.statusRefunded",
};

// Same tone treatment as views/admin/OverviewCharts.jsx's KpiCard. A first
// pass here used an 8%-opacity tint fading to plain background — too
// subtle to read as anything but white at a glance. This version commits
// harder: a solid-colored icon chip, a real gradient wash, and a colored
// top accent bar, so each card has an actual, unmistakable identity.
const STAT_TONES = {
  default: {
    icon: "bg-ink text-canvas",
    card: "border-border bg-gradient-to-br from-muted to-background",
    bar: "bg-muted-foreground/40",
  },
  accent: {
    icon: "bg-accent text-accent-foreground",
    card: "border-accent/25 bg-gradient-to-br from-accent/[0.16] via-accent/[0.04] to-background",
    bar: "bg-accent",
  },
  success: {
    icon: "bg-success text-white",
    card: "border-success/25 bg-gradient-to-br from-success/[0.16] via-success/[0.04] to-background",
    bar: "bg-success",
  },
  warning: {
    icon: "bg-warning text-white",
    card: "border-warning/25 bg-gradient-to-br from-warning/[0.16] via-warning/[0.04] to-background",
    bar: "bg-warning",
  },
  danger: {
    icon: "bg-danger text-white",
    card: "border-danger/25 bg-gradient-to-br from-danger/[0.16] via-danger/[0.04] to-background",
    bar: "bg-danger",
  },
};

// Real Server Component, same pattern as views/OrdersPage.jsx: authenticates
// via the cookie session, reads only this user's own orders
// (services/orderService.js's getMyOrders() already scopes by user id), and
// derives every stat card from that one real list — no separate aggregate
// endpoint, since a customer's own order count is small enough that summing
// the already-fetched list is simpler and just as correct as a DB-side
// aggregate would be.
export default async function DashboardPage() {
  const user = await requireServerUser("/dashboard");
  const [t, locale] = await Promise.all([getT(), getServerLocale()]);

  const rawOrders = await getMyOrders(user._id);
  const orders = serializeForClient(rawOrders);

  const totalOrders = orders.length;
  const totalSpent = orders.reduce(
    (sum, o) => (REVENUE_STATUSES.has(o.status) ? sum + (o.total || 0) : sum),
    0,
  );
  const cancelledOrders = orders.filter((o) => o.status === "cancelled").length;
  const activeOrders = orders.filter((o) => ACTIVE_STATUSES.has(o.status)).length;
  const deliveredOrders = orders.filter((o) => o.status === "delivered").length;

  const STATS = [
    { key: "totalOrders", icon: Package, value: totalOrders, labelKey: "dashboard.statTotalOrders", tone: "default" },
    {
      key: "totalSpent",
      icon: Banknote,
      value: formatCurrency(totalSpent, locale),
      labelKey: "dashboard.statTotalSpent",
      tone: "accent",
    },
    { key: "active", icon: Truck, value: activeOrders, labelKey: "dashboard.statActiveOrders", tone: "warning" },
    { key: "delivered", icon: CheckCircle2, value: deliveredOrders, labelKey: "dashboard.statDeliveredOrders", tone: "success" },
    { key: "cancelled", icon: XCircle, value: cancelledOrders, labelKey: "dashboard.statCancelledOrders", tone: "danger" },
  ];

  const recentOrders = orders.slice(0, 5);

  return (
    <div>
      <Breadcrumb
        items={[
          { label: t("navigation.home"), href: "/", icon: Home },
          { label: t("navigation.dashboard"), icon: LayoutDashboard },
        ]}
      />
      <h1 className="font-heading text-3xl font-black">
        {t("dashboard.welcome", { name: user.name.split(" ")[0] })}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("dashboard.subtitle")}</p>

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {STATS.map((s) => {
          const toneClasses = STAT_TONES[s.tone] ?? STAT_TONES.default;
          return (
            <div
              key={s.key}
              className={cn(
                "overflow-hidden rounded-lg border shadow-sm transition-shadow hover:shadow-md",
                toneClasses.card,
              )}
            >
              <div className={cn("h-1", toneClasses.bar)} />
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(s.labelKey)}
                  </span>
                  <span className={cn("flex h-8 w-8 flex-none items-center justify-center rounded-full shadow-sm", toneClasses.icon)}>
                    <s.icon className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-3 font-heading text-2xl font-black" data-tabular>
                  {s.value}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-xl font-bold">{t("dashboard.recentOrders")}</h2>
          {orders.length > 0 && (
            <Link href="/orders" className="flex items-center gap-1 text-sm font-semibold text-accent hover:underline">
              {t("dashboard.viewAllOrders")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        <div className="mt-4">
          {orders.length === 0 ? (
            <EmptyState
              icon={Package}
              title={t("orders.noOrdersYet")}
              message={t("orders.noOrdersBody")}
              action={
                <Link href="/shop">
                  <Button>{t("orders.startShopping")}</Button>
                </Link>
              }
            />
          ) : (
            <ul className="space-y-3">
              {recentOrders.map((o) => (
                <li key={o._id}>
                  <Link
                    href={`/orders/${o._id}`}
                    className="group flex items-center justify-between gap-4 rounded-lg border border-border bg-background p-4 transition-all hover:border-accent hover:shadow-soft"
                  >
                    <div className="min-w-0">
                      <p className="font-heading font-bold">
                        {t("orders.orderNumberHash", { id: o._id.slice(-8).toUpperCase() })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("orders.placedOn", { date: formatDhakaDateTime(o.createdAt, locale) })}
                      </p>
                    </div>
                    <div className="flex flex-none items-center gap-4">
                      <Badge variant={statusVariant[o.status] || "default"} className="capitalize">
                        {t(statusLabelKey[o.status] || "orders.statusPending")}
                      </Badge>
                      <p className="font-heading text-base font-bold" data-tabular>
                        {formatCurrency(o.total, locale)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
