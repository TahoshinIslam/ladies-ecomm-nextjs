"use client";

import Link from "next/link";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Package,
  MapPin,
  CreditCard,
  Clock,
  CheckCircle2,
  Truck,
  Home,
  X,
  AlertCircle,
  Gift,
  Download,
  Banknote,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";

import Badge from "../components/ui/Badge.jsx";
import Button from "../components/ui/Button.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import ReviewForm from "../components/review/ReviewForm.jsx";

import {
  useGetOrderQuery,
  useCancelOrderMutation,
  useGetPaymentByOrderQuery,
} from "../store/shopApi.js";
import { formatCurrency, formatDateTime, cn } from "../lib/utils.js";
import { downloadReceipt } from "../lib/receipt.js";

const PENDING_STEP = { key: "pending", label: "Pending", icon: Clock };
const PAID_STEP = { key: "paid", label: "Payment confirmed", icon: CheckCircle2 };
const PROCESSING_STEP = { key: "processing", label: "Processing", icon: Package };
const SHIPPED_STEP = { key: "shipped", label: "Shipped", icon: Truck };
const DELIVERED_STEP = { key: "delivered", label: "Delivered", icon: Home };

// Tracker steps depend on payment method. COD never hits "paid" (cash is
// collected at delivery), so showing Pending/Payment-confirmed would be
// misleading — start straight from Processing for COD orders.
// Empty string is treated as COD too, to cover legacy orders placed before
// paymentMethod was being persisted on the order record.
const isCodOrder = (order) =>
  order?.paymentMethod === "cod" ||
  (!order?.paymentMethod && order?.status !== "paid");

const getTrackingSteps = (order) => {
  if (isCodOrder(order)) {
    return [PROCESSING_STEP, SHIPPED_STEP, DELIVERED_STEP];
  }
  return [PENDING_STEP, PAID_STEP, PROCESSING_STEP, SHIPPED_STEP, DELIVERED_STEP];
};

const statusIndex = (status, steps) => steps.findIndex((s) => s.key === status);

export default function OrderDetailPage() {
  const { id } = useParams();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data, isLoading, isError, error } = useGetOrderQuery(id);
  const { data: paymentData } = useGetPaymentByOrderQuery(id, { skip: !id });
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
      downloadReceipt(order);
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
      <div className="container-x py-10 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 font-heading text-xl font-bold">Order not found</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {error?.data?.message || "We couldn't find this order."}
        </p>
        <Link href="/orders" className="mt-4 inline-block">
          <Button variant="outline">Back to orders</Button>
        </Link>
      </div>
    );
  }

  const currency = order.currency || "USD";
  const isFreeShippingPromo = /first order free/i.test(order.shippingTier || "");
  const isDelivered = order.status === "delivered";

  const trackingSteps = getTrackingSteps(order);
  const isCod = isCodOrder(order);
  const currentIdx = statusIndex(order.status, trackingSteps);
  const isCancelled = order.status === "cancelled";
  const isRefunded = order.status === "refunded";
  const canCancel = ["pending", "paid", "processing"].includes(order.status);

  const handleCancel = async () => {
    try {
      await cancelOrder(order._id).unwrap();
      toast.success("Order cancelled");
      setConfirmOpen(false);
    } catch (e) {
      toast.error(e?.data?.message || "Could not cancel");
    }
  };

  return (
    <div className="container-x py-10">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/orders"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back to orders
          </Link>
          <h1 className="mt-1 font-heading text-3xl font-black">
            Order #{order._id.slice(-8).toUpperCase()}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Placed {formatDateTime(order.createdAt)}
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
            {order.status}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => downloadReceipt(order)}>
            <Download className="h-3 w-3" />
            Receipt
          </Button>
          {canCancel && (
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
              <X className="h-3 w-3" />
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Tracking timeline */}
      {!isCancelled && !isRefunded && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 rounded-lg border border-border bg-background p-6"
        >
          <div className="mb-6 flex items-center justify-between gap-3">
            <h2 className="font-heading text-lg font-bold">Tracking</h2>
            {isCod && (
              <Badge variant="outline" className="gap-1">
                <Banknote className="h-3 w-3" />
                Pay on delivery
              </Badge>
            )}
          </div>
          <div className="relative">
            <div className="absolute left-5 top-5 bottom-5 w-0.5 bg-border sm:left-0 sm:top-5 sm:bottom-auto sm:h-0.5 sm:w-full" />
            <motion.div
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="absolute left-5 top-5 w-0.5 origin-top bg-accent sm:left-0 sm:h-0.5 sm:origin-left"
              style={{
                height:
                  currentIdx >= 0
                    ? `${(currentIdx / (trackingSteps.length - 1)) * 100}%`
                    : "0%",
              }}
            />
            <div className="relative space-y-5 sm:flex sm:space-y-0">
              {trackingSteps.map((step, i) => {
                const reached = i <= currentIdx;
                const active = i === currentIdx;
                const Icon = step.icon;
                return (
                  <div
                    key={step.key}
                    className="flex items-start gap-4 sm:flex-1 sm:flex-col sm:items-center sm:text-center"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.1 * i + 0.3, type: "spring" }}
                      className={cn(
                        "relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        reached
                          ? "border-accent bg-accent text-accent-foreground"
                          : "border-border bg-background text-muted-foreground",
                        active && "ring-4 ring-accent/20"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </motion.div>
                    <div className="sm:mt-2">
                      <p
                        className={cn(
                          "text-sm font-semibold",
                          reached ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {step.label}
                      </p>
                      {active && (
                        <p className="text-xs text-accent">Current status</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {order.trackingNumber && (
            <p className="mt-6 text-sm">
              <span className="text-muted-foreground">Tracking #: </span>
              <span className="font-mono font-semibold">{order.trackingNumber}</span>
            </p>
          )}
        </motion.div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="Items" icon={Package}>
            <ul className="divide-y divide-border">
              {order.items.map((it, i) => (
                <li key={i} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex gap-4">
                    <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                      <img
                        src={it.image}
                        alt={it.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold">{it.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Size {it.size} · Qty {it.quantity}
                      </p>
                      <p className="mt-1 text-sm font-bold">
                        {formatCurrency(it.price * it.quantity, currency)}
                      </p>
                    </div>
                  </div>
                  {/* Review form — only shown when order is delivered.
                      The backend enforces this as a hard gate too. */}
                  {isDelivered && it.product && (
                    <div className="mt-3 ml-24">
                      <ReviewForm productId={it.product} productName={it.name} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Shipping address" icon={MapPin}>
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
            <Card title="Payment" icon={CreditCard}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">
                    Method:{" "}
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
          <h2 className="mb-4 font-heading text-lg font-bold">Total</h2>
          <div className="space-y-2 text-sm">
            <Row label="Subtotal" value={formatCurrency(order.subtotal, currency)} />
            <Row
              label={isFreeShippingPromo ? "Shipping (first order)" : "Shipping"}
              value={
                order.shippingCost === 0 ? (
                  <span className="text-success font-semibold">
                    {isFreeShippingPromo ? (
                      <span className="inline-flex items-center gap-1">
                        <Gift className="h-3 w-3" /> Free
                      </span>
                    ) : (
                      "Free"
                    )}
                  </span>
                ) : (
                  formatCurrency(order.shippingCost, currency)
                )
              }
            />
            {order.tax > 0 && !order.taxLabel?.toLowerCase().includes("(incl") && (
              <Row
                label={order.taxLabel || "Tax"}
                value={formatCurrency(order.tax, currency)}
              />
            )}
            {order.discount > 0 && (
              <Row
                label="Discount"
                value={`-${formatCurrency(order.discount, currency)}`}
                valueClass="text-success"
              />
            )}
            <Row
              label="Total"
              value={formatCurrency(order.total, currency)}
              className="border-t border-border pt-3 text-base font-bold"
            />
            {order.tax > 0 && order.taxLabel?.toLowerCase().includes("(incl") && (
              <p className="pt-1 text-xs text-muted-foreground">
                Includes {order.taxLabel.replace(/\s*\(incl\.\)/i, "")} of{" "}
                {formatCurrency(order.tax, currency)}
              </p>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleCancel}
        title="Cancel this order?"
        description="Items will be restocked. This can't be undone."
        confirmLabel="Yes, cancel order"
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