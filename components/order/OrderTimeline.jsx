"use client";

import { motion } from "framer-motion";
import { Clock, CheckCircle2, Package, Truck, Home, Banknote } from "lucide-react";

import Badge from "../ui/Badge.jsx";
import { cn } from "../../lib/utils.js";

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

/**
 * The order-status tracker — shared by the order-success thank-you page and
 * the regular order-detail page, so both always agree on what "shipped"
 * actually looks like instead of two copies drifting apart. Renders nothing
 * for a cancelled/refunded order; the caller decides what to show instead
 * (see OrderDetailPage.jsx's isCancelled/isRefunded branch).
 */
export default function OrderTimeline({ order, className }) {
  if (!order) return null;
  const isCancelled = order.status === "cancelled";
  const isRefunded = order.status === "refunded";
  if (isCancelled || isRefunded) return null;

  const trackingSteps = getTrackingSteps(order);
  const isCod = isCodOrder(order);
  const currentIdx = statusIndex(order.status, trackingSteps);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("rounded-lg border border-border bg-background p-6", className)}
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
                  {active && <p className="text-xs text-accent">Current status</p>}
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
  );
}
