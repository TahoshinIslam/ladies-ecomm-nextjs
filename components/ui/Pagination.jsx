"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "../../lib/utils.js";

const DEFAULT_LIMIT_OPTIONS = [10, 20, 50, 100];

// Compact "1 … 4 5 [6] 7 8 … 20" window — always shows the first and last
// page, plus one page on either side of the current one, collapsing
// everything else behind a single "…" per side.
function buildPageList(current, total) {
  const delta = 1;
  const range = [];
  for (let i = Math.max(2, current - delta); i <= Math.min(total - 1, current + delta); i++) {
    range.push(i);
  }
  const list = [1];
  if (range[0] > 2) list.push("…");
  list.push(...range);
  if (range[range.length - 1] < total - 1) list.push("…");
  if (total > 1) list.push(total);
  return list;
}

/**
 * Full pagination bar: Previous/Next, clickable page numbers, a
 * rows-per-page selector, and a "Showing X–Y of Z" summary. Controlled —
 * the caller (usually via useTableQueryState) owns `page`/`limit` and
 * reacts to onPageChange/onLimitChange.
 */
export default function Pagination({
  page,
  pages = 1,
  total = 0,
  limit,
  onPageChange,
  onLimitChange,
  limitOptions = DEFAULT_LIMIT_OPTIONS,
  className,
}) {
  const safePages = Math.max(1, pages || 1);
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const pageNumbers = useMemo(() => buildPageList(page, safePages), [page, safePages]);

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span data-tabular>
          {total === 0 ? "No records" : `Showing ${from}–${to} of ${total}`}
        </span>
        {onLimitChange && (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Rows per page</span>
            <select
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              aria-label="Rows per page"
              className="h-8 rounded-md border border-border bg-background px-2 text-xs focus-ring"
            >
              {limitOptions.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {safePages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <PageButton onClick={() => onPageChange(1)} disabled={page <= 1} label="First page">
            <ChevronsLeft className="h-4 w-4" />
          </PageButton>
          <PageButton onClick={() => onPageChange(page - 1)} disabled={page <= 1} label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </PageButton>
          {pageNumbers.map((n, i) =>
            n === "…" ? (
              <span key={`ellipsis-${i}`} aria-hidden="true" className="px-1.5 text-sm text-muted-foreground">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                onClick={() => onPageChange(n)}
                aria-current={n === page ? "page" : undefined}
                aria-label={`Page ${n}`}
                className={cn(
                  "grid h-8 w-8 flex-none place-items-center rounded-md text-sm font-medium transition-colors focus-ring",
                  n === page
                    ? "bg-ink text-canvas"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {n}
              </button>
            ),
          )}
          <PageButton onClick={() => onPageChange(page + 1)} disabled={page >= safePages} label="Next page">
            <ChevronRight className="h-4 w-4" />
          </PageButton>
          <PageButton onClick={() => onPageChange(safePages)} disabled={page >= safePages} label="Last page">
            <ChevronsRight className="h-4 w-4" />
          </PageButton>
        </nav>
      )}
    </div>
  );
}

function PageButton({ onClick, disabled, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-8 w-8 flex-none place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-ring disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
