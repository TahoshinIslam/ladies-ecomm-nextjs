"use client";

import { useMemo, useState } from "react";
import { Folder, Layers, Plus, Edit2, Trash2, ChevronDown, ChevronRight, Search } from "lucide-react";
import { toast } from "sonner";

import Button from "../../components/ui/Button.jsx";
import Input from "../../components/ui/Input.jsx";
import Select from "../../components/ui/Select.jsx";
import Textarea from "../../components/ui/Textarea.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Modal from "../../components/ui/Modal.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import Skeleton from "../../components/ui/Skeleton.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";

import {
  useGetCategoriesQuery,
  useCreateCategoryMutation,
  useUpdateCategoryMutation,
  useDeleteCategoryMutation,
  useGetAttributesQuery,
  useCreateAttributeMutation,
  useUpdateAttributeMutation,
  useDeleteAttributeMutation,
} from "../../store/shopApi.js";
import { cn } from "../../lib/utils.js";

const TABS = [
  { id: "categories", label: "Departments & categories", icon: Folder },
  { id: "attributes", label: "Attributes", icon: Layers },
];

export default function AdminCategoriesPage() {
  const [tab, setTab] = useState("categories");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-black">Categories</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the department/category tree and the fabric, color, occasion,
          and other facets that drive filters across the store.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                tab === t.id
                  ? "border-accent text-accent"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "categories" ? <CategoryTree /> : <AttributeManager />}
    </div>
  );
}

/* =========================================================================
   Departments & categories — the real parent-based hierarchy (parent: null
   = department, parent: <deptId> = subcategory one level deep, enforced by
   services/categoryService.js). Replaces the old isUserGenerated filter,
   which matched a field that never existed on any real category and left
   every one of the 42 seeded categories permanently invisible here.
   ========================================================================= */

function CategoryTree() {
  const { data, isLoading } = useGetCategoriesQuery();
  const categories = data?.categories ?? [];
  const departments = useMemo(() => categories.filter((c) => !c.parent), [categories]);
  const childrenOf = (deptId) => categories.filter((c) => String(c.parent) === String(deptId));

  // Client-side search — the department/category tree is a small, bounded
  // set by design (services/categoryService.js enforces exactly two levels,
  // and the storefront nav/filter chips depend on fetching it whole), so
  // there's no server-side page to request here; filtering the
  // already-loaded tree is the correct scope for this dataset, not a
  // shortcut around a large one.
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const matches = (name) => !term || name.toLowerCase().includes(term);
  const visibleDepartments = useMemo(() => {
    if (!term) return departments;
    return departments.filter((d) => matches(d.name) || childrenOf(d._id).some((c) => matches(c.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments, categories, term]);

  const [expanded, setExpanded] = useState(() => new Set());
  const toggleExpanded = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [editing, setEditing] = useState(null); // category being edited, or {parent} shape to prefill create
  const [createOpen, setCreateOpen] = useState(false);
  const [createParent, setCreateParent] = useState(null); // deptId to create a subcategory under, or null for a new department
  const [confirmDelete, setConfirmDelete] = useState(null);

  const [deleteCategory, { isLoading: deleting }] = useDeleteCategoryMutation();

  const handleDelete = async () => {
    try {
      await deleteCategory(confirmDelete._id).unwrap();
      toast.success("Category deleted");
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e?.data?.message || "Could not delete");
    }
  };

  const openCreate = (parentId) => {
    setCreateParent(parentId);
    setCreateOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          icon={Search}
          placeholder="Search departments or categories…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
          aria-label="Search categories"
        />
        <Button onClick={() => openCreate(null)}>
          <Plus className="h-4 w-4" />
          Add department
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : departments.length === 0 ? (
        <EmptyState icon={Folder} title="No departments yet" message="Add your first department to get started." />
      ) : visibleDepartments.length === 0 ? (
        <EmptyState icon={Search} title="No matches" message="Try a different search." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          {visibleDepartments.map((dept, i) => {
            const kids = childrenOf(dept._id);
            // Force-open a department whose own name didn't match but one
            // of its subcategories did — otherwise the search would hide
            // the very match it just found.
            const isOpen = expanded.has(dept._id) || (!!term && !matches(dept.name));
            return (
              <div key={dept._id} className={cn(i > 0 && "border-t border-border")}>
                <div className="flex items-center gap-2 p-3">
                  <button
                    onClick={() => toggleExpanded(dept._id)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label={isOpen ? "Collapse" : "Expand"}
                    disabled={kids.length === 0}
                  >
                    {kids.length === 0 ? (
                      <span className="inline-block h-4 w-4" />
                    ) : isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{dept.name}</span>
                      {!dept.isActive && <Badge variant="outline">Inactive</Badge>}
                      <span className="text-xs text-muted-foreground">{dept.slug}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {kids.length} subcategor{kids.length === 1 ? "y" : "ies"} · sort {dept.sortOrder ?? 0}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 gap-1">
                    <Button size="sm" variant="outline" onClick={() => openCreate(dept._id)}>
                      <Plus className="h-3 w-3" /> Subcategory
                    </Button>
                    <button
                      onClick={() => setEditing(dept)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Edit"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setConfirmDelete(dept)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {isOpen && kids.length > 0 && (
                  <div className="divide-y divide-border border-t border-border bg-muted/10 pl-9">
                    {kids.map((c) => (
                      <div key={c._id} className="flex items-center gap-2 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{c.name}</span>
                            {!c.isActive && <Badge variant="outline">Inactive</Badge>}
                            <span className="text-xs text-muted-foreground">{c.slug}</span>
                          </div>
                          {c.description && (
                            <p className="line-clamp-1 text-xs text-muted-foreground">{c.description}</p>
                          )}
                        </div>
                        <div className="flex flex-shrink-0 gap-1">
                          <button
                            onClick={() => setEditing(c)}
                            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label="Edit"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setConfirmDelete(c)}
                            className="rounded p-1.5 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(createOpen || editing) && (
        <CategoryFormModal
          category={editing}
          departments={departments}
          defaultParent={createParent}
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
        title={`Delete "${confirmDelete?.name}"?`}
        description="This cannot be undone. Categories with subcategories or products attached can't be deleted until those are reassigned."
        loading={deleting}
      />
    </div>
  );
}

function CategoryFormModal({ category, departments, defaultParent, onClose }) {
  const isEdit = !!category;
  const [name, setName] = useState(category?.name || "");
  const [nameBn, setNameBn] = useState(category?.nameBn || "");
  const [parent, setParent] = useState(category ? category.parent || "" : defaultParent || "");
  const [description, setDescription] = useState(category?.description || "");
  const [descriptionBn, setDescriptionBn] = useState(category?.descriptionBn || "");
  const [sortOrder, setSortOrder] = useState(category?.sortOrder ?? 0);
  const [isActive, setIsActive] = useState(category?.isActive ?? true);

  const [createCategory, { isLoading: creating }] = useCreateCategoryMutation();
  const [updateCategory, { isLoading: updating }] = useUpdateCategoryMutation();
  const loading = creating || updating;

  const save = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    const body = {
      name: name.trim(),
      nameBn: nameBn.trim(),
      parent: parent || null,
      description: description.trim(),
      descriptionBn: descriptionBn.trim(),
      sortOrder: Number(sortOrder) || 0,
      isActive,
    };
    try {
      if (isEdit) {
        await updateCategory({ id: category._id, ...body }).unwrap();
        toast.success("Category updated");
      } else {
        await createCategory(body).unwrap();
        toast.success(parent ? "Subcategory created" : "Department created");
      }
      onClose();
    } catch (e) {
      toast.error(e?.data?.message || "Could not save");
    }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${category.name}` : "Add category"} size="sm">
      <div className="space-y-4 p-5">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Input
          label="Name (Bangla)"
          placeholder="বাংলা নাম (ঐচ্ছিক)"
          hint="Shown on the storefront when Bangla is active. Leave blank to fall back to the English name."
          value={nameBn}
          onChange={(e) => setNameBn(e.target.value)}
        />
        <Select
          label="Department (leave blank for a top-level department)"
          value={parent}
          onChange={(e) => setParent(e.target.value)}
        >
          <option value="">— Top-level department —</option>
          {departments
            .filter((d) => d._id !== category?._id)
            .map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
        </Select>
        <Textarea
          label="Description (optional)"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Textarea
          label="Description (Bangla)"
          rows={2}
          placeholder="বাংলা বিবরণ (ঐচ্ছিক)"
          hint="Shown on the storefront when Bangla is active. Leave blank to fall back to the English description."
          value={descriptionBn}
          onChange={(e) => setDescriptionBn(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Sort order"
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
          <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-accent"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={loading}>
            {isEdit ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* =========================================================================
   Attributes — fabric, color, occasion, coverage, closure, etc. These drive
   the storefront's dynamic filter panel, the PDP variant selectors, and the
   admin product form's Step 2 — previously only editable by hand in Mongo.
   ========================================================================= */

const ATTR_TYPES = ["select", "swatch", "boolean", "text"];

function AttributeManager() {
  const { data, isLoading } = useGetAttributesQuery(); // no category param -> full raw list
  const { data: catsData } = useGetCategoriesQuery();
  const departments = (catsData?.categories ?? []).filter((c) => !c.parent);
  const attributes = data?.attributes ?? [];

  // Same reasoning as CategoryTree: AttributeDefinition is a small, curated
  // set (fabric/color/occasion/etc.) fetched whole because the storefront
  // filter panel and product form both need the complete list — client-side
  // search over that already-loaded set, not server-side pagination.
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const visibleAttributes = term
    ? attributes.filter((a) => a.label.toLowerCase().includes(term) || a.key.toLowerCase().includes(term))
    : attributes;

  const [editing, setEditing] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleteAttribute, { isLoading: deleting }] = useDeleteAttributeMutation();

  const handleDelete = async () => {
    try {
      await deleteAttribute(confirmDelete._id).unwrap();
      toast.success("Attribute deleted");
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e?.data?.message || "Could not delete");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          icon={Search}
          placeholder="Search attributes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
          aria-label="Search attributes"
        />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Add attribute
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : attributes.length === 0 ? (
        <EmptyState icon={Layers} title="No attributes yet" message="Add fabric, color, occasion, or other facets." />
      ) : visibleAttributes.length === 0 ? (
        <EmptyState icon={Search} title="No matches" message="Try a different search." />
      ) : (
        <div className="space-y-2">
          {visibleAttributes.map((a) => (
            <div key={a._id} className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{a.key}</span>
                    <Badge variant="outline">{a.type}</Badge>
                    {a.derivedFromVariant && <Badge variant="accent">from variants</Badge>}
                    {!a.filterable && <Badge variant="outline">not filterable</Badge>}
                    {a.required && <Badge variant="warning">required</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.appliesToCategories?.length
                      ? `Applies to: ${a.appliesToCategories
                          .map((id) => departments.find((d) => d._id === id)?.name || id)
                          .join(", ")}`
                      : "Applies to all departments"}
                  </p>
                  {a.options?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {a.options.map((o) => (
                        <span
                          key={o.value}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
                        >
                          {o.swatchHex && (
                            <span
                              className="h-3 w-3 rounded-full border border-border"
                              style={{ background: o.swatchHex }}
                            />
                          )}
                          {o.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(a)}>
                    <Edit2 className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <button
                    onClick={() => setConfirmDelete(a)}
                    className="rounded-md p-2 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(createOpen || editing) && (
        <AttributeFormModal
          attribute={editing}
          departments={departments}
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
        title={`Delete "${confirmDelete?.label}"?`}
        description="Products already using this attribute keep their stored values, but it stops appearing in filters and the product form."
        loading={deleting}
      />
    </div>
  );
}

function AttributeFormModal({ attribute, departments, onClose }) {
  const isEdit = !!attribute;
  const [key, setKey] = useState(attribute?.key || "");
  const [label, setLabel] = useState(attribute?.label || "");
  const [labelBn, setLabelBn] = useState(attribute?.labelBn || "");
  const [type, setType] = useState(attribute?.type || "select");
  const [options, setOptions] = useState(attribute?.options?.length ? attribute.options : []);
  const [appliesTo, setAppliesTo] = useState(new Set(attribute?.appliesToCategories || []));
  const [filterable, setFilterable] = useState(attribute?.filterable ?? true);
  const [required, setRequired] = useState(attribute?.required ?? false);
  const [sortOrder, setSortOrder] = useState(attribute?.sortOrder ?? 0);

  const [createAttribute, { isLoading: creating }] = useCreateAttributeMutation();
  const [updateAttribute, { isLoading: updating }] = useUpdateAttributeMutation();
  const loading = creating || updating;

  const toggleDept = (id) =>
    setAppliesTo((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addOption = () => setOptions((o) => [...o, { value: "", label: "", labelBn: "", swatchHex: "" }]);
  const updateOption = (i, field, value) =>
    setOptions((o) => o.map((opt, idx) => (idx === i ? { ...opt, [field]: value } : opt)));
  const removeOption = (i) => setOptions((o) => o.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!key.trim() || !label.trim()) {
      toast.error("Key and label are required");
      return;
    }
    const cleanOptions = options
      .filter((o) => o.value.trim() && o.label.trim())
      .map((o) => ({
        value: o.value.trim(),
        label: o.label.trim(),
        labelBn: o.labelBn?.trim() || "",
        swatchHex: o.swatchHex?.trim() || "",
      }));

    const body = {
      label: label.trim(),
      labelBn: labelBn.trim(),
      type,
      options: type === "select" || type === "swatch" ? cleanOptions : [],
      appliesToCategories: [...appliesTo],
      filterable,
      required,
      sortOrder: Number(sortOrder) || 0,
    };
    if (!isEdit) body.key = key.trim();

    try {
      if (isEdit) {
        await updateAttribute({ id: attribute._id, ...body }).unwrap();
        toast.success("Attribute updated");
      } else {
        await createAttribute(body).unwrap();
        toast.success("Attribute created");
      }
      onClose();
    } catch (e) {
      toast.error(e?.data?.message || "Could not save");
    }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${attribute.label}` : "Add attribute"} size="md">
      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Key"
            placeholder="e.g. coverage"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={isEdit}
            hint={isEdit ? "Can't change once created — products already reference it" : undefined}
          />
          <Input label="Label" placeholder="e.g. Coverage" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>

        <Select label="Type" value={type} onChange={(e) => setType(e.target.value)}>
          {ATTR_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>

        {(type === "select" || type === "swatch") && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium">Options</label>
              <Button type="button" size="sm" variant="outline" onClick={addOption}>
                <Plus className="h-3 w-3" /> Add option
              </Button>
            </div>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    placeholder="value"
                    value={opt.value}
                    onChange={(e) => updateOption(i, "value", e.target.value)}
                    className="h-10 w-28 rounded-md border border-border bg-background px-2.5 text-sm"
                  />
                  <input
                    placeholder="Label"
                    value={opt.label}
                    onChange={(e) => updateOption(i, "label", e.target.value)}
                    className="h-10 flex-1 rounded-md border border-border bg-background px-2.5 text-sm"
                  />
                  {type === "swatch" && (
                    <input
                      type="color"
                      value={opt.swatchHex || "#000000"}
                      onChange={(e) => updateOption(i, "swatchHex", e.target.value)}
                      className="h-10 w-12 cursor-pointer rounded-md border border-border bg-background"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    className="rounded-md p-2 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {options.length === 0 && (
                <p className="text-xs text-muted-foreground">No options yet — add at least one.</p>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium">Applies to (blank = every department)</label>
          <div className="flex flex-wrap gap-3">
            {departments.map((d) => (
              <label key={d._id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-accent"
                  checked={appliesTo.has(d._id)}
                  onChange={() => toggleDept(d._id)}
                />
                {d.name}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={filterable} onChange={(e) => setFilterable(e.target.checked)} />
            Filterable
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            Required
          </label>
          <Input label="Sort order" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={loading}>
            {isEdit ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
