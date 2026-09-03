"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Tag, Plus, Edit2, Trash2, Copy, Check } from "lucide-react";
import { toast } from "sonner";

import Input from "../../components/ui/Input.jsx";
import Select from "../../components/ui/Select.jsx";
import Button from "../../components/ui/Button.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Modal from "../../components/ui/Modal.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import Skeleton from "../../components/ui/Skeleton.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";

import {
  useListCouponsQuery,
  useCreateCouponMutation,
  useUpdateCouponMutation,
  useDeleteCouponMutation,
} from "../../store/shopApi.js";
import { formatCurrency, formatDate } from "../../lib/utils.js";

const couponSchema = z.object({
  code: z.string().min(3, "At least 3 characters").transform((s) => s.toUpperCase()),
  discountType: z.enum(["percentage", "flat"]),
  discountValue: z.coerce.number().positive(),
  minOrderAmount: z.coerce.number().min(0).optional().default(0),
  maxDiscount: z.coerce.number().optional().nullable(),
  usageLimit: z.coerce.number().optional().nullable(),
  perUserLimit: z.coerce.number().int().positive().default(1),
  expiresAt: z.string().min(1, "Required"),
  isActive: z.boolean().default(true),
});

export default function AdminCouponsPage() {
  const { data, isLoading } = useListCouponsQuery();
  const coupons = data?.coupons ?? [];

  const [editing, setEditing] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [copied, setCopied] = useState(null);

  const [deleteCoupon, { isLoading: deleting }] = useDeleteCouponMutation();

  const handleDelete = async () => {
    try {
      await deleteCoupon(confirmDelete._id).unwrap();
      toast.success("Coupon deleted");
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black">Coupons</h1>
          <p className="mt-1 text-sm text-muted-foreground">{coupons.length} active coupons</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New coupon
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : coupons.length === 0 ? (
        <EmptyState icon={Tag} title="No coupons" message="Create your first promo code." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {coupons.map((c) => {
            const expired = new Date(c.expiresAt) < new Date();
            return (
              <div key={c._id} className="rounded-lg border border-border bg-background p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <button onClick={() => copyCode(c.code)} className="group flex items-center gap-2 font-mono text-lg font-black text-accent hover:underline">
                      {c.code}
                      {copied === c.code ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100" />}
                    </button>
                    <p className="mt-1 text-sm">
                      {c.discountType === "percentage" ? `${c.discountValue}% off` : `${formatCurrency(c.discountValue)} off`}
                      {c.minOrderAmount > 0 && <span className="text-muted-foreground"> · min {formatCurrency(c.minOrderAmount)}</span>}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {expired ? (
                      <Badge variant="danger">Expired</Badge>
                    ) : !c.isActive ? (
                      <Badge variant="outline">Paused</Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )}
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>Expires {formatDate(c.expiresAt)}</p>
                  <p>
                    Used {c.usedCount}{c.usageLimit ? ` of ${c.usageLimit}` : ""}
                  </p>
                  {c.maxDiscount && <p>Max discount: {formatCurrency(c.maxDiscount)}</p>}
                </div>

                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(c)} className="flex-1">
                    <Edit2 className="h-3 w-3" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(c)}>
                    <Trash2 className="h-3 w-3 text-danger" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
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
