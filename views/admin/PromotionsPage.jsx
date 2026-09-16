"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Plus,
  Edit2,
  Trash2,
  Copy,
  Eye,
  Pause,
  Play,
  ArrowUp,
  ArrowDown,
  GalleryHorizontal,
  MessageSquareText,
} from "lucide-react";

import Input from "../../components/ui/Input.jsx";
import Select from "../../components/ui/Select.jsx";
import Textarea from "../../components/ui/Textarea.jsx";
import Button from "../../components/ui/Button.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Modal from "../../components/ui/Modal.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import ImageDropzone from "../../components/admin/ImageDropzone.jsx";
import ProductSearchSelect from "../../components/admin/ProductSearchSelect.jsx";

import {
  useListPromotionsQuery,
  useCreatePromotionMutation,
  useUpdatePromotionMutation,
  useDeletePromotionMutation,
  useDuplicatePromotionMutation,
  useReorderPromotionsMutation,
  useGetCategoriesQuery,
} from "../../store/shopApi.js";
import { COLLECTION_VALUES, AUDIENCES, PAGE_SCOPES, FREQUENCIES } from "../../lib/promotionConstants.js";
import { internalPathSchema } from "../../schemas/promotionSchemas.js";
import { resolveImage } from "../../lib/utils.js";

const TAB_TYPE = { carousel: "carousel", popup: "popup" };

// Client-side mirror of schemas/promotionSchemas.js's createPromotionSchema
// — same shape and safety checks (isSafeInternalPath reused directly, not
// re-implemented), matching schemas/couponSchemas.js's own precedent of a
// dedicated client-side zod object for react-hook-form's resolver. The
// server re-validates everything independently; this is UX only.
const promotionFormSchema = z
  .object({
    name: z.string().trim().min(1, "Required").max(120),
    type: z.enum(["carousel", "popup"]),
    status: z.enum(["draft", "active", "paused"]),
    title: z.string().trim().max(200).optional().default(""),
    titleBn: z.string().trim().max(200).optional().default(""),
    subtitle: z.string().trim().max(400).optional().default(""),
    subtitleBn: z.string().trim().max(400).optional().default(""),
    ctaLabel: z.string().trim().max(60).optional().default(""),
    ctaLabelBn: z.string().trim().max(60).optional().default(""),
    desktopImage: z.string().trim().min(1, "A desktop image is required"),
    mobileImage: z.string().trim().optional().default(""),
    imageAlt: z.string().trim().max(200).optional().default(""),
    imageAltBn: z.string().trim().max(200).optional().default(""),
    targetType: z.enum(["product", "category", "collection", "shop_filter", "internal_url", "none"]),
    targetProduct: z.string().nullable().optional(),
    targetCategory: z.string().nullable().optional(),
    targetCollection: z.string().nullable().optional(),
    targetUrl: z.union([internalPathSchema, z.literal("")]).optional().default(""),
    startAt: z.string().optional().default(""),
    endAt: z.string().optional().default(""),
    priority: z.coerce.number().int().min(0).max(1000).default(0),
    sortOrder: z.coerce.number().int().min(0).max(10000).default(0),
    audience: z.enum(AUDIENCES),
    pageScope: z.enum(PAGE_SCOPES),
    popupDelayMs: z.coerce.number().int().min(500).max(10000).default(2000),
    frequency: z.enum(FREQUENCIES),
  })
  .refine((d) => d.targetType !== "product" || !!d.targetProduct, { message: "Choose a product", path: ["targetProduct"] })
  .refine((d) => d.targetType !== "category" || !!d.targetCategory, { message: "Choose a category", path: ["targetCategory"] })
  .refine((d) => d.targetType !== "collection" || !!d.targetCollection, { message: "Choose a collection", path: ["targetCollection"] })
  .refine((d) => d.targetType !== "internal_url" || !!d.targetUrl, { message: "Enter a path", path: ["targetUrl"] })
  .refine((d) => !d.startAt || !d.endAt || new Date(d.startAt) < new Date(d.endAt), {
    message: "End must be after start",
    path: ["endAt"],
  });

function statusLabel(p) {
  const now = Date.now();
  if (p.status !== "active") return { label: p.status === "paused" ? "Paused" : "Draft", variant: p.status === "paused" ? "outline" : "default" };
  if (p.startAt && new Date(p.startAt).getTime() > now) return { label: "Scheduled", variant: "warning" };
  if (p.endAt && new Date(p.endAt).getTime() <= now) return { label: "Expired", variant: "danger" };
  return { label: "Active", variant: "success" };
}

export default function AdminPromotionsPage() {
  const [tab, setTab] = useState(TAB_TYPE.carousel);
  const [statusFilter, setStatusFilter] = useState("");
  const [editing, setEditing] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [previewing, setPreviewing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const { data, isLoading } = useListPromotionsQuery({ type: tab, status: statusFilter || undefined });
  const promotions = useMemo(() => data?.promotions ?? [], [data]);

  const [updatePromotion] = useUpdatePromotionMutation();
  const [deletePromotion, { isLoading: deleting }] = useDeletePromotionMutation();
  const [duplicatePromotion] = useDuplicatePromotionMutation();
  const [reorderPromotions] = useReorderPromotionsMutation();

  const togglePause = async (p) => {
    try {
      await updatePromotion({ id: p._id, status: p.status === "active" ? "paused" : "active" }).unwrap();
      toast.success(p.status === "active" ? "Paused" : "Activated");
    } catch (e) {
      toast.error(e?.data?.message || "Could not update status");
    }
  };

  const move = async (index, delta) => {
    const next = [...promotions];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await reorderPromotions({ type: tab, order: next.map((p) => p._id) }).unwrap();
    } catch (e) {
      toast.error(e?.data?.message || "Could not reorder");
    }
  };

  const handleDuplicate = async (p) => {
    try {
      await duplicatePromotion(p._id).unwrap();
      toast.success("Duplicated as a draft");
    } catch (e) {
      toast.error(e?.data?.message || "Could not duplicate");
    }
  };

  const handleDelete = async () => {
    try {
      await deletePromotion(confirmDelete._id).unwrap();
      toast.success("Promotion deleted");
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e?.data?.message || "Could not delete");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black">Promotions</h1>
          <p className="mt-1 text-sm text-muted-foreground">Homepage carousel banners and visitor campaign popups.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New {tab === "carousel" ? "banner" : "popup"}
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        <TabButton active={tab === "carousel"} onClick={() => setTab("carousel")} icon={GalleryHorizontal}>
          Carousel Banners
        </TabButton>
        <TabButton active={tab === "popup"} onClick={() => setTab("popup")} icon={MessageSquareText}>
          Campaign Popups
        </TabButton>
      </div>

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-[160px]" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : promotions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No {tab === "carousel" ? "carousel banners" : "campaign popups"} yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {promotions.map((p, i) => {
            const s = statusLabel(p);
            return (
              <li key={p._id} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                <div className="flex flex-none flex-col">
                  <button type="button" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === promotions.length - 1} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="relative h-12 w-20 flex-none overflow-hidden rounded-md bg-muted">
                  {p.desktopImage && (
                    <Image src={resolveImage(p.desktopImage, 160)} alt="" fill sizes="80px" className="object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.targetType === "none" ? "Visual only" : `→ ${p.targetType}`} · priority {p.priority}
                  </p>
                </div>
                <Badge variant={s.variant}>{s.label}</Badge>
                <div className="flex flex-none items-center gap-1">
                  <IconButton label="Preview" onClick={() => setPreviewing(p)} icon={Eye} />
                  <IconButton label={p.status === "active" ? "Pause" : "Activate"} onClick={() => togglePause(p)} icon={p.status === "active" ? Pause : Play} />
                  <IconButton label="Duplicate" onClick={() => handleDuplicate(p)} icon={Copy} />
                  <IconButton label="Edit" onClick={() => setEditing(p)} icon={Edit2} />
                  <IconButton label="Delete" onClick={() => setConfirmDelete(p)} icon={Trash2} danger />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {(createOpen || editing) && (
        <PromotionFormModal
          promotion={editing}
          defaultType={tab}
          onClose={() => {
            setCreateOpen(false);
            setEditing(null);
          }}
        />
      )}

      {previewing && <PromotionPreviewModal promotion={previewing} onClose={() => setPreviewing(null)} />}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={`Delete "${confirmDelete?.name}"?`}
        loading={deleting}
      />
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
        active ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}

function IconButton({ label, onClick, icon: Icon, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 place-items-center rounded-md hover:bg-muted focus-ring ${danger ? "text-danger" : "text-muted-foreground"}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

// ==================================================================== FORM

function toDatetimeLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PromotionFormModal({ promotion, defaultType, onClose }) {
  const isEdit = !!promotion;
  const [createPromotion, { isLoading: creating }] = useCreatePromotionMutation();
  const [updatePromotion, { isLoading: updating }] = useUpdatePromotionMutation();
  const { data: catData } = useGetCategoriesQuery();
  const categories = catData?.categories ?? [];

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(promotionFormSchema),
    defaultValues: promotion
      ? {
          ...promotion,
          targetProduct: promotion.targetProduct || null,
          targetCategory: promotion.targetCategory || null,
          targetCollection: promotion.targetCollection || null,
          startAt: toDatetimeLocal(promotion.startAt),
          endAt: toDatetimeLocal(promotion.endAt),
        }
      : {
          type: defaultType,
          status: "draft",
          targetType: "none",
          audience: "all",
          pageScope: "home",
          frequency: "once_per_session",
          popupDelayMs: 2000,
          priority: 0,
          sortOrder: 0,
          startAt: "",
          endAt: "",
        },
  });

  const targetType = watch("targetType");
  const type = watch("type");
  const watched = watch();

  const onSubmit = async (raw) => {
    const body = {
      ...raw,
      startAt: raw.startAt ? new Date(raw.startAt).toISOString() : null,
      endAt: raw.endAt ? new Date(raw.endAt).toISOString() : null,
      targetProduct: targetType === "product" ? raw.targetProduct : null,
      targetCategory: targetType === "category" ? raw.targetCategory : null,
      targetCollection: targetType === "collection" ? raw.targetCollection : null,
      targetUrl: targetType === "internal_url" ? raw.targetUrl : "",
    };
    try {
      if (isEdit) {
        await updatePromotion({ id: promotion._id, ...body }).unwrap();
        toast.success("Promotion updated");
      } else {
        await createPromotion(body).unwrap();
        toast.success("Promotion created");
      }
      onClose();
    } catch (e) {
      const fieldErrors = e?.data?.errors;
      if (fieldErrors?.length) fieldErrors.forEach((f) => toast.error(`${f.path}: ${f.message}`));
      else toast.error(e?.data?.message || "Could not save");
    }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit promotion" : "New promotion"} size="xl">
      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_320px]">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <Input label="Internal name (admin only)" error={errors.name?.message} {...register("name")} />

          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Type" disabled={isEdit} {...register("type")}>
              <option value="carousel">Carousel banner</option>
              <option value="popup">Campaign popup</option>
            </Select>
            <Select label="Status" {...register("status")}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </Select>
            <Input label="Priority" type="number" {...register("priority")} />
          </div>

          <fieldset className="space-y-3 rounded-lg border border-border p-4">
            <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Copy</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Title (English)" {...register("title")} />
              <Input label="Title (Bangla)" {...register("titleBn")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Textarea label="Subtitle (English)" rows={2} {...register("subtitle")} />
              <Textarea label="Subtitle (Bangla)" rows={2} {...register("subtitleBn")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="CTA label (English)" {...register("ctaLabel")} />
              <Input label="CTA label (Bangla)" {...register("ctaLabelBn")} />
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-border p-4">
            <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Creative</legend>
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">Desktop image</p>
              <Controller
                control={control}
                name="desktopImage"
                render={({ field }) => <ImageDropzone value={field.value} onChange={field.onChange} multiple={false} folder="promotions" />}
              />
              {errors.desktopImage && <p className="mt-1 text-xs text-danger">{errors.desktopImage.message}</p>}
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">Mobile image (optional — falls back to desktop)</p>
              <Controller
                control={control}
                name="mobileImage"
                render={({ field }) => <ImageDropzone value={field.value} onChange={field.onChange} multiple={false} folder="promotions" />}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Alt text (English)" {...register("imageAlt")} />
              <Input label="Alt text (Bangla)" {...register("imageAltBn")} />
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-border p-4">
            <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Destination</legend>
            <Select label="Target type" {...register("targetType")}>
              <option value="none">None — visual only, not clickable</option>
              <option value="product">Product</option>
              <option value="category">Category</option>
              <option value="collection">Collection (New / Featured / Discount)</option>
              <option value="internal_url">Internal path</option>
            </Select>

            {targetType === "product" && (
              <Controller
                control={control}
                name="targetProduct"
                render={({ field }) => <ProductSearchSelect value={field.value} onChange={field.onChange} label="Product" />}
              />
            )}
            {errors.targetProduct && <p className="text-xs text-danger">{errors.targetProduct.message}</p>}

            {targetType === "category" && (
              <Select label="Category" {...register("targetCategory")}>
                <option value="">Select a category…</option>
                {categories.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
            {errors.targetCategory && <p className="text-xs text-danger">{errors.targetCategory.message}</p>}

            {targetType === "collection" && (
              <Select label="Collection" {...register("targetCollection")}>
                <option value="">Select a collection…</option>
                {COLLECTION_VALUES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
            {errors.targetCollection && <p className="text-xs text-danger">{errors.targetCollection.message}</p>}

            {targetType === "internal_url" && (
              <Input label="Internal path" placeholder="/shop?fabric=chiffon" error={errors.targetUrl?.message} {...register("targetUrl")} />
            )}
          </fieldset>

          <fieldset className="space-y-3 rounded-lg border border-border p-4">
            <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Scheduling &amp; targeting</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Starts at (optional)" type="datetime-local" {...register("startAt")} />
              <Input label="Ends at (optional)" type="datetime-local" error={errors.endAt?.message} {...register("endAt")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="Audience" {...register("audience")}>
                <option value="all">Everyone</option>
                <option value="guest">Guests only</option>
                <option value="customer">Signed-in customers only</option>
              </Select>
              <Select label="Page scope" {...register("pageScope")}>
                <option value="home">Homepage</option>
                <option value="shop">Shop</option>
                <option value="product">Product detail</option>
                <option value="all">All eligible pages</option>
              </Select>
              <Input label="Sort order" type="number" {...register("sortOrder")} />
            </div>
          </fieldset>

          {type === "popup" && (
            <fieldset className="space-y-3 rounded-lg border border-border p-4">
              <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Popup behavior</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Delay before showing (ms)" type="number" min={500} max={10000} {...register("popupDelayMs")} />
                <Select label="Frequency" {...register("frequency")}>
                  <option value="every_session">Every eligible session</option>
                  <option value="once_per_session">Once per session</option>
                  <option value="once_per_day">Once per day</option>
                  <option value="once_per_campaign">Once per campaign (ever)</option>
                </Select>
              </div>
            </fieldset>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={creating || updating}>
              {isEdit ? "Update" : "Create"}
            </Button>
          </div>
        </form>

        <div className="hidden lg:block">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Live preview</p>
          <LivePreview values={watched} />
        </div>
      </div>
    </Modal>
  );
}

function LivePreview({ values }) {
  const title = values.title || "Untitled promotion";
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Desktop</p>
        <div className="relative aspect-[16/6] w-full overflow-hidden rounded-lg bg-muted">
          {values.desktopImage && (
            <Image src={resolveImage(values.desktopImage, 500)} alt="" fill sizes="400px" className="object-cover" />
          )}
          {values.title && (
            <div className="absolute inset-0 flex flex-col justify-center bg-black/30 p-3 text-white">
              <p className="text-sm font-bold">{title}</p>
              {values.subtitle && <p className="text-xs opacity-90">{values.subtitle}</p>}
            </div>
          )}
        </div>
      </div>
      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Mobile</p>
        <div className="relative mx-auto aspect-[9/12] w-32 overflow-hidden rounded-lg bg-muted">
          {(values.mobileImage || values.desktopImage) && (
            <Image src={resolveImage(values.mobileImage || values.desktopImage, 300)} alt="" fill sizes="128px" className="object-cover" />
          )}
        </div>
      </div>
    </div>
  );
}

function PromotionPreviewModal({ promotion, onClose }) {
  return (
    <Modal open onClose={onClose} title={`Preview — ${promotion.name}`} size="lg">
      <div className="p-5">
        <LivePreview values={promotion} />
      </div>
    </Modal>
  );
}
