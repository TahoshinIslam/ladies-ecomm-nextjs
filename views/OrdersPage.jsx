"use client";

import Link from "next/link";
import { Package, ChevronRight, AlertCircle } from "lucide-react";

import Badge from "../components/ui/Badge.jsx";
import Button from "../components/ui/Button.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";

import { useGetMyOrdersQuery } from "../store/shopApi.js";
import { formatCurrency, formatDate, cn } from "../lib/utils.js";

const statusVariant = {
  pending: "warning",
  paid: "success",
  processing: "accent",
  shipped: "accent",
  delivered: "success",
  cancelled: "danger",
  refunded: "outline",
};

export default function OrdersPage() {
  const { data, isLoading, isError, error } = useGetMyOrdersQuery();
  const orders = data?.orders ?? [];

  return (
    <div className="container-x py-10">
      <h1 className="font-heading text-3xl font-black">My orders</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {orders.length} {orders.length === 1 ? "order" : "orders"}
      </p>

      <div className="mt-8">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load orders"
            message={error?.data?.message || "Please try again."}
          />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No orders yet"
            message="When you place an order it will appear here."
            action={
              <Link href="/shop">
                <Button>Start shopping</Button>
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {orders.map((o) => (
              <li key={o._id}>
                <Link
                  href={`/order/${o._id}`}
                  className="group block rounded-lg border border-border bg-background p-5 transition-all hover:border-accent hover:shadow-soft"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md bg-muted">
                        <Package className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-heading font-bold">
                          Order #{o._id.slice(-8).toUpperCase()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Placed {formatDate(o.createdAt)} · {o.items.length}{" "}
                          {o.items.length === 1 ? "item" : "items"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {o.items.slice(0, 3).map((it, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-xs"
                            >
                              {it.name} (× {it.quantity})
                            </span>
                          ))}
                          {o.items.length > 3 && (
                            <span className="text-xs text-muted-foreground">
                              +{o.items.length - 3} more
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-1">
                      <Badge variant={statusVariant[o.status] || "default"} className="capitalize">
                        {o.status}
                      </Badge>
                      <p className="font-heading text-lg font-bold">
                        {formatCurrency(o.total)}
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
