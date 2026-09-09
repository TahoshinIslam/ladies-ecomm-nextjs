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
import { cn, isDepartmentCategory, categoryDepth } from "../../lib/utils.js";

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
   Departments & categories — the real parent-based hierarchy. Up to 3
   levels: a root/division (parent: null, e.g. Clothes or Cosmetics) ->
   a department (Burqa under Clothes, or Cosmetics itself) -> a leaf/style
   (enforced by services/categoryService.js's validateParent). Rendered
   recursively so any depth the data actually has shows up, rather than
   hardcoding "departments, then their direct children" as the only two
   renderable levels.
   ========================================================================= */

function CategoryTree() {
  const { data, isLoading } = useGetCategoriesQuery();
  // Stable reference across renders when `data` is undefined/loading —
  // `data?.categories ?? []` would otherwise create a new array every
  // render, invalidating the memos below for no real reason.
  const categories = useMemo(() => data?.categories ?? [], [data]);
  const roots = useMemo(() => categories.filter((c) => !c.parent), [categories]);
  const childrenOf = (parentId) => categories.filter((c) => String(c.parent) === String(parentId));

  // Client-side search — the category tree is a small, bounded set by
  // design (services/categoryService.js caps depth at 3, and the
  // storefront nav/filter chips depend on fetching it whole), so there's no
  // server-side page to request here; filtering the already-loaded tree is
  // the correct scope for this dataset, not a shortcut around a large one.
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const matches = (name) => !term || name.toLowerCase().includes(term);
  // A subtree matches if its own name matches, or any descendant's does.
  const subtreeMatches = (category) => {
    if (matches(category.name)) return true;
    return childrenOf(category._id).some((c) => subtreeMatches(c));
  };
  const visibleRoots = useMemo(() => {
    if (!term) return roots;
    return roots.filter((r) => subtreeMatches(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, categories, term]);

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
      ) : roots.length === 0 ? (
        <EmptyState icon={Folder} title="No departments yet" message="Add your first department to get started." />
      ) : visibleRoots.length === 0 ? (
        <EmptyState icon={Search} title="No matches" message="Try a different search." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          {visibleRoots.map((root, i) => (
            <div key={root._id} className={cn(i > 0 && "border-t border-border")}>
              <CategoryNode
                category={root}
                depth={0}
                categories={categories}
                childrenOf={childrenOf}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
                term={term}
                matches={matches}
                subtreeMatches={subtreeMatches}
                onEdit={setEditing}
                onDelete={setConfirmDelete}
                onAddChild={openCreate}
              />
            </div>
          ))}
        </div>
      )}

      {(createOpen || editing) && (
        <CategoryFormModal
          category={editing}
          categories={categories}
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

// One row of the tree, rendering itself then recursing into its own
// children — replaces the old hardcoded "departments, then their direct
// children" two-tier JSX so a 3rd level (e.g. Burqa's styles, under
// Clothes) renders and is manageable the same way any other level is,
// instead of silently having no UI at all.
function CategoryNode({
  category,
  depth,
  categories,
  childrenOf,
  expanded,
  toggleExpanded,
  term,
  matches,
  subtreeMatches,
  onEdit,
  onDelete,
  onAddChild,
}) {
  const kids = childrenOf(category._id);
  // Force-open a node whose own name didn't match but a descendant's did —
  // otherwise the search would hide the very match it just found.
  const isOpen = expanded.has(category._id) || (!!term && !matches(category.name));
  // Matches services/categoryService.js's validateParent cap (3 levels
  // total, depth 0/1/2) — a depth-2 node adding a child would be a 4th
  // level, which the server rejects, so don't offer the dead-end action.
  const canAddChild = categoryDepth(category, categories) < 2;

  return (
    <div>
      <div className="flex items-center gap-2 p-3" style={{ paddingLeft: `${12 + depth * 28}px` }}>
        <button
          onClick={() => toggleExpanded(category._id)}
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
            <span className={depth === 0 ? "font-semibold" : "font-medium"}>{category.name}</span>
            {!category.isActive && <Badge variant="outline">Inactive</Badge>}
            <span className="text-xs text-muted-foreground">{category.slug}</span>
          </div>
          {depth === 0 ? (
            <p className="text-xs text-muted-foreground">
              {kids.length} subcategor{kids.length === 1 ? "y" : "ies"} · sort {category.sortOrder ?? 0}
            </p>
          ) : (
            category.description && <p className="line-clamp-1 text-xs text-muted-foreground">{category.description}</p>
          )}
        </div>
        <div className="flex flex-shrink-0 gap-1">
          {canAddChild && (
            <Button size="sm" variant="outline" onClick={() => onAddChild(category._id)}>
              <Plus className="h-3 w-3" /> Subcategory
            </Button>
          )}
          <button
            onClick={() => onEdit(category)}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Edit"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(category)}
            className="rounded p-1.5 text-muted-foreground hover:bg-danger/10 hover:text-danger"
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isOpen && kids.length > 0 && (
        <div className="divide-y divide-border border-t border-border bg-muted/10">
          {kids
            .filter((c) => !term || subtreeMatches(c))
            .map((c) => (
              <CategoryNode
                key={c._id}
                category={c}
                depth={depth + 1}
                categories={categories}
                childrenOf={childrenOf}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
                term={term}
                matches={matches}
                subtreeMatches={subtreeMatches}
                onEdit={onEdit}
                onDelete={onDelete}
                onAddChild={onAddChild}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function CategoryFormModal({ category, categories, defaultParent, onClose }) {
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

  // A category can be a parent as long as its own depth is < 2 — matches
  // services/categoryService.js's validateParent cap (3 levels total), so
  // both a root (Cosmetics) and a department (Burqa, itself under Clothes)
  // are valid choices, but a leaf/style is not.
  const parentOptions = categories.filter((c) => c._id !== category?._id && categoryDepth(c, categories) < 2);

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
          label="Parent category (leave blank for a top-level department/division)"
          value={parent}
          onChange={(e) => setParent(e.target.value)}
        >
          <option value="">— Top-level —</option>
          {parentOptions.map((d) => (
            <option key={d._id} value={d._id}>
              {"— ".repeat(categoryDepth(d, categories))}
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
  const allCategories = catsData?.categories ?? [];
  // Must be real department ids — the only ids Product.topCategory (and so
  // AttributeDefinition.appliesToCategories) ever equals — never a division
  // like Clothes, which no product's topCategory is ever set to.
  const departments = allCategories.filter((c) => isDepartmentCategory(c, allCategories));
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
