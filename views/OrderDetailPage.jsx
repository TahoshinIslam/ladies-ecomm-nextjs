"use client";

import Link from "next/link";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Home,
  Package,
  MapPin,
  CreditCard,
  X,
  AlertCircle,
  Gift,
  Download,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";

import Badge from "../components/ui/Badge.jsx";
import Button from "../components/ui/Button.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import Breadcrumb from "../components/ui/Breadcrumb.jsx";
import ReviewForm from "../components/review/ReviewForm.jsx";
import OrderTimeline from "../components/order/OrderTimeline.jsx";

import {
  useGetOrderQuery,
  useCancelOrderMutation,
  useGetPaymentByOrderQuery,
} from "../store/shopApi.js";
import { formatCurrency, cn } from "../lib/utils.js";
import { formatDhakaDateTime } from "../lib/date.js";
import { downloadReceipt } from "../lib/receipt.js";
import { useOrderStatusStream } from "../hooks/useOrderStatusStream.js";
import { useLocale } from "../context/LocaleProvider.jsx";

export default function OrderDetailPage() {
  const { id } = useParams();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { t, locale } = useLocale();
  const { data, isLoading, isError, error, refetch } = useGetOrderQuery(id);
  const { data: paymentData } = useGetPaymentByOrderQuery(id, { skip: !id });
  useOrderStatusStream(id, refetch);
  const [cancelOrder, { isLoading: cancelling }] = useCancelOrderMutation();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const order = data?.order;
  const receiptShown = useRef(false);

  // Auto-open the receipt once when the user arrives here right after a
  // successful checkout (gateway redirect adds ?receipt=1).
  useEffect(() => {
    if (!order || receiptShown.current) return;
    if (sp.get("receipt") === "1") {
      receiptShown.current = true;
      downloadReceipt(order, locale);
      // Strip the flag so a refresh doesn't re-download the receipt.
      const next = new URLSearchParams(sp);
      next.delete("receipt");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
  }, [order, sp, router, pathname]);

  if (isLoading) {
    return (
      <div className="container-x py-10 space-y-6">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="container-x py-10">
        <Breadcrumb
          items={[
            { label: t("navigation.home"), href: "/", icon: Home },
            { label: t("navigation.orders"), href: "/orders", icon: Package },
            { label: t("orders.notFound") },
          ]}
        />
        <div className="text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 font-heading text-xl font-bold">{t("orders.orderNotFound")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {error?.data?.message || t("orders.couldntFindOrder")}
          </p>
          <Link href="/orders" className="mt-4 inline-block">
            <Button variant="outline">{t("orders.backToOrders")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  const isFreeShippingPromo = /first order free/i.test(order.shippingTier || "");
  const isDelivered = order.status === "delivered";

  const isCancelled = order.status === "cancelled";
  const isRefunded = order.status === "refunded";
  const canCancel = ["pending", "paid", "processing"].includes(order.status);
  const STATUS_KEYS = {
    pending: "orders.statusPending",
    paid: "orders.statusPaid",
    processing: "orders.statusProcessing",
    shipped: "orders.statusShipped",
    delivered: "orders.statusDelivered",
    cancelled: "orders.statusCancelled",
    refunded: "orders.statusRefunded",
  };

  const handleCancel = async () => {
    try {
      await cancelOrder(order._id).unwrap();
      toast.success(t("orders.orderCancelled"));
      setConfirmOpen(false);
    } catch (e) {
      toast.error(e?.data?.message || t("orders.couldntCancel"));
    }
  };

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
          <Button variant="outline" size="sm" onClick={() => downloadReceipt(order, locale)}>
            <Download className="h-3 w-3" />
            {t("orders.receipt")}
          </Button>
          {canCancel && (
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
              <X className="h-3 w-3" />
              {t("orders.cancel")}
            </Button>
          )}
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
                    <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                      <img
                        src={it.snapshot?.image}
                        alt={it.snapshot?.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold">{it.snapshot?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[it.snapshot?.color, it.snapshot?.size, it.snapshot?.fabric]
                          .filter(Boolean)
                          .join(" · ")}
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

          {paymentData?.payment && (
            <Card title={t("orders.payment")} icon={CreditCard}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">
                    {t("orders.method")}:{" "}
                    <span className="font-semibold uppercase">
                      {paymentData.payment.method}
                    </span>
                  </p>
                  {paymentData.payment.transactionId && (
                    <p className="text-xs text-muted-foreground">
                      TXN: {paymentData.payment.transactionId}
                    </p>
                  )}
                </div>
                <Badge
                  variant={
                    paymentData.payment.status === "completed" ? "success" : "warning"
                  }
                >
                  {paymentData.payment.status}
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

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleCancel}
        title={t("orders.cancelOrderTitle")}
        description={t("orders.cancelOrderDesc")}
        confirmLabel={t("orders.yesCancel")}
        loading={cancelling}
      />
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