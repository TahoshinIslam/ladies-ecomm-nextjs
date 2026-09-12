"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
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
  Wand2,
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
import { cn, resolveImage, isDepartmentCategory } from "../../lib/utils.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useTableQueryState } from "../../hooks/useTableQueryState.js";
import { usePermission } from "../../hooks/usePermission.js";
import { PERMISSIONS } from "../../lib/permissions.js";
import { AGE_GROUP_VALUES_LIST, AVAILABILITY_VALUES } from "../../schemas/catalogSchemas.js";

const variantSchema = z.object({
  variantName: z.string().min(1, "Required"),
  sku: z.string().min(1, "Required"),
  // Arbitrary key/value bag (color/size/fabric for clothing, shade/
  // volumeMl for cosmetics, ...) driven by AttributeDefinition.derivedFromVariant
  // — see the dynamic ComboField rendering in step 2 below.
  attributes: z.record(z.string()).default({}),
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
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  metaKeywords: z.string().optional(),
  ogImage: z.string().optional(),
});

export default function AdminProductsPage() {
  const settings = useSettings();
  const can = usePermission();
  const canManage = can(PERMISSIONS.PRODUCTS_MANAGE);
  const [editing, setEditing] = useState(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  // Lets views/admin/ProductConfigPage.jsx's "Add New Product" card link
  // straight to /admin/products?new=1 and have the create form actually
  // open — previously that link only navigated here and left the admin to
  // find and click "Add product" themselves, which read as "the form
  // doesn't open at all." Reads the param once, lazily, then strips it
  // from the URL so a refresh or the back button doesn't reopen it.
  const [createOpen, setCreateOpen] = useState(() => searchParams.get("new") === "1");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [selected, setSelected] = useState(new Set());

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      router.replace("/admin/products", { scroll: false });
    }
    // Only ever needs to run once, right after the lazy createOpen
    // initializer above already consumed the param — re-running on every
    // searchParams identity change would fight any other filter/query
    // this page might gain later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const allCategories = catsData?.categories ?? [];
  const departments = allCategories.filter((c) => isDepartmentCategory(c, allCategories));
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
                className="object-contain"
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

// =================== PRODUCT FORM (single page) ===================

function ProductFormModal({ product, onClose }) {
  const isEdit = !!product;

  const { data: brandsData } = useGetBrandsQuery();
  const { data: catsData } = useGetCategoriesQuery();
  const [createProduct, { isLoading: creating }] = useCreateProductMutation();
  const [updateProduct, { isLoading: updating }] = useUpdateProductMutation();

  // Stable reference across renders when `catsData` is undefined/loading —
  // `catsData?.categories ?? []` would otherwise create a new array every
  // render, invalidating the useMemo at the bottom of this component that
  // depends on `categories` for no real reason.
  const categories = useMemo(() => catsData?.categories ?? [], [catsData]);
  const departments = categories.filter((c) => isDepartmentCategory(c, categories));

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
          attributes: { ...v.attributes },
          price: v.price ?? "",
          discountPrice: v.discountPrice ?? "",
          stock: v.stock,
          images: v.images || [],
        })),
        metaTitle: product.metaTitle || "",
        metaDescription: product.metaDescription || "",
        metaKeywords: product.metaKeywords || "",
        ogImage: product.ogImage || "",
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
        variants: [{ variantName: "", sku: "", attributes: {}, price: "", discountPrice: "", stock: 0, images: [] }],
        metaTitle: "",
        metaDescription: "",
        metaKeywords: "",
        ogImage: "",
      };

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
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
  // Variant-identity fields for this department — color/size/fabric for
  // clothing, shade/volumeMl for cosmetics, ... — driven entirely by
  // AttributeDefinition.derivedFromVariant so a new department needs no
  // change here, only new AttributeDefinition documents.
  const variantAttrDefs = (attrData?.attributes ?? []).filter((d) => d.derivedFromVariant);
  // The first swatch-type variant-identity field (color for clothing, shade
  // for cosmetics) drives the "images grouped by X" step below, if this
  // department has one at all — departments with no swatch field (e.g. a
  // shoe-size-only footwear line) simply skip that grouping.
  const swatchDef = variantAttrDefs.find((d) => d.type === "swatch");
  const swatchKey = swatchDef?.key;

  // Distinct swatch values currently used across variant rows — one image
  // group per value, shared by every other-axis variant of that value
  // (Step 3 design).
  const distinctSwatchValues = useMemo(
    () => (swatchKey ? [...new Set((variants || []).map((v) => v.attributes?.[swatchKey]).filter(Boolean))] : []),
    [variants, swatchKey],
  );
  const [colorImages, setColorImagesState] = useState(() => {
    const map = {};
    for (const v of defaults.variants) {
      const swatchValue = swatchKey ? v.attributes?.[swatchKey] : null;
      if (swatchValue && v.images?.length) map[swatchValue] = v.images;
    }
    return map;
  });
  const setColorImages = (value, imgs) => setColorImagesState((m) => ({ ...m, [value]: imgs }));

  const duplicateVariant = (index) => {
    const src = variants[index];
    insertVariant(index + 1, { ...src, variantName: `${src.variantName} (copy)`, sku: "" });
  };

  // Bulk price/stock edit for the variant table, tracked by useFieldArray's
  // own stable `field.id` (never a raw index — removing/inserting rows
  // shifts indices, but never the id a row was selected under).
  const [selectedVariantIds, setSelectedVariantIds] = useState(() => new Set());
  const toggleVariantSelected = (fieldId) =>
    setSelectedVariantIds((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
  const applyToSelectedVariants = (fn) => {
    variantFields.forEach((field, i) => {
      if (!selectedVariantIds.has(field.id)) return;
      const patch = fn(variants[i]);
      for (const [key, value] of Object.entries(patch)) {
        setValue(`variants.${i}.${key}`, value, { shouldDirty: true });
      }
    });
  };

  // Cartesian product of the checked option values across every
  // variant-identity axis (color/size/fabric, ...) that has at least one
  // value checked — axes with nothing checked are simply not part of the
  // combination, so picking only Color still generates one row per color.
  // Combos matching an attribute signature already present among the
  // existing variant rows are skipped (never a silent duplicate).
  const generateVariants = (axisSelections) => {
    const axes = variantAttrDefs
      .map((def) => ({ def, values: def.options.filter((o) => axisSelections[def.key]?.has(o.value)) }))
      .filter((a) => a.values.length > 0);
    if (axes.length === 0) return 0;

    let combos = [{}];
    for (const axis of axes) {
      const next = [];
      for (const combo of combos) {
        for (const opt of axis.values) next.push({ ...combo, [axis.def.key]: opt });
      }
      combos = next;
    }

    const signature = (attrs) =>
      JSON.stringify(Object.keys(attrs).sort().map((k) => [k, attrs[k]]));
    const existingSignatures = new Set((variants || []).map((v) => signature(v.attributes || {})));

    let added = 0;
    for (const combo of combos) {
      const attributes = {};
      const nameParts = [];
      for (const key of Object.keys(combo)) {
        attributes[key] = combo[key].value;
        nameParts.push(combo[key].label);
      }
      const sig = signature(attributes);
      if (existingSignatures.has(sig)) continue;
      existingSignatures.add(sig);
      appendVariant({
        variantName: nameParts.join(" / "),
        sku: "",
        attributes,
        price: "",
        discountPrice: "",
        stock: 0,
        images: [],
      });
      added++;
    }
    return added;
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
      metaTitle: data.metaTitle || "",
      metaDescription: data.metaDescription || "",
      metaKeywords: data.metaKeywords || "",
      ogImage: data.ogImage || "",
      variants: data.variants.map((v) => {
        const swatchValue = swatchKey ? v.attributes?.[swatchKey] : null;
        return {
          variantName: v.variantName,
          sku: v.sku,
          attributes: { ...v.attributes },
          price: v.price === "" ? null : v.price,
          discountPrice: v.discountPrice === "" ? null : v.discountPrice,
          stock: v.stock,
          images: swatchValue ? colorImages[swatchValue] || [] : v.images || [],
        };
      }),
    };

    try {
      if (isEdit) {
        await updateProduct({ id: product._id, ...body }).unwrap();
        toast.warning("Product updated");
      } else {
        await createProduct(body).unwrap();
        toast.success("Product created");
      }
      onClose();
    } catch (e) {
      toast.error(e?.data?.message || "Could not save");
    }
  };

  const previewTitle = watch("metaTitle") || watch("name") || "Product title";
  const previewDesc = watch("metaDescription") || watch("description") || "Product description will appear here…";

  return (
    <Modal open onClose={onClose} title={isEdit ? "Edit product" : "New product"} size="xl">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 p-5">
        <FormSection title="Basic info" defaultOpen>
          <div className="space-y-4">
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
          </div>
        </FormSection>

        <FormSection title="Attributes" defaultOpen>
          <div className="space-y-4">
            {!department ? (
              <p className="text-sm text-muted-foreground">Pick a department above to see its attributes.</p>
            ) : attributeDefs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No extra attributes for this department.</p>
            ) : (
              attributeDefs.map((def) => (
                <AttributeField key={def.key} def={def} register={register} watch={watch} setValue={setValue} />
              ))
            )}
          </div>
        </FormSection>

        <FormSection title="Images" defaultOpen>
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

            {distinctSwatchValues.length > 0 && (
              <div>
                <label className="mb-2 block text-sm font-medium">Images by {swatchDef?.label?.toLowerCase() || "swatch"}</label>
                <p className="mb-2 text-xs text-muted-foreground">
                  Uploaded once per {swatchDef?.label?.toLowerCase() || "value"} — shared across every other variant of that value.
                </p>
                <div className="space-y-3">
                  {distinctSwatchValues.map((value) => (
                    <div key={value} className="rounded-lg border border-border p-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{value}</p>
                      <ImageDropzone
                        value={colorImages[value] || []}
                        onChange={(next) => setColorImages(value, next)}
                        folder="products/variants"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </FormSection>

        <FormSection title="Variants & pricing" defaultOpen>
          <div className="space-y-4">
            {variantAttrDefs.length === 0 ? (
              <p className="text-xs text-muted-foreground">Pick a department above to see its variant fields.</p>
            ) : (
              <VariantGenerator variantAttrDefs={variantAttrDefs} onGenerate={generateVariants} />
            )}

            {selectedVariantIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3">
                <strong className="text-xs">{selectedVariantIds.size} selected:</strong>
                <BulkField placeholder="Price" onApply={(v) => applyToSelectedVariants(() => ({ price: v }))} />
                <BulkField
                  placeholder="Stock"
                  onApply={(v) => applyToSelectedVariants(() => ({ stock: v }))}
                />
                <BulkField
                  placeholder="%"
                  width="w-16"
                  buttonLabel="+%"
                  onApply={(v) =>
                    applyToSelectedVariants((row) => {
                      const pct = Number(v);
                      const base = Number(row.price) || basePrice || 0;
                      return pct ? { price: String(Math.round(base * (1 + pct / 100))) } : {};
                    })
                  }
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Variant rows</label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => appendVariant({ variantName: "", sku: "", attributes: {}, price: "", discountPrice: "", stock: 0, images: [] })}
              >
                <Plus className="h-3 w-3" /> Add variant manually
              </Button>
            </div>
            {errors.variants?.message && <p className="text-xs text-danger">{errors.variants.message}</p>}
            <div className="space-y-3">
              {variantFields.map((field, i) => (
                <div key={field.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-3 h-4 w-4 accent-accent"
                      checked={selectedVariantIds.has(field.id)}
                      onChange={() => toggleVariantSelected(field.id)}
                      aria-label="Select variant for bulk edit"
                    />
                    <div className="flex-1 space-y-2">
                      <div className={cn("grid gap-2", variantAttrDefs.length ? "sm:grid-cols-3" : "")}>
                        {variantAttrDefs.map((def) => (
                          <ComboField
                            key={def.key}
                            label={def.label}
                            def={def}
                            error={errors.variants?.[i]?.attributes?.[def.key]?.message}
                            {...register(`variants.${i}.attributes.${def.key}`)}
                          />
                        ))}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input label="Variant name" error={errors.variants?.[i]?.variantName?.message} {...register(`variants.${i}.variantName`)} />
                        <Input label="SKU" error={errors.variants?.[i]?.sku?.message} {...register(`variants.${i}.sku`)} />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Input label="Price override" type="number" step="0.01" placeholder={String(basePrice || "")} {...register(`variants.${i}.price`)} />
                        <Input label="Discount override" type="number" step="0.01" {...register(`variants.${i}.discountPrice`)} />
                        <Input label="Stock" type="number" error={errors.variants?.[i]?.stock?.message} {...register(`variants.${i}.stock`)} />
                      </div>
                      <div className="flex justify-end gap-1">
                        <Button type="button" size="sm" variant="ghost" onClick={() => duplicateVariant(i)}>
                          <Copy className="h-3.5 w-3.5" /> Duplicate
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => removeVariant(i)} disabled={variantFields.length <= 1}>
                          <Trash2 className="h-3.5 w-3.5 text-danger" /> Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </FormSection>

        <FormSection title="SEO">
          <div className="space-y-4">
            <Input
              label="Meta title"
              placeholder="Custom SEO title (leave empty to use product name)"
              {...register("metaTitle")}
            />
            <Textarea
              label="Meta description"
              rows={3}
              placeholder="Custom SEO description (leave empty to use product description)"
              {...register("metaDescription")}
            />
            <Input
              label="SEO keywords"
              placeholder="Comma-separated, e.g. abaya, modest fashion, nida"
              {...register("metaKeywords")}
            />
            <Input
              label="OG image URL (optional)"
              placeholder="Leave empty to use the product's first image"
              {...register("ogImage")}
            />
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="mb-1 text-xs font-medium text-muted-foreground">SEO preview</div>
              <div className="truncate text-sm font-medium text-accent">{previewTitle}</div>
              <div className="truncate text-xs text-muted-foreground">
                {typeof window !== "undefined" ? window.location.host : "tahos.store"}/product/{product?.slug || "…"}
              </div>
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{previewDesc}</div>
            </div>
          </div>
        </FormSection>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={creating || updating}>{isEdit ? "Update" : "Create"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// A collapsible section of the single-page product form — replaces the old
// 3-step wizard (Basic info / Attributes / Variants), which required
// clicking "Next" twice before an admin could even see the variant table.
// Every section is visible and independently collapsible instead.
function FormSection({ title, defaultOpen = false, children }) {
  return (
    <details className="rounded-lg border border-border" open={defaultOpen}>
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-foreground">
        {title}
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}

// Pick which values of each variant-identity attribute (color/size/fabric,
// ...) to combine, then generate one variant row per combination — instead
// of manually adding and filling in each color/size pair one at a time.
// Axes with nothing checked simply don't participate (checking only Color
// generates one row per color, with every other axis left unset).
function VariantGenerator({ variantAttrDefs, onGenerate }) {
  const [selections, setSelections] = useState({});

  const toggleValue = (key, value) =>
    setSelections((prev) => {
      const set = new Set(prev[key] || []);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return { ...prev, [key]: set };
    });

  const handleGenerate = () => {
    const added = onGenerate(selections);
    if (added > 0) toast.success(`${added} variant${added === 1 ? "" : "s"} generated`);
    else toast.error("Pick at least one value, and check they aren't already added");
  };

  return (
    <div className="rounded-lg border border-dashed border-border p-3">
      <p className="mb-1 text-sm font-medium">Generate variants</p>
      <p className="mb-3 text-xs text-muted-foreground">
        Check which {variantAttrDefs.map((d) => d.label.toLowerCase()).join(" / ")} to combine — every combination becomes a
        ready-to-price variant row below.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {variantAttrDefs.map((def) => (
          <div key={def.key}>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{def.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {def.options.map((opt) => {
                const checked = !!selections[def.key]?.has(opt.value);
                return (
                  <label
                    key={opt.value}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                      checked ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:border-ink/30",
                    )}
                  >
                    <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleValue(def.key, opt.value)} />
                    {opt.swatchHex && (
                      <span className="h-2.5 w-2.5 rounded-full border border-border" style={{ background: opt.swatchHex }} />
                    )}
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" className="mt-3" onClick={handleGenerate}>
        <Wand2 className="h-3.5 w-3.5" /> Generate variants
      </Button>
    </div>
  );
}

// One inline "type a value, apply to every selected variant row" control
// for the bulk-edit toolbar (Set price / Set stock / +% price).
function BulkField({ placeholder, width = "w-24", buttonLabel, onApply }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className={cn("h-8 rounded-md border border-border bg-background px-2 text-xs", width)}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          if (value === "") return;
          onApply(value);
        }}
      >
        {buttonLabel || `Set ${placeholder?.toLowerCase()}`}
      </Button>
    </div>
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
  const inputId = `combo-field-${field.name}`;
  return (
    <div className="w-full">
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      <input
        id={inputId}
        list={def ? listId : undefined}
        aria-invalid={error ? true : undefined}
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
