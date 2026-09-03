"use client";

import { useState } from "react";
import Link from "next/link";
import { ShoppingCart, Eye, ExternalLink, Printer, Search } from "lucide-react";
import { toast } from "sonner";

import { printReceipt } from "../../lib/receipt.js";

import Badge from "../../components/ui/Badge.jsx";
import Button from "../../components/ui/Button.jsx";
import Select from "../../components/ui/Select.jsx";
import Input from "../../components/ui/Input.jsx";
import Modal from "../../components/ui/Modal.jsx";
import DataTable from "../../components/admin/DataTable.jsx";
import TableToolbar from "../../components/admin/TableToolbar.jsx";
import DropdownMenu, { DropdownMenuItem } from "../../components/ui/DropdownMenu.jsx";

import {
  useGetAllOrdersQuery,
  useUpdateOrderStatusMutation,
  useCancelOrderMutation,
  useLazyGetOrderQuery,
} from "../../store/shopApi.js";
import { formatCurrency } from "../../lib/utils.js";
import { formatDhakaDateTime } from "../../lib/date.js";
import { useTableQueryState } from "../../hooks/useTableQueryState.js";
import { usePermission } from "../../hooks/usePermission.js";
import { PERMISSIONS } from "../../lib/permissions.js";

const STATUS_OPTIONS = ["pending", "paid", "processing", "shipped", "delivered", "cancelled", "refunded"];

const statusVariant = {
  pending: "warning",
  paid: "success",
  processing: "accent",
  shipped: "accent",
  delivered: "success",
  cancelled: "danger",
  refunded: "outline",
};

export default function AdminOrdersPage() {
  const can = usePermission();
  const canManage = can(PERMISSIONS.ORDERS_MANAGE);
  const [updating, setUpdating] = useState(null);

  const { page, limit, search, sortBy, sortOrder, filters, activeFilterCount, setPage, setLimit, setSearch, setSort, setFilter, clearFilters } =
    useTableQueryState({ defaultLimit: 20, defaultSortBy: "createdAt", defaultSortOrder: "desc", filterKeys: ["status"] });

  const { data, isLoading, isFetching, isError, error, refetch } = useGetAllOrdersQuery({
    page,
    limit,
    search: search || undefined,
    sortBy,
    sortOrder,
    status: filters.status || undefined,
  });
  const orders = data?.orders ?? [];

  const [fetchOrder, { isFetching: fetchingReceipt }] = useLazyGetOrderQuery();
  const [printingId, setPrintingId] = useState(null);

  const handlePrint = async (id) => {
    try {
      setPrintingId(id);
      const res = await fetchOrder(id).unwrap();
      if (res?.order) printReceipt(res.order);
    } catch (e) {
      toast.error(e?.data?.message || "Could not load receipt");
    } finally {
      setPrintingId(null);
    }
  };

  const columns = [
    {
      key: "order",
      header: "Order",
      width: 140,
      render: (o) => (
        <>
          <p className="font-mono text-xs font-bold">#{o._id.slice(-8).toUpperCase()}</p>
          <p className="text-xs text-muted-foreground">
            {o.items.length} {o.items.length === 1 ? "item" : "items"}
          </p>
        </>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      hideBelow: "md",
      render: (o) => (
        <div className="max-w-[200px]">
          <p className="truncate font-semibold" title={o.user?.name || undefined}>
            {o.user?.name || "—"}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={o.user?.email || undefined}>
            {o.user?.email}
          </p>
        </div>
      ),
    },
    {
      key: "createdAt",
      header: "Date",
      hideBelow: "sm",
      sortable: true,
      render: (o) => <span data-tabular>{formatDhakaDateTime(o.createdAt)}</span>,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      sortable: true,
      render: (o) => <span data-tabular className="font-bold">{formatCurrency(o.total)}</span>,
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (o) => (
        <Badge variant={statusVariant[o.status] || "default"} className="capitalize">
          {o.status}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: 60,
      render: (o) => (
        <DropdownMenu triggerLabel={`Actions for order #${o._id.slice(-8).toUpperCase()}`}>
          {canManage && (
            <DropdownMenuItem icon={Eye} onClick={() => setUpdating(o)}>
              Edit status
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            icon={Printer}
            onClick={() => handlePrint(o._id)}
            disabled={printingId === o._id && fetchingReceipt}
          >
            Print receipt
          </DropdownMenuItem>
          <Link href={`/orders/${o._id}`}>
            <DropdownMenuItem icon={ExternalLink}>Open order</DropdownMenuItem>
          </Link>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-black">Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">{data?.total ?? 0} orders total</p>
      </div>

      <TableToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search order # or customer…"
        activeFilterCount={activeFilterCount}
        onClearFilters={clearFilters}
        filters={
          <Select
            value={filters.status || ""}
            onChange={(e) => setFilter("status", e.target.value)}
            className="max-w-[180px]"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </Select>
        }
      />

      <DataTable
        columns={columns}
        data={orders}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        error={error}
        onRetry={refetch}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={setSort}
        empty={
          search || activeFilterCount > 0
            ? { icon: Search, title: "No matching orders", message: "Try a different search or clear filters." }
            : { icon: ShoppingCart, title: "No orders yet" }
        }
        pagination={{
          page,
          pages: data?.pages ?? 1,
          total: data?.total ?? 0,
          limit,
          onPageChange: setPage,
          onLimitChange: setLimit,
        }}
      />

      {updating && <StatusUpdateModal order={updating} onClose={() => setUpdating(null)} />}
    </div>
  );
}

function StatusUpdateModal({ order, onClose }) {
  const [status, setStatus] = useState(order.status);
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber || "");
  const [updateStatus, { isLoading: updating }] = useUpdateOrderStatusMutation();
  const [cancelOrder, { isLoading: cancelling }] = useCancelOrderMutation();
  const isLoading = updating || cancelling;

  // "cancelled" goes through the dedicated cancel endpoint — it restores
  // variant stock and reverses coupon usage inside a transaction.
  // updateOrderStatus() only flips the status field, so picking "cancelled"
  // there would silently leave the reserved stock never returned to
  // inventory (see Phase 8 admin audit). Every other status (including
  // "refunded", which doesn't restock — the item already shipped) still
  // goes through the plain status update.
  const handleUpdate = async () => {
    try {
      if (status === "cancelled" && order.status !== "cancelled") {
        await cancelOrder(order._id).unwrap();
      } else {
        await updateStatus({ id: order._id, status, trackingNumber }).unwrap();
      }
      toast.success("Order updated");
      onClose();
    } catch (e) {
      toast.error(e?.data?.message || "Could not update");
    }
  };

  return (
    <Modal open onClose={onClose} title={`Order #${order._id.slice(-8).toUpperCase()}`} size="md">
      <div className="space-y-4 p-5">
        <div className="rounded-md bg-muted/30 p-3 text-sm">
          <p><strong>Customer:</strong> {order.user?.name || "—"} ({order.user?.email})</p>
          <p><strong>Placed:</strong> {formatDhakaDateTime(order.createdAt)}</p>
          <p><strong>Total:</strong> {formatCurrency(order.total)}</p>
          <p><strong>Items:</strong> {order.items.length}</p>
        </div>
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        {status === "cancelled" && order.status !== "cancelled" ? (
          <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-muted-foreground">
            This restores stock for every item and reverses any coupon use. Only
            available from pending, paid, or processing.
          </p>
        ) : (
          <Input label="Tracking number" placeholder="Optional" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleUpdate} loading={isLoading}>Update order</Button>
        </div>
      </div>
    </Modal>
  );
}
