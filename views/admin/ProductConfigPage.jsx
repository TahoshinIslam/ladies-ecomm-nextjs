"use client";

// A focused landing page for the everyday catalog-setup tasks — add a
// color, a size, a fabric, or a new product — without making someone
// think in terms of "attribute definitions" first. Under the hood this
// still goes through the exact same AttributeDefinition CRUD as the full
// Attributes manager (views/admin/CategoriesPage.jsx's "Attributes" tab):
// Color/Size/Fabric are just that manager's "color"/"size"/"fabric"
// definitions, and "add a color" appends one option to that definition's
// existing options array rather than creating a whole new attribute.
import { useState } from "react";
import Link from "next/link";
import { Palette, Ruler, Shirt, PackagePlus, Plus, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import Button from "../../components/ui/Button.jsx";
import Input from "../../components/ui/Input.jsx";
import Modal from "../../components/ui/Modal.jsx";
import Skeleton from "../../components/ui/Skeleton.jsx";
import {
  useGetAttributesQuery,
  useCreateAttributeMutation,
  useUpdateAttributeMutation,
} from "../../store/shopApi.js";

// Plain kebab-case slug from a label — "Dusty Rose" -> "dusty-rose" — this
// is the stable `option.value` products' variants reference, never shown
// to a shopper directly (their `label`/`labelBn` is what renders).
function slugifyOptionValue(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const CONFIG_ITEMS = [
  {
    key: "color",
    title: "Add Color",
    description: "Add a new color option — used across product variants.",
    icon: Palette,
    attrLabel: "Color",
    attrType: "swatch",
    withSwatch: true,
  },
  {
    key: "size",
    title: "Add Size",
    description: "Add a new size option — used across product variants.",
    icon: Ruler,
    attrLabel: "Size",
    attrType: "select",
    withSwatch: false,
  },
  {
    key: "fabric",
    title: "Add Fabric",
    description: "Add a new fabric option — used across product variants.",
    icon: Shirt,
    attrLabel: "Fabric",
    attrType: "select",
    withSwatch: false,
  },
];

export default function ProductConfigPage() {
  const [openKey, setOpenKey] = useState(null);
  const { data, isLoading } = useGetAttributesQuery();
  const attributes = data?.attributes ?? [];

  const openItem = CONFIG_ITEMS.find((i) => i.key === openKey);
  const openAttribute = openItem ? attributes.find((a) => a.key === openItem.key) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Product Config</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everyday catalog setup — colors, sizes, fabrics, and new products.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
          : CONFIG_ITEMS.map((item) => {
              const attr = attributes.find((a) => a.key === item.key);
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setOpenKey(item.key)}
                  className="flex flex-col items-start gap-3 rounded-xl border border-border bg-background p-5 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="font-semibold">{item.title}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
                    <p className="mt-2 text-xs font-medium text-muted-foreground">
                      {attr?.options?.length ?? 0} option{attr?.options?.length === 1 ? "" : "s"} today
                    </p>
                  </div>
                </button>
              );
            })}

        <Link
          href="/admin/products"
          className="flex flex-col items-start gap-3 rounded-xl border border-border bg-background p-5 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
        >
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <PackagePlus className="h-5 w-5" />
          </span>
          <div>
            <div className="font-semibold">Add New Product</div>
            <p className="mt-1 text-xs text-muted-foreground">Go to Products to create a new product.</p>
            <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
              Open Products <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </Link>
      </div>

      {openItem && (
        <QuickAddOptionModal
          item={openItem}
          attribute={openAttribute}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  );
}

function QuickAddOptionModal({ item, attribute, onClose }) {
  const [label, setLabel] = useState("");
  const [labelBn, setLabelBn] = useState("");
  const [swatchHex, setSwatchHex] = useState("#000000");

  const [createAttribute, { isLoading: creating }] = useCreateAttributeMutation();
  const [updateAttribute, { isLoading: updating }] = useUpdateAttributeMutation();
  const loading = creating || updating;

  const existingOptions = attribute?.options ?? [];

  const save = async () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      toast.error("A label is required");
      return;
    }
    const value = slugifyOptionValue(trimmedLabel);
    if (!value) {
      toast.error("That label doesn't produce a valid value — try letters or numbers");
      return;
    }
    if (existingOptions.some((o) => o.value === value)) {
      toast.error(`"${trimmedLabel}" already exists`);
      return;
    }

    const newOption = {
      value,
      label: trimmedLabel,
      labelBn: labelBn.trim(),
      swatchHex: item.withSwatch ? swatchHex : "",
    };

    try {
      if (attribute) {
        await updateAttribute({ id: attribute._id, options: [...existingOptions, newOption] }).unwrap();
      } else {
        // The attribute itself doesn't exist yet (unexpected — the seed
        // catalog always creates color/size/fabric — but handled rather
        // than assumed) — create it with sensible defaults, applying to
        // every department (appliesToCategories: []) and this one option.
        await createAttribute({
          key: item.key,
          label: item.attrLabel,
          type: item.attrType,
          derivedFromVariant: true,
          appliesToCategories: [],
          options: [newOption],
        }).unwrap();
      }
      toast.success(`${trimmedLabel} added`);
      onClose();
    } catch (e) {
      toast.error(e?.data?.message || "Could not save");
    }
  };

  return (
    <Modal open onClose={onClose} title={item.title} size="md">
      <div className="space-y-4 p-5">
        {existingOptions.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Existing options</div>
            <div className="flex flex-wrap gap-1.5">
              {existingOptions.map((o) => (
                <span
                  key={o.value}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
                >
                  {o.swatchHex && (
                    <span className="h-3 w-3 rounded-full border border-border" style={{ background: o.swatchHex }} />
                  )}
                  {o.label}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className={item.withSwatch ? "grid gap-3 sm:grid-cols-[1fr_1fr_auto]" : "grid gap-3 sm:grid-cols-2"}>
          <Input
            label="Label"
            placeholder={`e.g. ${item.key === "color" ? "Dusty Rose" : item.key === "size" ? "Medium" : "Cotton"}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
          <Input
            label="Bangla label (optional)"
            placeholder="বাংলা লেবেল"
            value={labelBn}
            onChange={(e) => setLabelBn(e.target.value)}
          />
          {item.withSwatch && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink">Swatch</label>
              <input
                type="color"
                value={swatchHex}
                onChange={(e) => setSwatchHex(e.target.value)}
                className="h-11 w-14 cursor-pointer rounded-lg border border-border bg-background p-1"
                aria-label="Swatch color"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={save} disabled={loading}>
            <Plus className="h-4 w-4" />
            Add {item.attrLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
