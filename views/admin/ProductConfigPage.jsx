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
import { Palette, Ruler, Shirt, PackagePlus, Plus, ArrowRight, Layers, X, Edit2, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";

import Button from "../../components/ui/Button.jsx";
import Input from "../../components/ui/Input.jsx";
import Select from "../../components/ui/Select.jsx";
import Modal from "../../components/ui/Modal.jsx";
import Skeleton from "../../components/ui/Skeleton.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import {
  useGetAttributesQuery,
  useCreateAttributeMutation,
  useUpdateAttributeMutation,
  useGetCategoriesQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useDeleteCategoryMutation,
} from "../../store/shopApi.js";
import { isDepartmentCategory } from "../../lib/utils.js";

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

  // Lives at this top level, not inside AddModelModal itself, so its own
  // Modal never renders as a DESCENDANT of another Modal's animated panel
  // — components/ui/Modal.jsx's motion.div carries an inline `transform`
  // once framer-motion has animated it, which becomes a CSS containing
  // block for any `position: fixed` element nested inside it (the confirm
  // dialog would render clipped to the parent modal's box instead of
  // covering the viewport). Same reason views/admin/CategoriesPage.jsx's
  // own category-delete ConfirmDialog lives at its page's top level.
  const [confirmDeleteModel, setConfirmDeleteModel] = useState(null);
  const [deleteCategory, { isLoading: deletingModel }] = useDeleteCategoryMutation();

  const handleDeleteModel = async () => {
    try {
      await deleteCategory(confirmDeleteModel._id).unwrap();
      toast.success("Model deleted");
      setConfirmDeleteModel(null);
    } catch (e) {
      toast.error(e?.data?.message || "Could not delete");
    }
  };

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

        <button
          type="button"
          onClick={() => setOpenKey("model")}
          className="flex flex-col items-start gap-3 rounded-xl border border-border bg-background p-5 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
        >
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <Layers className="h-5 w-5" />
          </span>
          <div>
            <div className="font-semibold">Add Model</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Add a product model under a department — e.g. Burqa: Cape Burqa, Koti Burqa; Hijab: Cotton Hijab, Party Hijab.
            </p>
          </div>
        </button>

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
      {openKey === "model" && (
        <AddModelModal onClose={() => setOpenKey(null)} onRequestDelete={setConfirmDeleteModel} />
      )}

      <ConfirmDialog
        open={!!confirmDeleteModel}
        onClose={() => setConfirmDeleteModel(null)}
        onConfirm={handleDeleteModel}
        title={`Delete "${confirmDeleteModel?.name}"?`}
        description="This cannot be undone. Models with subcategories or products attached can't be deleted until those are reassigned."
        loading={deletingModel}
      />
    </div>
  );
}

function QuickAddOptionModal({ item, attribute, onClose }) {
  const [label, setLabel] = useState("");
  const [labelBn, setLabelBn] = useState("");
  const [swatchHex, setSwatchHex] = useState("#000000");
  // Editable copy of the attribute's existing options — seeded once on
  // mount (this modal remounts fresh each time it opens, since the parent
  // only renders it while openKey is set), mirroring
  // views/admin/CategoriesPage.jsx's AttributeFormModal's own
  // removeOption()/updateOption() pattern for the exact same
  // AttributeDefinition data. A rename saves on blur; a delete saves
  // immediately (there's nothing to "undo" a stray keystroke on, so no
  // separate "Save changes" step for either). `value` (the stable slug
  // product variants reference) is deliberately not editable here —
  // renaming it would silently orphan any variant already using it; the
  // full Attributes manager is where that's exposed, this page stays
  // label-only by design.
  const [editedOptions, setEditedOptions] = useState(attribute?.options ?? []);

  const [createAttribute, { isLoading: creating }] = useCreateAttributeMutation();
  const [updateAttribute, { isLoading: updating }] = useUpdateAttributeMutation();
  const loading = creating || updating;

  const existingOptions = editedOptions;

  const persistOptions = async (nextOptions, onSuccessToast) => {
    if (!attribute) return;
    try {
      await updateAttribute({ id: attribute._id, options: nextOptions }).unwrap();
      onSuccessToast();
    } catch (e) {
      toast.error(e?.data?.message || "Could not update");
    }
  };

  const updateExistingOption = (i, field, value) => {
    const next = editedOptions.map((o, idx) => (idx === i ? { ...o, [field]: value } : o));
    setEditedOptions(next);
    return next;
  };

  const saveExistingOption = (i) => {
    // Blur fires even when nothing changed (just tabbing/clicking through) —
    // skip the request and the toast in that case.
    if (attribute?.options?.[i]?.label === editedOptions[i]?.label) return;
    persistOptions(editedOptions, () => toast.warning(`${editedOptions[i].label} updated`));
  };

  const removeExistingOption = (i) => {
    const removed = editedOptions[i];
    const next = editedOptions.filter((_, idx) => idx !== i);
    setEditedOptions(next);
    persistOptions(next, () => toast.success(`${removed.label} removed`));
  };

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
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              Existing options — edit a label and click away to save, or remove one
            </div>
            <div className="space-y-1.5">
              {existingOptions.map((o, i) => (
                <div
                  key={o.value}
                  className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5"
                >
                  {item.withSwatch && (
                    <input
                      type="color"
                      value={o.swatchHex || "#000000"}
                      onChange={(e) => {
                        // Persist the freshly-computed array directly rather
                        // than going through saveExistingOption() — setState
                        // is async, so a same-handler read of `editedOptions`
                        // right after calling updateExistingOption() would
                        // still see the pre-change value.
                        const next = updateExistingOption(i, "swatchHex", e.target.value);
                        persistOptions(next, () => toast.warning(`${next[i].label} updated`));
                      }}
                      className="h-6 w-8 flex-none cursor-pointer rounded border border-border bg-background p-0.5"
                      aria-label={`${o.label} swatch`}
                    />
                  )}
                  <input
                    value={o.label}
                    onChange={(e) => updateExistingOption(i, "label", e.target.value)}
                    onBlur={() => saveExistingOption(i)}
                    className="min-w-0 flex-1 rounded border-0 bg-transparent px-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    aria-label="Option label"
                  />
                  <button
                    type="button"
                    onClick={() => removeExistingOption(i)}
                    aria-label={`Remove ${o.label}`}
                    className="flex-none rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
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

// A "model" (Cape Burqa, Koti Burqa, Cotton Hijab, ...) is exactly what
// the category system already calls a leaf/style category — a child of a
// department. This is the same create-category operation
// views/admin/CategoriesPage.jsx's CategoryTree already exposes, just a
// focused "pick a department, name the model" form instead of the full
// category tree editor.
function AddModelModal({ onClose, onRequestDelete }) {
  const { data: catsData, isLoading } = useGetCategoriesQuery();
  const allCategories = catsData?.categories ?? [];
  const departments = allCategories.filter((c) => isDepartmentCategory(c, allCategories));

  const [departmentId, setDepartmentId] = useState("");
  const [name, setName] = useState("");
  const [createCategory, { isLoading: saving }] = useCreateCategoryMutation();
  const [updateCategory, { isLoading: renaming }] = useUpdateCategoryMutation();

  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");

  const department = departments.find((d) => d._id === departmentId);
  const existingModels = department ? allCategories.filter((c) => c.parent === department._id) : [];

  const startEditModel = (m) => {
    setEditingId(m._id);
    setEditingName(m.name);
  };

  const cancelEditModel = () => {
    setEditingId(null);
    setEditingName("");
  };

  const saveEditModel = async (m) => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      toast.error("A model name is required");
      return;
    }
    if (trimmed === m.name) {
      cancelEditModel();
      return;
    }
    try {
      await updateCategory({ id: m._id, name: trimmed }).unwrap();
      toast.warning("Model updated");
      cancelEditModel();
    } catch (e) {
      toast.error(e?.data?.message || "Could not update");
    }
  };

  const save = async () => {
    if (!departmentId) {
      toast.error("Pick a department first");
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("A model name is required");
      return;
    }
    try {
      await createCategory({ name: trimmed, parent: departmentId }).unwrap();
      toast.success(`${trimmed} added`);
      onClose();
    } catch (e) {
      toast.error(e?.data?.message || "Could not save");
    }
  };

  return (
    <Modal open onClose={onClose} title="Add Model" size="md">
      <div className="space-y-4 p-5">
        <Select label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} disabled={isLoading}>
          <option value="">Select a department…</option>
          {departments.map((d) => (
            <option key={d._id} value={d._id}>
              {d.name}
            </option>
          ))}
        </Select>

        {department && existingModels.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Existing models under {department.name}</div>
            <div className="space-y-1.5">
              {existingModels.map((m) => (
                <div key={m._id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                  {editingId === m._id ? (
                    <>
                      <input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEditModel(m);
                          if (e.key === "Escape") cancelEditModel();
                        }}
                        autoFocus
                        className="min-w-0 flex-1 rounded border-0 bg-transparent px-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        aria-label="Model name"
                      />
                      <button
                        type="button"
                        onClick={() => saveEditModel(m)}
                        disabled={renaming}
                        aria-label={`Save ${m.name}`}
                        className="flex-none rounded p-1 text-muted-foreground hover:bg-success/10 hover:text-success"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditModel}
                        aria-label="Cancel"
                        className="flex-none rounded p-1 text-muted-foreground hover:bg-muted"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                      <button
                        type="button"
                        onClick={() => startEditModel(m)}
                        aria-label={`Rename ${m.name}`}
                        className="flex-none rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRequestDelete(m)}
                        aria-label={`Delete ${m.name}`}
                        className="flex-none rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <Input
          label="Model name"
          placeholder="e.g. Cape Burqa"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            <Plus className="h-4 w-4" />
            Add Model
          </Button>
        </div>
      </div>
    </Modal>
  );
}
