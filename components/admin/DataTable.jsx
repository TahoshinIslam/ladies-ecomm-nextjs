"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import Skeleton from "../ui/Skeleton.jsx";
import Checkbox from "../ui/Checkbox.jsx";
import Pagination from "../ui/Pagination.jsx";
import AdminErrorState from "./AdminErrorState.jsx";
import { cn } from "../../lib/utils.js";

const HIDE_CLASS = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };
const ALIGN_CLASS = { left: "text-left", right: "text-right", center: "text-center" };
const SKELETON_ROWS = 8;

/**
 * The one shared admin table shell — every admin list (orders, products,
 * users, categories, coupons, reviews) renders through this instead of
 * hand-rolling its own <table>, skeleton rows, empty/error states, and
 * pagination. A page supplies `columns` (declarative config, same idiom
 * this codebase already uses for SORTS/TABS/PAYMENT_METHODS-style arrays)
 * and `data`; everything about *how* a table looks and behaves lives here
 * once.
 *
 * Column shape: { key, header, accessor?, render?(row), sortable?, align?,
 * hideBelow?: "sm"|"md"|"lg", width?, cellClassName? }
 *
 * Sorting, selection, and pagination are all controlled — this component
 * owns no query state itself, so it works identically whether the caller's
 * state lives in useTableQueryState (URL-synced, the admin default) or
 * plain useState.
 */
export default function DataTable({
  columns,
  data = [],
  getRowId = (row) => row._id ?? row.id,
  isLoading = false,
  isFetching = false,
  isError = false,
  error,
  onRetry,
  empty,
  sortBy,
  sortOrder = "asc",
  onSortChange,
  selectable = false,
  isRowSelectable,
  selectedIds,
  onToggleRow,
  onToggleAll,
  onRowClick,
  pagination,
  stickyHeader = true,
  minWidth = 640,
  className,
}) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  // Rows a bulk action genuinely can't apply to (e.g. an admin/self row for
  // bulk user-delete) — filtered out of "select all" and rendered without a
  // checkbox, rather than a checkbox that would just fail the action.
  const selectableRows = isRowSelectable ? data.filter(isRowSelectable) : data;
  const pageIds = selectableRows.map(getRowId);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someSelected = !allSelected && pageIds.some((id) => selected.has(id));
  const colSpan = columns.length + (selectable ? 1 : 0);

  const handleSort = (col) => {
    if (!col.sortable || !onSortChange) return;
    const nextOrder = sortBy === col.key && sortOrder === "asc" ? "desc" : "asc";
    onSortChange(col.key, nextOrder);
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        className={cn(
          "relative overflow-x-auto rounded-lg border border-border bg-background",
          stickyHeader && "max-h-[68vh] overflow-y-auto",
          isFetching && !isLoading && "opacity-75 transition-opacity",
        )}
        aria-busy={isFetching && !isLoading ? "true" : undefined}
      >
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead
            className={cn(
              "bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground",
              stickyHeader && "sticky top-0 z-10 backdrop-blur-sm",
            )}
          >
            <tr>
              {selectable && (
                <th scope="col" className="w-10 p-3">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={() => onToggleAll?.(pageIds, !allSelected)}
                    aria-label={allSelected ? "Deselect all rows on this page" : "Select all rows on this page"}
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    col.sortable
                      ? sortBy === col.key
                        ? sortOrder === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                      : undefined
                  }
                  className={cn(
                    "p-3 font-semibold",
                    ALIGN_CLASS[col.align || "left"],
                    col.hideBelow && HIDE_CLASS[col.hideBelow],
                  )}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(col)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded transition-colors hover:text-foreground focus-ring",
                        col.align === "right" && "flex-row-reverse",
                      )}
                    >
                      {col.header}
                      {sortBy === col.key ? (
                        sortOrder === "asc" ? (
                          <ArrowUp aria-hidden="true" className="h-3 w-3" />
                        ) : (
                          <ArrowDown aria-hidden="true" className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown aria-hidden="true" className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={`skeleton-${i}`}>
                  {selectable && (
                    <td className="p-3">
                      <Skeleton className="h-4 w-4 rounded" />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={cn("p-3", col.hideBelow && HIDE_CLASS[col.hideBelow])}>
                      <Skeleton className="h-4 w-full max-w-[160px]" />
                    </td>
                  ))}
                </tr>
              ))
            ) : isError ? (
              <tr>
                <td colSpan={colSpan} className="p-0">
                  <AdminErrorState
                    compact
                    title="Couldn't load this table"
                    message={error?.data?.message || error?.message || "Try again."}
                    onRetry={onRetry}
                  />
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="p-0">
                  <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
                    {empty?.icon && <empty.icon aria-hidden="true" className="h-8 w-8 text-muted-foreground" />}
                    <h3 className="font-heading font-bold">{empty?.title || "No records"}</h3>
                    {empty?.message && <p className="text-sm text-muted-foreground">{empty.message}</p>}
                    {empty?.action}
                  </div>
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const id = getRowId(row);
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      "transition-colors hover:bg-muted/30",
                      onRowClick && "cursor-pointer",
                      selected.has(id) && "bg-accent/5",
                    )}
                  >
                    {selectable && (
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        {!isRowSelectable || isRowSelectable(row) ? (
                          <Checkbox
                            checked={selected.has(id)}
                            onChange={() => onToggleRow?.(id)}
                            aria-label="Select row"
                          />
                        ) : (
                          <span className="sr-only">Not selectable</span>
                        )}
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          "p-3",
                          ALIGN_CLASS[col.align || "left"],
                          col.hideBelow && HIDE_CLASS[col.hideBelow],
                          col.cellClassName,
                        )}
                      >
                        {col.render ? col.render(row) : (row[col.accessor || col.key] ?? "—")}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pagination && !isLoading && !isError && (pagination.total > 0 || pagination.page > 1) && (
        <Pagination {...pagination} />
      )}
    </div>
  );
}
