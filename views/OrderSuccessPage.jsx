"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { CheckCircle2, Package, ShoppingBag, AlertCircle, Banknote } from "lucide-react";

import Button from "../components/ui/Button.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import OrderTimeline from "../components/order/OrderTimeline.jsx";
import { useGetOrderQuery } from "../store/shopApi.js";
import { formatCurrency, resolveImage, formatVariantAttributes } from "../lib/utils.js";
import { useOrderStatusStream } from "../hooks/useOrderStatusStream.js";
import { useLocale } from "../context/LocaleProvider.jsx";

export default function OrderSuccessPage() {
  const { orderId } = useParams();
  const { t, locale } = useLocale();
  const { data, isLoading, isError, refetch } = useGetOrderQuery(orderId);
  const order = data?.order;
  useOrderStatusStream(orderId, refetch);

  if (isLoading) {
    return (
      <div className="container-x max-w-2xl py-16 space-y-6">
        <Skeleton className="mx-auto h-14 w-14 rounded-full" />
        <Skeleton className="mx-auto h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="container-x max-w-2xl py-16 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="mt-4 font-heading text-2xl font-bold">{t("orders.orderNotFound")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("orders.orderNotFoundBody")}
        </p>
        <Link href="/orders" className="mt-4 inline-block">
          <Button variant="outline">{t("orders.goToMyOrders")}</Button>
        </Link>
      </div>
    );
  }

  const firstName = (order.user?.name || order.shippingAddress?.fullName || "").split(" ")[0] || t("orders.thereFallbackName");
  const isCod = order.paymentMethod === "cod" || (!order.paymentMethod && order.status !== "paid");

  return (
    <div className="container-x max-w-2xl py-16">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", delay: 0.1 }}
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success"
        >
          <CheckCircle2 className="h-9 w-9" />
        </motion.div>
        <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-success">
          {t("orders.orderConfirmed")}
        </p>
        <h1 className="mt-2 font-heading text-3xl font-black">{t("orders.thankYouName", { name: firstName })}</h1>
        <p className="mt-2 text-muted-foreground">
          {t("orders.orderNumberHash", { id: order._id.slice(-8).toUpperCase() })}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          {isCod ? t("orders.processingOrderCod") : t("orders.processingOrder")}
          {order.shippingTier && t("orders.shippingTierNote", { tier: order.shippingTier })}
          {t("orders.notifyAsShips")}
        </p>
        {isCod && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
            <Banknote className="h-4 w-4 text-accent" />
            {t("checkout.codReady", { amount: formatCurrency(order.total, locale) })}
          </div>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center"
      >
        <Link href={`/orders/${order._id}`}>
          <Button variant="accent" size="lg" className="w-full sm:w-auto">
            <Package className="h-4 w-4" />
            {t("orders.trackOrder")}
          </Button>
        </Link>
        <Link href="/shop">
          <Button variant="outline" size="lg" className="w-full sm:w-auto">
            <ShoppingBag className="h-4 w-4" />
            {t("orders.continueShopping")}
          </Button>
        </Link>
      </motion.div>

      <div className="mt-10">
        <OrderTimeline order={order} />
      </div>

      <div className="mt-8 rounded-lg border border-border bg-background p-5">
        <h2 className="mb-3 font-heading text-sm font-bold uppercase tracking-wider text-muted-foreground">
          {t("checkout.orderSummaryTitle")}
        </h2>
        <ul className="divide-y divide-border">
          {order.items.map((it, i) => (
            <li key={i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                {it.snapshot?.image && (
                  <Image
                    src={resolveImage(it.snapshot.image, 96)}
                    alt={it.snapshot?.name || ""}
                    fill
                    sizes="48px"
                    loading="lazy"
                    className="object-contain"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{it.snapshot?.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatVariantAttributes(it.snapshot?.attributes, locale)}
                  {" · "}{t("checkout.qty")}{" "}
                  {it.quantity}
                </p>
              </div>
              <p className="text-sm font-bold">
                {formatCurrency((it.snapshot?.price || 0) * it.quantity, locale)}
              </p>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-base font-bold">
          <span>{t("checkout.total")}</span>
          <span>{formatCurrency(order.total, locale)}</span>
        </div>
      </div>
    </div>
  );
}
