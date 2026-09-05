import Link from "next/link";
import { Home, Package, ChevronRight } from "lucide-react";

import Badge from "../components/ui/Badge.jsx";
import Button from "../components/ui/Button.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Breadcrumb from "../components/ui/Breadcrumb.jsx";

import { getMyOrders } from "../services/orderService.js";
import { requireServerUser } from "../lib/serverPageAuth.js";
import { serializeForClient } from "../lib/serialize.js";
import { formatCurrency } from "../lib/utils.js";
import { formatDhakaDateTime } from "../lib/date.js";
import { getT, getServerLocale } from "../lib/i18n/server.js";

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

// Phase 7 — real Server Component: authenticates via the cookie session,
// queries only the authenticated user's own orders (services/orderService
// .js's getMyOrders() already scopes by user id), and renders the full
// list in the initial HTML. No client fetch (RTK Query's useGetMyOrdersQuery
// is gone) is needed to see this page's data; this page has no interactive
// state of its own (no pagination/filter controls exist on it today), so
// it needed no client island at all.
export default async function OrdersPage() {
  const user = await requireServerUser("/orders");
  const [t, locale] = await Promise.all([getT(), getServerLocale()]);

  const rawOrders = await getMyOrders(user._id);
  const orders = serializeForClient(rawOrders);

  return (
    <div className="container-x py-10">
      <Breadcrumb
        items={[
          { label: t("navigation.home"), href: "/", icon: Home },
          { label: t("navigation.orders"), icon: Package },
        ]}
      />
      <h1 className="font-heading text-3xl font-black">{t("orders.myOrders")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("orders.ordersCount", { count: orders.length })}
      </p>

      <div className="mt-8">
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
            {orders.map((o) => (
              <li key={o._id}>
                <Link
                  href={`/orders/${o._id}`}
                  className="group block rounded-lg border border-border bg-background p-5 transition-all hover:border-accent hover:shadow-soft"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md bg-muted">
                        <Package className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-heading font-bold">
                          {t("orders.orderNumberHash", { id: o._id.slice(-8).toUpperCase() })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("orders.placedOn", { date: formatDhakaDateTime(o.createdAt, locale) })} ·{" "}
                          {t("cart.itemCount", { count: o.items.length })}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {o.items.slice(0, 3).map((it, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs"
                            >
                              {it.snapshot?.name} (× {it.quantity})
                            </span>
                          ))}
                          {o.items.length > 3 && (
                            <span className="text-xs text-muted-foreground">
                              {t("orders.moreItems", { count: o.items.length - 3 })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-1">
                      <Badge variant={statusVariant[o.status] || "default"} className="capitalize">
                        {t(statusLabelKey[o.status] || "orders.statusPending")}
                      </Badge>
                      <p className="font-heading text-lg font-bold">
                        {formatCurrency(o.total, locale)}
                      </p>
                    </div>
                    <ChevronRight className="hidden h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 sm:block" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
