"use client";

import { useState } from "react";
import { Folder, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import Button from "../../components/ui/Button.jsx";
import Input from "../../components/ui/Input.jsx";
import Modal from "../../components/ui/Modal.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import Skeleton from "../../components/ui/Skeleton.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";

import {
  useGetCategoriesQuery,
  useCreateCategoryMutation,
  useDeleteCategoryMutation,
} from "../../store/shopApi.js";
import { formatDate } from "../../lib/utils.js";

const slugify = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export default function AdminCategoriesPage() {
  const { data, isLoading } = useGetCategoriesQuery();
  const categories = (data?.categories ?? []).filter((c) => c.isUserGenerated);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const [createCategory, { isLoading: creating }] = useCreateCategoryMutation();
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black">Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {categories.length} custom categories
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Add category
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <EmptyState
          icon={Folder}
          title="No custom categories"
          message="Add a category to organize your products."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-3 text-left">Name</th>
                <th className="hidden p-3 text-left sm:table-cell">Slug</th>
                <th className="hidden p-3 text-left md:table-cell">Added</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {categories.map((c) => (
                <tr key={c._id} className="hover:bg-muted/20">
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="hidden p-3 text-muted-foreground sm:table-cell">
                    {c.slug}
                  </td>
                  <td className="hidden p-3 text-muted-foreground md:table-cell">
                    {formatDate(c.createdAt)}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => setConfirmDelete(c)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <CreateCategoryModal
          onClose={() => setCreateOpen(false)}
          onSave={async (name) => {
            try {
              await createCategory({
                name,
                slug: slugify(name),
                isUserGenerated: true,
              }).unwrap();
              toast.success("Category created");
              setCreateOpen(false);
            } catch (e) {
              toast.error(e?.data?.message || "Could not create");
            }
          }}
          loading={creating}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={`Delete "${confirmDelete?.name}"?`}
        description="This cannot be undone. Products using this category must be reassigned first."
        loading={deleting}
      />
    </div>
  );
}

function CreateCategoryModal({ onClose, onSave, loading }) {
  const [name, setName] = useState("");

  return (
    <Modal open onClose={onClose} title="Add category" size="sm">
      <div className="space-y-4 p-5">
        <Input
          label="Name"
          placeholder="e.g. Limited Edition"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onSave(name.trim())}
            loading={loading}
            disabled={!name.trim()}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

