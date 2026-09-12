import Image from "next/image";
import { notFound } from "next/navigation";
import { Home, Package, MapPin, CreditCard, Gift } from "lucide-react";

import Badge from "../components/ui/Badge.jsx";
import Button from "../components/ui/Button.jsx";
import Breadcrumb from "../components/ui/Breadcrumb.jsx";
import ReviewForm from "../components/review/ReviewForm.jsx";
import OrderTimeline from "../components/order/OrderTimeline.jsx";
import OrderDetailActions from "../components/order/OrderDetailActions.jsx";

import { getOrder } from "../services/orderService.js";
import { getPaymentByOrder } from "../services/paymentService.js";
import { requireServerUser } from "../lib/serverPageAuth.js";
import { serializeForClient } from "../lib/serialize.js";
import { HttpError } from "../lib/http.js";
import { isObjectIdFormat } from "../lib/validation.js";
import { formatCurrency, cn, resolveImage, formatVariantAttributes } from "../lib/utils.js";
import { formatDhakaDateTime } from "../lib/date.js";
import { getT, getServerLocale } from "../lib/i18n/server.js";

const STATUS_KEYS = {
  pending: "orders.statusPending",
  paid: "orders.statusPaid",
  processing: "orders.statusProcessing",
  shipped: "orders.statusShipped",
  delivered: "orders.statusDelivered",
  cancelled: "orders.statusCancelled",
  refunded: "orders.statusRefunded",
};

// Phase 7 — real Server Component: authenticates via the cookie session,
// enforces ownership through the existing services/orderService.js
// getOrder() rule (owner or admin, otherwise a 403 — both a malformed id
// and an unauthorized/missing order resolve to the SAME notFound() here,
// which avoids confirming a given id even exists to a non-owner, a
// stricter guarantee than the JSON API's own distinguishable 403/404).
// The only client-side pieces are OrderDetailActions (SSE refresh, receipt
// download, cancel confirmation) and the pre-existing ReviewForm/
// OrderTimeline islands — everything else below is plain server-rendered
// content.
export default async function OrderDetailPage({ params }) {
  const { id } = await params;
  const user = await requireServerUser(`/orders/${id}`);
  const [t, locale] = await Promise.all([getT(), getServerLocale()]);

  if (!isObjectIdFormat(id)) notFound();

  // getOrder() and getPaymentByOrder() don't depend on each other — both
  // only need `id`/`user._id`/`user.role`, already known here — so they run
  // concurrently instead of one full round trip waiting on the other.
  // Payment stays genuinely optional (an order can legitimately have no
  // Payment row yet): allSettled means a rejected payment lookup can never
  // itself throw or block resolving the order below.
  const [orderResult, paymentResult] = await Promise.allSettled([
    getOrder(user._id, user.role, id),
    getPaymentByOrder(id, user._id, user.role),
  ]);

  if (orderResult.status === "rejected") {
    const err = orderResult.reason;
    if (err instanceof HttpError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
  const order = serializeForClient(orderResult.value);
  const payment = paymentResult.status === "fulfilled" ? serializeForClient(paymentResult.value) : null;

  const isFreeShippingPromo = /first order free/i.test(order.shippingTier || "");
  const isDelivered = order.status === "delivered";
  const isCancelled = order.status === "cancelled";
  const isRefunded = order.status === "refunded";
  const canCancel = ["pending", "paid", "processing"].includes(order.status);

  return (
    <div className="container-x py-10">
      <Breadcrumb
        items={[
          { label: t("navigation.home"), href: "/", icon: Home },
          { label: t("navigation.orders"), href: "/orders", icon: Package },
          { label: `#${order._id.slice(-8).toUpperCase()}` },
        ]}
      />

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black">
            {t("orders.orderNumberHash", { id: order._id.slice(-8).toUpperCase() })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("orders.placedOn", { date: formatDhakaDateTime(order.createdAt, locale) })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              isCancelled || isRefunded
                ? "danger"
                : order.status === "delivered"
                  ? "success"
                  : "accent"
            }
            className="capitalize"
          >
            {t(STATUS_KEYS[order.status] || "orders.statusPending")}
          </Badge>
          <OrderDetailActions order={order} canCancel={canCancel} />
        </div>
      </div>

      {/* Tracking timeline */}
      <OrderTimeline order={order} className="mt-8" />

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title={t("orders.items")} icon={Package}>
            <ul className="divide-y divide-border">
              {order.items.map((it, i) => (
                <li key={i} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex gap-4">
                    <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                      {it.snapshot?.image && (
                        <Image
                          src={resolveImage(it.snapshot.image, 160)}
                          alt={it.snapshot?.name || ""}
                          fill
                          sizes="80px"
                          loading="lazy"
                          className="object-contain"
                        />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold">{it.snapshot?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatVariantAttributes(it.snapshot?.attributes, locale)}
                        {" · "}{t("checkout.qty")}{" "}
                        {it.quantity}
                      </p>
                      <p className="mt-1 text-sm font-bold">
                        {formatCurrency(it.snapshot?.price * it.quantity, locale)}
                      </p>
                    </div>
                  </div>
                  {/* Review form — only shown when order is delivered.
                      The backend enforces this as a hard gate too. */}
                  {isDelivered && it.product && (
                    <div className="mt-3 ml-24">
                      <ReviewForm productId={it.product} productName={it.snapshot?.name} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card title={t("orders.shippingAddress2")} icon={MapPin}>
            <p className="font-semibold">{order.shippingAddress.fullName}</p>
            <p className="text-sm text-muted-foreground">
              {order.shippingAddress.street}, {order.shippingAddress.city}
              {order.shippingAddress.state && `, ${order.shippingAddress.state}`}{" "}
              {order.shippingAddress.postalCode}
            </p>
            <p className="text-sm text-muted-foreground">
              {order.shippingAddress.country}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {order.shippingAddress.phone}
            </p>
          </Card>

          {payment && (
            <Card title={t("orders.payment")} icon={CreditCard}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">
                    {t("orders.method")}:{" "}
                    <span className="font-semibold uppercase">{payment.method}</span>
                  </p>
                  {payment.transactionId && (
                    <p className="text-xs text-muted-foreground">
                      TXN: {payment.transactionId}
                    </p>
                  )}
                </div>
                <Badge variant={payment.status === "completed" ? "success" : "warning"}>
                  {payment.status}
                </Badge>
              </div>
            </Card>
          )}
        </div>

        <div className="rounded-lg border border-border bg-muted/20 p-5 lg:sticky lg:top-24 lg:self-start">
          <h2 className="mb-4 font-heading text-lg font-bold">{t("checkout.total")}</h2>
          <div className="space-y-2 text-sm">
            <Row label={t("checkout.subtotal")} value={formatCurrency(order.subtotal, locale)} />
            <Row
              label={isFreeShippingPromo ? t("orders.shippingFirstOrder") : t("checkout.shippingLabel")}
              value={
                order.shippingCost === 0 ? (
                  <span className="text-success font-semibold">
                    {isFreeShippingPromo ? (
                      <span className="inline-flex items-center gap-1">
                        <Gift className="h-3 w-3" /> {t("checkout.free")}
                      </span>
                    ) : (
                      t("checkout.free")
                    )}
                  </span>
                ) : (
                  formatCurrency(order.shippingCost, locale)
                )
              }
            />
            {order.tax > 0 && !order.taxLabel?.toLowerCase().includes("(incl") && (
              <Row
                label={order.taxLabel || t("checkout.tax")}
                value={formatCurrency(order.tax, locale)}
              />
            )}
            {order.discount > 0 && (
              <Row
                label={t("checkout.discount")}
                value={`-${formatCurrency(order.discount, locale)}`}
                valueClass="text-success"
              />
            )}
            <Row
              label={t("checkout.total")}
              value={formatCurrency(order.total, locale)}
              className="border-t border-border pt-3 text-base font-bold"
            />
            {order.tax > 0 && order.taxLabel?.toLowerCase().includes("(incl") && (
              <p className="pt-1 text-xs text-muted-foreground">
                {t("checkout.includesTaxOf", { tax: order.taxLabel.replace(/\s*\(incl\.\)/i, "") })}{" "}
                {formatCurrency(order.tax, locale)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, icon: Icon, children }) {
  return (
    <div className="rounded-lg border border-border bg-background p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-accent" />
        <h3 className="font-heading font-bold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, valueClass, className }) {
  return (
    <div className={cn("flex justify-between", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", valueClass)}>{value}</span>
    </div>
  );
}
