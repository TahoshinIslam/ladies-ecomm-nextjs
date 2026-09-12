"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Edit2,
  Trash2,
  Package,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import Select from "../../components/ui/Select.jsx";
import Button from "../../components/ui/Button.jsx";
import Badge from "../../components/ui/Badge.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import DataTable from "../../components/admin/DataTable.jsx";
import TableToolbar from "../../components/admin/TableToolbar.jsx";
import DropdownMenu, { DropdownMenuItem } from "../../components/ui/DropdownMenu.jsx";

import { useGetProductsQuery, useDeleteProductMutation } from "../../store/productApi.js";
import { useGetCategoriesQuery } from "../../store/shopApi.js";
import { cn, resolveImage, isDepartmentCategory } from "../../lib/utils.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useTableQueryState } from "../../hooks/useTableQueryState.js";
import { usePermission } from "../../hooks/usePermission.js";
import { PERMISSIONS } from "../../lib/permissions.js";

// The single largest chunk of this page's client JS (variant generator,
// image dropzone, attribute fields, SEO preview, ...) — only ever rendered
// once an admin actually opens "New product" or edits a row (see
// `{(createOpen || editing) && <ProductFormModal/>}` below), so it has no
// reason to be part of this list page's own initial bundle. `ssr: false`
// is safe: this modal only ever appears from a client interaction, never
// on a page's first server-rendered paint.
const ProductFormModal = dynamic(() => import("../../components/admin/ProductFormModal.jsx"), {
  ssr: false,
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
