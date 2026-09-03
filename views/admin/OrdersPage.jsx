"use client";

import { useState } from "react";
import Link from "next/link";
import { ShoppingCart, Eye, ExternalLink, Printer } from "lucide-react";
import { toast } from "sonner";

import { printReceipt } from "../../lib/receipt.js";

import Badge from "../../components/ui/Badge.jsx";
import Button from "../../components/ui/Button.jsx";
import Select from "../../components/ui/Select.jsx";
import Input from "../../components/ui/Input.jsx";
import Modal from "../../components/ui/Modal.jsx";
import Skeleton from "../../components/ui/Skeleton.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";

import {
  useGetAllOrdersQuery,
  useUpdateOrderStatusMutation,
  useLazyGetOrderQuery,
} from "../../store/shopApi.js";
import { formatCurrency, formatDate, cn } from "../../lib/utils.js";

const STATUS_OPTIONS = [
  "pending",
  "paid",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
];

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
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [updating, setUpdating] = useState(null);

  const { data, isLoading } = useGetAllOrdersQuery({ page, limit: 20, ...(statusFilter ? { status: statusFilter } : {}) });
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-black">Orders</h1>
        <p className="mt-1 text-sm text-muted-foreground">{data?.total || 0} orders total</p>
      </div>

      <div className="flex gap-3">
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="max-w-xs">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="No orders" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-3 text-left">Order</th>
                <th className="hidden p-3 text-left md:table-cell">Customer</th>
                <th className="hidden p-3 text-left sm:table-cell">Date</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((o) => (
                <tr key={o._id} className="hover:bg-muted/20">
                  <td className="p-3">
                    <p className="font-mono text-xs font-bold">#{o._id.slice(-8).toUpperCase()}</p>
                    <p className="text-xs text-muted-foreground">{o.items.length} {o.items.length === 1 ? "item" : "items"}</p>
                  </td>
                  <td className="hidden p-3 md:table-cell">
                    <p className="font-semibold">{o.user?.name || "—"}</p>
                    <p className="text-xs text-muted-foreground">{o.user?.email}</p>
                  </td>
                  <td className="hidden p-3 text-muted-foreground sm:table-cell">{formatDate(o.createdAt)}</td>
                  <td className="p-3 text-right font-bold">{formatCurrency(o.total)}</td>
                  <td className="p-3 text-center">
                    <Badge variant={statusVariant[o.status] || "default"} className="capitalize">{o.status}</Badge>
                  </td>
                  <td className="p-3 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => setUpdating(o)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Edit status">
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handlePrint(o._id)}
                        disabled={printingId === o._id && fetchingReceipt}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                        aria-label="Print receipt"
                        title="Print receipt"
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                      <Link href={`/order/${o._id}`} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Open">
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
          <span className="px-4 text-sm">Page {page} of {data.pages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      {updating && <StatusUpdateModal order={updating} onClose={() => setUpdating(null)} />}
    </div>
  );
}

function StatusUpdateModal({ order, onClose }) {
  const [status, setStatus] = useState(order.status);
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber || "");
  const [updateStatus, { isLoading }] = useUpdateOrderStatusMutation();

  const handleUpdate = async () => {
    try {
      await updateStatus({ id: order._id, status, trackingNumber }).unwrap();
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
          <p><strong>Total:</strong> {formatCurrency(order.total)}</p>
          <p><strong>Items:</strong> {order.items.length}</p>
        </div>
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Input label="Tracking number" placeholder="Optional" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleUpdate} loading={isLoading}>Update order</Button>
        </div>
      </div>
    </Modal>
  );
}