"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Plus,
  Edit2,
  Trash2,
  Package,
  Search,
  Copy,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import Input from "../../components/ui/Input.jsx";
import Select from "../../components/ui/Select.jsx";
import Textarea from "../../components/ui/Textarea.jsx";
import Button from "../../components/ui/Button.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Modal from "../../components/ui/Modal.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import ImageDropzone from "../../components/admin/ImageDropzone.jsx";
import DataTable from "../../components/admin/DataTable.jsx";
import TableToolbar from "../../components/admin/TableToolbar.jsx";
import DropdownMenu, { DropdownMenuItem } from "../../components/ui/DropdownMenu.jsx";

import {
  useGetProductsQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
} from "../../store/productApi.js";
import {
  useGetBrandsQuery,
  useGetCategoriesQuery,
  useGetAttributesQuery,
} from "../../store/shopApi.js";
import { cn, resolveImage } from "../../lib/utils.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useTableQueryState } from "../../hooks/useTableQueryState.js";
import { usePermission } from "../../hooks/usePermission.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { AGE_GROUP_VALUES_LIST, AVAILABILITY_VALUES } from "../../schemas/catalogSchemas.js";

const STEPS = ["Basic info", "Attributes", "Variants"];

const variantSchema = z.object({
  variantName: z.string().min(1, "Required"),
  sku: z.string().min(1, "Required"),
  color: z.string().optional(),
  size: z.string().optional(),
  fabric: z.string().optional(),
  price: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
  discountPrice: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
  stock: z.coerce.number().int().min(0, "Required"),
  images: z.array(z.string()).default([]),
});

const productSchema = z.object({
  name: z.string().min(2, "Required"),
  // Optional Bangla mirror — see models/productModel.js's nameBn/
  // descriptionBn and lib/i18n/localize.js. Left blank, the storefront
  // just falls back to the English name/description; never required here.
  nameBn: z.string().optional(),
  description: z.string().min(10, "At least 10 characters"),
  descriptionBn: z.string().optional(),
  department: z.string().min(1, "Select a department"),
  category: z.string().min(1, "Select a subcategory"),
  brand: z.string().optional(),
  ageGroup: z.enum(AGE_GROUP_VALUES_LIST),
  basePrice: z.coerce.number().positive("Must be > 0"),
  discountPrice: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
  availability: z.enum(AVAILABILITY_VALUES),
  images: z.array(z.string()).min(1, "At least one image"),
  tags: z.string().optional(),
  isFeatured: z.boolean().optional(),
  isActive: z.boolean().optional(),
  heightRange: z.string().optional(),
  chest: z.string().optional(),
  sleeveLength: z.string().optional(),
  includedItems: z.string().optional(),
  variants: z.array(variantSchema).min(1, "At least one variant"),
});

// Fields validated before advancing past each step.
const STEP_FIELDS = [
  ["name", "description", "department", "category", "ageGroup", "basePrice"],
  [],
  ["variants", "images"],
];

export default function AdminProductsPage() {
  const settings = useSettings();
  const can = usePermission();
  const canManage = can(PERMISSIONS.PRODUCTS_MANAGE);
  const [editing, setEditing] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const {
    page, limit, search, sortBy, sortOrder, filters, activeFilterCount,
    setPage, setLimit, setSearch, setSort, setFilter, clearFilters,
  } = useTableQueryState({
    defaultLimit: 20,
    defaultSortBy: "createdAt",
    defaultSortOrder: "desc",
    filterKeys: ["department", "status"],
  });

  const { data: catsData } = useGetCategoriesQuery();
  const departments = (catsData?.categories ?? []).filter((c) => !c.parent);
  const categoryName = (id) => catsData?.categories?.find((c) => c._id === id)?.name || "—";

  const { data, isLoading, isFetching, isError, error, refetch } = useGetProductsQuery({
    page,
    limit,
    search: search || undefined,
    sort: sortBy ? `${sortOrder === "desc" ? "-" : ""}${sortBy}` : undefined,
    topCategory: filters.department || undefined,
    isActive: filters.status || undefined,
  });
  const products = data?.products ?? [];

  const [deleteProduct, { isLoading: deleting }] = useDeleteProductMutation();

  const returnToValidPageIfEmptied = (removedCount) => {
    if (products.length - removedCount <= 0 && page > 1) setPage(page - 1);
  };

  const handleDelete = async () => {
    try {
      await deleteProduct(confirmDelete._id).unwrap();
      toast.success("Product deactivated");
      returnToValidPageIfEmptied(1);
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e?.data?.message || "Could not delete");
    }
  };

  const handleBulkDeactivate = async () => {
    const ids = [...selected];
    try {
      await Promise.all(ids.map((id) => deleteProduct(id).unwrap()));
      toast.success(`${ids.length} product${ids.length === 1 ? "" : "s"} deactivated`);
      returnToValidPageIfEmptied(ids.length);
      setSelected(new Set());
      setBulkConfirm(false);
    } catch (e) {
      toast.error(e?.data?.message || "Some products couldn't be updated");
    }
  };

  const toggleRow = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = (ids, checked) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });

  const columns = [
    {
      key: "name",
      header: "Product",
      sortable: true,
      width: 260,
      render: (p) => (
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-muted">
            {p.images?.[0] && (
              <Image
                src={resolveImage(p.images[0], 80)}
                alt={p.name}
                fill
                sizes="40px"
                loading="lazy"
                className="object-cover"
              />
            )}
          </div>
          <div className="min-w-0">
            <p className="line-clamp-1 font-semibold" title={p.name}>{p.name}</p>
            <p className="text-xs text-muted-foreground capitalize">{p.ageGroup}</p>
          </div>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      hideBelow: "md",
      render: (p) => p.category?.name || categoryName(p.category),
    },
    {
      key: "variants",
      header: "Variants",
      hideBelow: "md",
      render: (p) => p.variants?.length || 0,
    },
    {
      key: "basePrice",
      header: "Price",
      align: "right",
      sortable: true,
      render: (p) => <span data-tabular className="font-bold">{settings.formatPrice(p.basePrice)}</span>,
    },
    {
      key: "stock",
      header: "Stock",
      align: "center",
      hideBelow: "sm",
      render: (p) => {
        const totalStock = (p.variants || []).reduce((s, v) => s + (v.stock || 0), 0);
        const tone = totalStock <= 4 ? "text-danger" : totalStock <= 10 ? "text-warning" : "text-foreground";
        return <span data-tabular className={cn("font-semibold", tone)}>{totalStock}</span>;
      },
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      render: (p) => (
        <>
          {p.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="danger">Inactive</Badge>}
          {p.isFeatured && <Badge variant="accent" className="ml-1">Featured</Badge>}
        </>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: 60,
      render: (p) =>
        canManage && (
          <DropdownMenu triggerLabel={`Actions for ${p.name}`}>
            <DropdownMenuItem icon={Edit2} onClick={() => setEditing(p)}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem icon={Trash2} danger onClick={() => setConfirmDelete(p)}>
              Deactivate
            </DropdownMenuItem>
          </DropdownMenu>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">{data?.total ?? 0} products total</p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Add product
          </Button>
        )}
      </div>

      <TableToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search products…"
        activeFilterCount={activeFilterCount}
        onClearFilters={clearFilters}
        filters={
          <>
            <Select
              value={filters.department || ""}
              onChange={(e) => setFilter("department", e.target.value)}
              className="max-w-[180px]"
              aria-label="Filter by department"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d._id} value={d._id}>{d.name}</option>
              ))}
            </Select>
            <Select
              value={filters.status || ""}
              onChange={(e) => setFilter("status", e.target.value)}
              className="max-w-[150px]"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
          </>
        }
        right={
          canManage &&
          selected.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground">{selected.size} selected</span>
              <Button size="sm" variant="outline" onClick={() => setBulkConfirm(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                Deactivate selected
              </Button>
            </>
          )
        }
      />

      <DataTable
        columns={columns}
        data={products}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        error={error}
        onRetry={refetch}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={setSort}
        selectable={canManage}
        selectedIds={selected}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
        empty={
          search || activeFilterCount > 0
            ? { icon: Search, title: "No matching products", message: "Try a different search or clear filters." }
            : { icon: Package, title: "No products", message: "Create your first product." }
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
        <ProductFormModal
          product={editing}
          onClose={() => {
            setCreateOpen(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={`Deactivate "${confirmDelete?.name}"?`}
        description="The product will be hidden from the store. You can reactivate it later by editing."
        loading={deleting}
      />

      <ConfirmDialog
        open={bulkConfirm}
        onClose={() => setBulkConfirm(false)}
        onConfirm={handleBulkDeactivate}
        title={`Deactivate ${selected.size} product${selected.size === 1 ? "" : "s"}?`}
        description="They'll be hidden from the store. You can reactivate each one later by editing it."
        loading={deleting}
      />
    </div>
  );
}

// =================== PRODUCT FORM (3-step wizard) ===================

function ProductFormModal({ product, onClose }) {
  const isEdit = !!product;
  const [step, setStep] = useState(0);

  const { data: brandsData } = useGetBrandsQuery();
  const { data: catsData } = useGetCategoriesQuery();
  const [createProduct, { isLoading: creating }] = useCreateProductMutation();
  const [updateProduct, { isLoading: updating }] = useUpdateProductMutation();

  // Stable reference across renders when `catsData` is undefined/loading —
  // `catsData?.categories ?? []` would otherwise create a new array every
  // render, invalidating the useMemo at the bottom of this component that
  // depends on `categories` for no real reason.
  const categories = useMemo(() => catsData?.categories ?? [], [catsData]);
  const departments = categories.filter((c) => !c.parent);

  // Editing an existing product: resolve its department from the leaf
  // category so the cascading select starts on the right branch.
  const editLeafCategory = product ? categories.find((c) => c._id === (product.category?._id || product.category)) : null;

  const defaults = product
    ? {
        name: product.name,
        nameBn: product.nameBn || "",
        description: product.description,
        descriptionBn: product.descriptionBn || "",
        department: editLeafCategory?.parent || "",
        category: product.category?._id || product.category,
        brand: product.brand?._id || product.brand || "",
        ageGroup: product.ageGroup || "adult",
        basePrice: product.basePrice,
        discountPrice: product.discountPrice ?? "",
        availability: product.availability || "readyStock",
        images: product.images || [],
        tags: (product.tags || []).join(", "),
        isFeatured: product.isFeatured,
        isActive: product.isActive,
        heightRange: product.measurements?.heightRange || "",
        chest: product.measurements?.chest || "",
        sleeveLength: product.measurements?.sleeveLength || "",
        includedItems: (product.includedItems || []).join(", "),
        variants: (product.variants || []).map((v) => ({
          variantName: v.variantName,
          sku: v.sku,
          color: v.attributes?.color || "",
          size: v.attributes?.size || "",
          fabric: v.attributes?.fabric || "",
          price: v.price ?? "",
          discountPrice: v.discountPrice ?? "",
          stock: v.stock,
          images: v.images || [],
        })),
      }
    : {
        name: "",
        nameBn: "",
        description: "",
        descriptionBn: "",
        department: "",
        category: "",
        brand: "",
        ageGroup: "adult",
        basePrice: "",
        discountPrice: "",
        availability: "readyStock",
        images: [],
        tags: "",
        isFeatured: false,
        isActive: true,
        heightRange: "",
        chest: "",
        sleeveLength: "",
        includedItems: "",
        variants: [{ variantName: "", sku: "", color: "", size: "", fabric: "", price: "", discountPrice: "", stock: 0, images: [] }],
      };

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    trigger,
    formState: { errors },
  } = useForm({ resolver: zodResolver(productSchema), defaultValues: defaults });

  const { fields: variantFields, append: appendVariant, remove: removeVariant, insert: insertVariant } = useFieldArray({
    control,
    name: "variants",
  });

  const department = watch("department");
  const images = watch("images");
  const variants = watch("variants");
  const basePrice = watch("basePrice");

  const subcategories = useMemo(
    () => categories.filter((c) => c.parent === department),
    [categories, department],
  );

  const { data: attrData } = useGetAttributesQuery(department, { skip: !department });
  const attributeDefs = (attrData?.attributes ?? []).filter((d) => !d.derivedFromVariant);
  const colorDef = (attrData?.attributes ?? []).find((d) => d.key === "color");
  const sizeDef = (attrData?.attributes ?? []).find((d) => d.key === "size");
  const fabricDef = (attrData?.attributes ?? []).find((d) => d.key === "fabric");

  // Distinct colors currently used across variant rows — one image group per
  // color, shared by every size/fabric variant of that color (Step 3 design).
  const distinctColors = useMemo(
    () => [...new Set((variants || []).map((v) => v.color).filter(Boolean))],
    [variants],
  );
  const colorImagesKey = (color) => `colorImages.${color}`;
  const [colorImages, setColorImagesState] = useState(() => {
    const map = {};
    for (const v of defaults.variants) {
      if (v.color && v.images?.length) map[v.color] = v.images;
    }
    return map;
  });
  const setColorImages = (color, imgs) => setColorImagesState((m) => ({ ...m, [color]: imgs }));

  const goNext = async () => {
    const ok = await trigger(STEP_FIELDS[step]);
    if (ok) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const duplicateVariant = (index) => {
    const src = variants[index];
    insertVariant(index + 1, { ...src, variantName: `${src.variantName} (copy)`, sku: "" });
  };

  const onSubmit = async (data) => {
    const attributes = attributeDefs
      .map((def) => {
        const raw = data[`attr_${def.key}`];
        const values = Array.isArray(raw) ? raw.filter(Boolean) : raw ? [raw] : [];
        return values.length ? { key: def.key, values } : null;
      })
      .filter(Boolean);

    const body = {
      name: data.name,
      description: data.description,
      category: data.category,
      brand: data.brand || null,
      ageGroup: data.ageGroup,
      basePrice: data.basePrice,
      discountPrice: data.discountPrice === "" ? null : data.discountPrice,
      availability: data.availability,
      images: data.images,
      tags: data.tags ? data.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      includedItems: data.includedItems ? data.includedItems.split(",").map((t) => t.trim()).filter(Boolean) : [],
      measurements: {
        heightRange: data.heightRange || "",
        chest: data.chest || "",
        sleeveLength: data.sleeveLength || "",
      },
      attributes,
      isFeatured: data.isFeatured,
      isActive: data.isActive,
      variants: data.variants.map((v) => ({
        variantName: v.variantName,
        sku: v.sku,
        attributes: { color: v.color || "", size: v.size || "", fabric: v.fabric || "" },
        price: v.price === "" ? null : v.price,
        discountPrice: v.discountPrice === "" ? null : v.discountPrice,
        stock: v.stock,
        images: v.color ? colorImages[v.color] || [] : v.images || [],
      })),
    };

    try {
      if (isEdit) {
        await updateProduct({ id: product._id, ...body }).unwrap();
        toast.success("Product updated");
      } else {
        await createProduct(body).unwrap();
        toast.success("Product created");
      }
      onClose();
    } catch (e) {
      toast.error(e?.data?.message || "Could not save");
    }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit product" : "New product"} size="xl">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(i)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors",
                i === step ? "bg-accent text-accent-foreground" : i < step ? "bg-accent/20 text-accent" : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}
            </button>
            <span className={cn("text-sm", i === step ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {label}
            </span>
            {i < STEPS.length - 1 && <div className="mx-2 h-px w-8 bg-border" />}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-5">
        {step === 0 && (
          <>
            <Input label="Name" error={errors.name?.message} {...register("name")} />
            <Input
              label="Name (Bangla)"
              placeholder="বাংলা নাম (ঐচ্ছিক)"
              hint="Shown on the storefront when Bangla is active. Leave blank to fall back to the English name."
              error={errors.nameBn?.message}
              {...register("nameBn")}
            />
            <Textarea label="Description" rows={3} error={errors.description?.message} {...register("description")} />
            <Textarea
              label="Description (Bangla)"
              rows={3}
              placeholder="বাংলা বিবরণ (ঐচ্ছিক)"
              hint="Shown on the storefront when Bangla is active. Leave blank to fall back to the English description."
              error={errors.descriptionBn?.message}
              {...register("descriptionBn")}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Department"
                error={errors.department?.message}
                {...register("department", {
                  onChange: () => setValue("category", ""),
                })}
              >
                <option value="">Select department</option>
                {departments.map((d) => (
                  <option key={d._id} value={d._id}>{d.name}</option>
                ))}
              </Select>
              <Select label="Subcategory" error={errors.category?.message} disabled={!department} {...register("category")}>
                <option value="">Select subcategory</option>
                {subcategories.map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="Brand (optional)" {...register("brand")}>
                <option value="">None</option>
                {brandsData?.brands?.map((b) => (
                  <option key={b._id} value={b._id}>{b.name}</option>
                ))}
              </Select>
              <Select label="Age group" error={errors.ageGroup?.message} {...register("ageGroup")}>
                <option value="adult">Adult</option>
                <option value="girls">Girls</option>
                <option value="kids">Kids</option>
              </Select>
              <Select label="Availability" {...register("availability")}>
                <option value="readyStock">Ready stock</option>
                <option value="preOrder">Pre-order</option>
                <option value="madeToOrder">Made to order</option>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Base price" type="number" step="0.01" error={errors.basePrice?.message} {...register("basePrice")} />
              <Input label="Discount price (optional)" type="number" step="0.01" {...register("discountPrice")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Height range" placeholder="e.g. 5'2&quot;–5'8&quot;" {...register("heightRange")} />
              <Input label="Chest" placeholder="e.g. M: 38in" {...register("chest")} />
              <Input label="Sleeve length" {...register("sleeveLength")} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Tags" placeholder="comma separated" {...register("tags")} />
              <Input label="Included items (optional)" placeholder="e.g. Abaya, Matching Hijab" {...register("includedItems")} />
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-accent" {...register("isFeatured")} /> Featured
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-accent" {...register("isActive")} /> Active
              </label>
            </div>
          </>
        )}

        {step === 1 && (
          <div className="space-y-4">
            {!department ? (
              <p className="text-sm text-muted-foreground">Pick a department on Step 1 to see its attributes.</p>
            ) : attributeDefs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No extra attributes for this department.</p>
            ) : (
              attributeDefs.map((def) => (
                <AttributeField key={def.key} def={def} register={register} watch={watch} setValue={setValue} />
              ))
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Product images</label>
              <ImageDropzone
                value={images || []}
                onChange={(next) => setValue("images", next, { shouldDirty: true, shouldValidate: true })}
                folder="products"
              />
              {errors.images && <p className="mt-1 text-xs text-danger">{errors.images.message}</p>}
            </div>

            {distinctColors.length > 0 && (
              <div>
                <label className="mb-2 block text-sm font-medium">Images by color</label>
                <p className="mb-2 text-xs text-muted-foreground">
                  Uploaded once per color — shared across every size/fabric variant of that color.
                </p>
                <div className="space-y-3">
                  {distinctColors.map((color) => (
                    <div key={color} className="rounded-lg border border-border p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{color}</p>
                      <ImageDropzone
                        value={colorImages[color] || []}
                        onChange={(next) => setColorImages(color, next)}
                        folder="products/variants"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">Variants</label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => appendVariant({ variantName: "", sku: "", color: "", size: "", fabric: "", price: "", discountPrice: "", stock: 0, images: [] })}
                >
                  <Plus className="h-3 w-3" /> Add variant
                </Button>
              </div>
              {errors.variants?.message && <p className="mb-2 text-xs text-danger">{errors.variants.message}</p>}
              <div className="space-y-3">
                {variantFields.map((field, i) => (
                  <div key={field.id} className="rounded-lg border border-border p-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <ComboField label="Color" def={colorDef} error={errors.variants?.[i]?.color?.message} {...register(`variants.${i}.color`)} />
                      <ComboField label={sizeDef?.label || "Size"} def={sizeDef} error={errors.variants?.[i]?.size?.message} {...register(`variants.${i}.size`)} />
                      <ComboField label="Fabric" def={fabricDef} error={errors.variants?.[i]?.fabric?.message} {...register(`variants.${i}.fabric`)} />
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Input label="Variant name" error={errors.variants?.[i]?.variantName?.message} {...register(`variants.${i}.variantName`)} />
                      <Input label="SKU" error={errors.variants?.[i]?.sku?.message} {...register(`variants.${i}.sku`)} />
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <Input label="Price override" type="number" step="0.01" placeholder={String(basePrice || "")} {...register(`variants.${i}.price`)} />
                      <Input label="Discount override" type="number" step="0.01" {...register(`variants.${i}.discountPrice`)} />
                      <Input label="Stock" type="number" error={errors.variants?.[i]?.stock?.message} {...register(`variants.${i}.stock`)} />
                    </div>
                    <div className="mt-2 flex justify-end gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => duplicateVariant(i)}>
                        <Copy className="h-3.5 w-3.5" /> Duplicate
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => removeVariant(i)} disabled={variantFields.length <= 1}>
                        <Trash2 className="h-3.5 w-3.5 text-danger" /> Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <div>
            {step > 0 && (
              <Button type="button" variant="outline" onClick={goBack}>
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={goNext}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" loading={creating || updating}>{isEdit ? "Update" : "Create"}</Button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}

// One dynamic Step-2 field per AttributeDefinition. Occasion is multi-select
// (a product can suit several occasions); other selects are single-value;
// text renders as a textarea. Values are read back off `attr_<key>` in
// onSubmit above.
function AttributeField({ def, register, watch, setValue }) {
  const fieldName = `attr_${def.key}`;

  if (def.type === "text") {
    return <Textarea label={def.label} rows={2} {...register(fieldName)} />;
  }

  if (def.key === "occasion" || def.type === "boolean") {
    const selected = watch(fieldName) || [];
    return (
      <div>
        <label className="mb-1.5 block text-sm font-medium">{def.label}</label>
        <div className="flex flex-wrap gap-3">
          {def.options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={selected.includes(opt.value)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected, opt.value]
                    : selected.filter((v) => v !== opt.value);
                  setValue(fieldName, next);
                }}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Select label={def.label} {...register(fieldName)}>
      <option value="">Select {def.label.toLowerCase()}</option>
      {def.options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </Select>
  );
}

// Select-with-free-type-escape-hatch for variant color/size/fabric: pick
// from the AttributeDefinition's known options, or type a value that isn't
// in the list yet (e.g. a custom length like "54"). Not a hard enum at the
// schema level, so this stays a suggestion, not a constraint.
function ComboField({ label, def, error, ...field }) {
  const listId = `combo-${field.name}`;
  return (
    <div className="w-full">
      <label className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <input
        list={def ? listId : undefined}
        className={cn(
          "h-11 w-full rounded-lg border border-line bg-elev px-3 text-sm text-ink transition-colors focus-ring hover:border-ink/40",
          error && "border-danger",
        )}
        {...field}
      />
      {def && (
        <datalist id={listId}>
          {def.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </datalist>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
