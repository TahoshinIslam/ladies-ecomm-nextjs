"use client";

import { useMemo, useState } from "react";
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
import Skeleton from "../../components/ui/Skeleton.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import ImageDropzone from "../../components/admin/ImageDropzone.jsx";

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
import { formatCurrency, cn } from "../../lib/utils.js";

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
  description: z.string().min(10, "At least 10 characters"),
  department: z.string().min(1, "Select a department"),
  category: z.string().min(1, "Select a subcategory"),
  brand: z.string().optional(),
  ageGroup: z.enum(["adult", "kids"]),
  basePrice: z.coerce.number().positive("Must be > 0"),
  discountPrice: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
  availability: z.enum(["readyStock", "preOrder", "madeToOrder"]),
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
  const [searchQuery, setSearchQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const { data, isLoading } = useGetProductsQuery({
    limit: 50,
    ...(searchQuery ? { search: searchQuery } : {}),
  });
  const { data: catsData } = useGetCategoriesQuery();
  const [deleteProduct, { isLoading: deleting }] = useDeleteProductMutation();
  const products = data?.products ?? [];
  const categoryName = (id) => catsData?.categories?.find((c) => c._id === id)?.name || "—";

  const handleDelete = async () => {
    try {
      await deleteProduct(confirmDelete._id).unwrap();
      toast.success("Product deactivated");
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e?.data?.message || "Could not delete");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">{data?.total || 0} products total</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Add product
        </Button>
      </div>

      <Input
        icon={Search}
        placeholder="Search products..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="max-w-sm"
      />

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <EmptyState icon={Package} title="No products" message="Create your first product." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-3 text-left">Product</th>
                <th className="hidden p-3 text-left md:table-cell">Category</th>
                <th className="hidden p-3 text-left md:table-cell">Variants</th>
                <th className="p-3 text-right">Price</th>
                <th className="hidden p-3 text-center sm:table-cell">Stock</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.map((p) => {
                const totalStock = (p.variants || []).reduce((s, v) => s + (v.stock || 0), 0);
                const stockTone =
                  totalStock <= 4
                    ? "bg-danger/10 hover:bg-danger/15"
                    : totalStock <= 10
                    ? "bg-warning/10 hover:bg-warning/15"
                    : "hover:bg-muted/20";
                const stockTextTone =
                  totalStock <= 4 ? "text-danger" : totalStock <= 10 ? "text-warning" : "text-foreground";
                return (
                  <tr key={p._id} className={cn("transition-colors", stockTone)}>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                          {p.images?.[0] && (
                            <img src={p.images[0]} alt={p.name} className="h-full w-full object-cover" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="line-clamp-1 font-semibold">{p.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{p.ageGroup}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden p-3 text-muted-foreground md:table-cell">
                      {p.category?.name || categoryName(p.category)}
                    </td>
                    <td className="hidden p-3 text-muted-foreground md:table-cell">
                      {p.variants?.length || 0}
                    </td>
                    <td className="p-3 text-right font-bold">{formatCurrency(p.basePrice)}</td>
                    <td className="hidden p-3 text-center sm:table-cell">
                      <span className={cn("text-sm font-semibold", stockTextTone)}>{totalStock}</span>
                    </td>
                    <td className="p-3 text-center">
                      {p.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="danger">Inactive</Badge>}
                      {p.isFeatured && <Badge variant="accent" className="ml-1">Featured</Badge>}
                    </td>
                    <td className="p-3 text-right">
                      <div className="inline-flex gap-1">
                        <button onClick={() => setEditing(p)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Edit">
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button onClick={() => setConfirmDelete(p)} className="rounded p-1.5 text-muted-foreground hover:bg-danger/10 hover:text-danger" aria-label="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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

  const categories = catsData?.categories ?? [];
  const departments = categories.filter((c) => !c.parent);

  // Editing an existing product: resolve its department from the leaf
  // category so the cascading select starts on the right branch.
  const editLeafCategory = product ? categories.find((c) => c._id === (product.category?._id || product.category)) : null;

  const defaults = product
    ? {
        name: product.name,
        description: product.description,
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
        description: "",
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
            <Textarea label="Description" rows={3} error={errors.description?.message} {...register("description")} />
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
