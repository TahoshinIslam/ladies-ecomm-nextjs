"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Tag, Plus, Edit2, Trash2, Copy, Check, Search } from "lucide-react";
import { toast } from "sonner";

import Input from "../../components/ui/Input.jsx";
import Select from "../../components/ui/Select.jsx";
import Button from "../../components/ui/Button.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Modal from "../../components/ui/Modal.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import DataTable from "../../components/admin/DataTable.jsx";
import TableToolbar from "../../components/admin/TableToolbar.jsx";
import DropdownMenu, { DropdownMenuItem } from "../../components/ui/DropdownMenu.jsx";

import {
  useListCouponsQuery,
  useCreateCouponMutation,
  useUpdateCouponMutation,
  useDeleteCouponMutation,
} from "../../store/shopApi.js";
import { formatCurrency, formatDate } from "../../lib/utils.js";
import { useTableQueryState } from "../../hooks/useTableQueryState.js";
import { DISCOUNT_TYPES } from "../../schemas/couponSchemas.js";

const couponSchema = z.object({
  code: z.string().min(3, "At least 3 characters").transform((s) => s.toUpperCase()),
  discountType: z.enum(DISCOUNT_TYPES),
  discountValue: z.coerce.number().positive(),
  minOrderAmount: z.coerce.number().min(0).optional().default(0),
  maxDiscount: z.coerce.number().optional().nullable(),
  usageLimit: z.coerce.number().optional().nullable(),
  perUserLimit: z.coerce.number().int().positive().default(1),
  expiresAt: z.string().min(1, "Required"),
  isActive: z.boolean().default(true),
});

export default function AdminCouponsPage() {
  const [editing, setEditing] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [copied, setCopied] = useState(null);

  const { page, limit, search, sortBy, sortOrder, filters, activeFilterCount, setPage, setLimit, setSearch, setSort, setFilter, clearFilters } =
    useTableQueryState({ defaultLimit: 20, defaultSortBy: "createdAt", defaultSortOrder: "desc", filterKeys: ["status"] });

  const { data, isLoading, isFetching, isError, error, refetch } = useListCouponsQuery({
    page,
    limit,
    search: search || undefined,
    status: filters.status || undefined,
    sortBy,
    sortOrder,
  });
  const coupons = data?.coupons ?? [];

  const [deleteCoupon, { isLoading: deleting }] = useDeleteCouponMutation();

  const returnToValidPageIfEmptied = (removedCount) => {
    if (coupons.length - removedCount <= 0 && page > 1) setPage(page - 1);
  };

  const handleDelete = async () => {
    try {
      await deleteCoupon(confirmDelete._id).unwrap();
      toast.success("Coupon deleted");
      returnToValidPageIfEmptied(1);
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e?.data?.message || "Could not delete");
    }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };

  const columns = [
    {
      key: "code",
      header: "Code",
      sortable: true,
      render: (c) => (
        <button
          onClick={() => copyCode(c.code)}
          className="group flex items-center gap-2 font-mono text-sm font-black text-accent hover:underline"
        >
          {c.code}
          {copied === c.code ? (
            <Check className="h-3 w-3 text-success" />
          ) : (
            <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100" />
          )}
        </button>
      ),
    },
    {
      key: "discount",
      header: "Discount",
      render: (c) => (
        <>
          <p>{c.discountType === "percentage" ? `${c.discountValue}% off` : `${formatCurrency(c.discountValue)} off`}</p>
          {c.minOrderAmount > 0 && (
            <p className="text-xs text-muted-foreground">min {formatCurrency(c.minOrderAmount)}</p>
          )}
        </>
      ),
    },
    {
      key: "usedCount",
      header: "Used",
      align: "center",
      hideBelow: "sm",
      sortable: true,
      render: (c) => (
        <span data-tabular>
          {c.usedCount}
          {c.usageLimit ? ` / ${c.usageLimit}` : ""}
        </span>
      ),
    },
    {
      key: "expiresAt",
      header: "Expires",
      hideBelow: "md",
      sortable: true,
      render: (c) => formatDate(c.expiresAt),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (c) => {
        const expired = new Date(c.expiresAt) < new Date();
        if (expired) return <Badge variant="danger">Expired</Badge>;
        if (!c.isActive) return <Badge variant="outline">Paused</Badge>;
        return <Badge variant="success">Active</Badge>;
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: 60,
      render: (c) => (
        <DropdownMenu triggerLabel={`Actions for coupon ${c.code}`}>
          <DropdownMenuItem icon={Edit2} onClick={() => setEditing(c)}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem icon={Trash2} danger onClick={() => setConfirmDelete(c)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black">Coupons</h1>
          <p className="mt-1 text-sm text-muted-foreground">{data?.total ?? 0} coupons</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New coupon
        </Button>
      </div>

      <TableToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search code…"
        activeFilterCount={activeFilterCount}
        onClearFilters={clearFilters}
        filters={
          <Select
            value={filters.status || ""}
            onChange={(e) => setFilter("status", e.target.value)}
            className="max-w-[160px]"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="expired">Expired</option>
          </Select>
        }
      />

      <DataTable
        columns={columns}
        data={coupons}
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
            ? { icon: Search, title: "No matching coupons", message: "Try a different search or clear filters." }
            : { icon: Tag, title: "No coupons", message: "Create your first promo code." }
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

      {(createOpen || editing) && (
        <CouponFormModal coupon={editing} onClose={() => { setCreateOpen(false); setEditing(null); }} />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={`Delete coupon "${confirmDelete?.code}"?`}
        loading={deleting}
      />
    </div>
  );
}

function CouponFormModal({ coupon, onClose }) {
  const isEdit = !!coupon;
  const [createCoupon, { isLoading: creating }] = useCreateCouponMutation();
  const [updateCoupon, { isLoading: updating }] = useUpdateCouponMutation();

  // Date.now() is impure to call during render (React Compiler's purity
  // rule) — a useMemo callback is still part of the render path and isn't
  // exempt, but a useState lazy initializer function is specifically
  // documented as safe for one-time impure/expensive work, since React
  // guarantees it runs exactly once per component instance. This is also
  // the actually-intended behavior: react-hook-form only reads
  // `defaultValues` at the form's initial render anyway, so this "30 days
  // from now" default was already meant to be fixed at mount, not
  // recomputed on every re-render.
  const [defaultNewExpiresAt] = useState(
    () => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(couponSchema),
    defaultValues: coupon
      ? {
          ...coupon,
          expiresAt: new Date(coupon.expiresAt).toISOString().slice(0, 10),
        }
      : {
          discountType: "percentage",
          isActive: true,
          perUserLimit: 1,
          minOrderAmount: 0,
          expiresAt: defaultNewExpiresAt,
        },
  });

  const onSubmit = async (data) => {
    try {
      if (isEdit) {
        await updateCoupon({ id: coupon._id, ...data }).unwrap();
        toast.success("Coupon updated");
      } else {
        await createCoupon(data).unwrap();
        toast.success("Coupon created");
      }
      onClose();
    } catch (e) {
      toast.error(e?.data?.message || "Could not save");
    }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit coupon" : "New coupon"} size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 p-5">
        <Input label="Code" placeholder="SUMMER25" error={errors.code?.message} {...register("code")} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Type" error={errors.discountType?.message} {...register("discountType")}>
            <option value="percentage">Percentage off</option>
            <option value="flat">Flat amount off</option>
          </Select>
          <Input label="Value" type="number" step="0.01" error={errors.discountValue?.message} {...register("discountValue")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Min order amount" type="number" step="0.01" {...register("minOrderAmount")} />
          <Input label="Max discount cap (optional)" type="number" step="0.01" {...register("maxDiscount")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Total uses (optional)" type="number" placeholder="Unlimited" {...register("usageLimit")} />
          <Input label="Per user limit" type="number" {...register("perUserLimit")} />
        </div>
        <Input label="Expires at" type="date" error={errors.expiresAt?.message} {...register("expiresAt")} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-accent" {...register("isActive")} />
          Active
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={creating || updating}>{isEdit ? "Update" : "Create"}</Button>
        </div>
      </form>
    </Modal>
  );
}
