"use client";

import { useState } from "react";
import Image from "next/image";
import { useSelector } from "react-redux";
import {
  Users,
  Shield,
  User as UserIcon,
  Briefcase,
  Trash2,
  Edit2,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import Badge from "../../components/ui/Badge.jsx";
import Button from "../../components/ui/Button.jsx";
import Select from "../../components/ui/Select.jsx";
import Modal from "../../components/ui/Modal.jsx";
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx";
import DataTable from "../../components/admin/DataTable.jsx";
import TableToolbar from "../../components/admin/TableToolbar.jsx";
import DropdownMenu, { DropdownMenuItem } from "../../components/ui/DropdownMenu.jsx";

import {
  useListUsersQuery,
  useUpdateUserMutation,
  useDeleteUserMutation,
} from "../../store/userApi.js";
import { selectCurrentUser } from "../../store/authSlice.js";
import { formatDate } from "../../lib/utils.js";
import { isApprovedImageSource } from "../../lib/approvedImageSource.js";
import { useTableQueryState } from "../../hooks/useTableQueryState.js";
import { PERMISSIONS } from "../../lib/permissions.js";

// Mirrors lib/permissions.js exactly — that file is the one place these
// strings are defined; nothing here should ever drift from what the route
// guards and usePermission() actually check.
const PERMISSION_GROUPS = [
  {
    label: "Dashboard",
    perms: [{ value: PERMISSIONS.DASHBOARD_VIEW, label: "View dashboard" }],
  },
  {
    label: "Products",
    perms: [
      { value: PERMISSIONS.PRODUCTS_VIEW, label: "View products" },
      { value: PERMISSIONS.PRODUCTS_MANAGE, label: "Create, edit, delete products" },
    ],
  },
  {
    label: "Categories",
    perms: [{ value: PERMISSIONS.CATEGORIES_MANAGE, label: "Manage categories & attributes" }],
  },
  {
    label: "Orders",
    perms: [
      { value: PERMISSIONS.ORDERS_VIEW, label: "View orders" },
      { value: PERMISSIONS.ORDERS_MANAGE, label: "Update order status" },
    ],
  },
  {
    label: "Marketing",
    perms: [
      { value: PERMISSIONS.COUPONS_MANAGE, label: "Manage coupons" },
      { value: PERMISSIONS.THEMES_MANAGE, label: "Manage themes" },
    ],
  },
  {
    label: "Other",
    perms: [
      { value: PERMISSIONS.REVIEWS_MANAGE, label: "Moderate reviews" },
      { value: PERMISSIONS.SETTINGS_MANAGE, label: "Manage store settings" },
      { value: PERMISSIONS.USERS_MANAGE, label: "Manage users & permissions" },
    ],
  },
];

const roleBadge = (role) => {
  if (role === "admin") {
    return (
      <Badge variant="accent">
        <Shield className="h-3 w-3" />
        admin
      </Badge>
    );
  }
  if (role === "employee") {
    return (
      <Badge variant="warning">
        <Briefcase className="h-3 w-3" />
        employee
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <UserIcon className="h-3 w-3" />
      customer
    </Badge>
  );
};

export default function AdminUsersPage() {
  const me = useSelector(selectCurrentUser);
  const [editing, setEditing] = useState(null);
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
    filterKeys: ["role"],
  });

  const { data, isLoading, isFetching, isError, error, refetch } = useListUsersQuery({
    page,
    limit,
    search: search || undefined,
    sortBy,
    sortOrder,
    role: filters.role || undefined,
  });
  const users = data?.users ?? [];
  const [deleteUser, { isLoading: deleting }] = useDeleteUserMutation();

  const isEligible = (u) => u.role !== "admin" && u._id !== me?._id;

  const returnToValidPageIfEmptied = (removedCount) => {
    if (users.length - removedCount <= 0 && page > 1) setPage(page - 1);
  };

  const handleDelete = async () => {
    try {
      await deleteUser(confirmDelete._id).unwrap();
      toast.success("User deleted");
      returnToValidPageIfEmptied(1);
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e?.data?.message || "Could not delete");
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selected];
    try {
      await Promise.all(ids.map((id) => deleteUser(id).unwrap()));
      toast.success(`${ids.length} user${ids.length === 1 ? "" : "s"} deleted`);
      returnToValidPageIfEmptied(ids.length);
      setSelected(new Set());
      setBulkConfirm(false);
    } catch (e) {
      toast.error(e?.data?.message || "Some users couldn't be deleted");
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
      header: "User",
      sortable: true,
      width: 240,
      render: (u) => {
        const isSelf = u._id === me?._id;
        return (
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-bold">
              {u.avatar && isApprovedImageSource(u.avatar) ? (
                <Image src={u.avatar} alt="" fill sizes="36px" className="object-cover" />
              ) : (
                // A user's own profile `avatar` field is set directly from
                // their profile-update request body (services/
                // userService.js) — an arbitrary URL of unknown origin.
                // proxy.js's production CSP img-src already blocks the
                // browser from loading any host other than
                // res.cloudinary.com directly, so an unapproved avatar URL
                // was never actually going to render — the initials
                // fallback below is what real users on that data see.
                u.name?.[0]?.toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold">
                {u.name}
                {isSelf && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
              </p>
              <p className="truncate text-xs text-muted-foreground" title={u.email}>{u.email}</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "role",
      header: "Role",
      hideBelow: "sm",
      render: (u) => roleBadge(u.role),
    },
    {
      key: "createdAt",
      header: "Joined",
      hideBelow: "md",
      sortable: true,
      render: (u) => formatDate(u.createdAt),
    },
    {
      key: "verified",
      header: "Verified",
      align: "center",
      hideBelow: "md",
      render: (u) => (u.isVerified ? <Badge variant="success">✓</Badge> : <Badge variant="warning">no</Badge>),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: 60,
      render: (u) => {
        const isSelf = u._id === me?._id;
        return (
          <DropdownMenu triggerLabel={`Actions for ${u.name}`}>
            <DropdownMenuItem icon={Edit2} onClick={() => setEditing(u)}>
              Edit
            </DropdownMenuItem>
            {u.role !== "admin" && !isSelf && (
              <DropdownMenuItem icon={Trash2} danger onClick={() => setConfirmDelete(u)}>
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-black">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">{data?.total ?? 0} users</p>
      </div>

      <TableToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search name or email…"
        activeFilterCount={activeFilterCount}
        onClearFilters={clearFilters}
        filters={
          <Select
            value={filters.role || ""}
            onChange={(e) => setFilter("role", e.target.value)}
            className="max-w-[160px]"
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            <option value="customer">Customer</option>
            <option value="employee">Employee</option>
            <option value="admin">Admin</option>
          </Select>
        }
        right={
          selected.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground">{selected.size} selected</span>
              <Button size="sm" variant="outline" onClick={() => setBulkConfirm(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete selected
              </Button>
            </>
          )
        }
      />

      <DataTable
        columns={columns}
        data={users}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        error={error}
        onRetry={refetch}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={setSort}
        selectable
        isRowSelectable={isEligible}
        selectedIds={selected}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
        empty={
          search || activeFilterCount > 0
            ? { icon: Search, title: "No matching users", message: "Try a different search or clear filters." }
            : { icon: Users, title: "No users" }
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

      {editing && (
        <EditUserModal
          user={editing}
          isSelf={editing._id === me?._id}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={`Delete ${confirmDelete?.name}?`}
        description="Their account and cart will be removed. Orders remain in history."
        loading={deleting}
      />
      <ConfirmDialog
        open={bulkConfirm}
        onClose={() => setBulkConfirm(false)}
        onConfirm={handleBulkDelete}
        title={`Delete ${selected.size} user${selected.size === 1 ? "" : "s"}?`}
        description="Their accounts and carts will be removed. Orders remain in history."
        loading={deleting}
      />
    </div>
  );
}

function EditUserModal({ user, isSelf, onClose }) {
  const [role, setRole] = useState(user.role);
  const [isVerified, setIsVerified] = useState(user.isVerified);
  const [permissions, setPermissions] = useState(user.permissions ?? []);
  const [updateUser, { isLoading }] = useUpdateUserMutation();

  const togglePerm = (p) =>
    setPermissions((cur) =>
      cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p],
    );

  const handleSave = async () => {
    try {
      const body = { id: user._id, isVerified };
      if (!isSelf) {
        body.role = role;
        body.permissions = role === "employee" ? permissions : [];
      }
      await updateUser(body).unwrap();
      toast.success("User updated");
      onClose();
    } catch (e) {
      toast.error(e?.data?.message || "Could not update");
    }
  };

  return (
    <Modal open onClose={onClose} title={`Edit ${user.name}`} size="md">
      <div className="space-y-4 p-5">
        <div className="rounded-md bg-muted/30 p-3 text-sm">
          <p><strong>{user.name}</strong></p>
          <p className="text-muted-foreground">{user.email}</p>
        </div>

        {isSelf ? (
          <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
            You can&apos;t change your own role or permissions. Ask another admin to do it.
          </div>
        ) : (
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="customer">Customer</option>
            <option value="employee">Employee</option>
            <option value="admin">Admin</option>
          </Select>
        )}

        {!isSelf && role === "employee" && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Permissions
            </p>
            {PERMISSION_GROUPS.map((g) => (
              <div key={g.label}>
                <p className="mb-1 text-xs font-semibold text-foreground/80">{g.label}</p>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {g.perms.map((p) => (
                    <label key={p.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={permissions.includes(p.value)}
                        onChange={() => togglePerm(p.value)}
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-accent" checked={isVerified} onChange={(e) => setIsVerified(e.target.checked)} />
          Email verified
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={isLoading}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
