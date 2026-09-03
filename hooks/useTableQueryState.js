"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * URL-synced state for an admin DataTable: page, rows-per-page, search,
 * sort, and arbitrary named filters — one hook instead of every admin page
 * hand-rolling its own useState wiring. Mirrors the URL-as-source-of-truth
 * pattern views/ShopPage.jsx already uses for storefront filters, so
 * refresh, back/forward, and shared links all restore the exact table
 * state (page + filters), not just the page.
 *
 * Any change to search/sort/limit/a filter resets back to page 1 — a
 * filter narrowing the result set to fewer pages than the one you were on
 * should never strand you on a now-invalid page.
 */
export function useTableQueryState({
  defaultLimit = 20,
  defaultSortBy = "",
  defaultSortOrder = "desc",
  filterKeys = [],
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const page = Math.max(1, Number(sp.get("page")) || 1);
  const limit = Number(sp.get("limit")) || defaultLimit;
  const search = sp.get("search") || "";
  const sortBy = sp.get("sortBy") || defaultSortBy;
  const sortOrder = sp.get("sortOrder") || defaultSortOrder;

  const filters = useMemo(() => {
    const out = {};
    for (const key of filterKeys) {
      const v = sp.get(key);
      if (v) out[key] = v;
    }
    return out;
  }, [sp, filterKeys]);

  const activeFilterCount = Object.keys(filters).length + (search ? 1 : 0);

  const patch = useCallback(
    (updates, { resetPage = false } = {}) => {
      const next = new URLSearchParams(sp);
      for (const [key, value] of Object.entries(updates)) {
        const isDefault =
          value === "" ||
          value == null ||
          (key === "limit" && Number(value) === defaultLimit) ||
          (key === "sortBy" && value === defaultSortBy) ||
          (key === "sortOrder" && value === defaultSortOrder);
        if (isDefault) next.delete(key);
        else next.set(key, String(value));
      }
      if (resetPage) next.delete("page");
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, sp, defaultLimit, defaultSortBy, defaultSortOrder],
  );

  const setPage = useCallback((p) => patch({ page: p > 1 ? p : "" }), [patch]);
  const setLimit = useCallback((l) => patch({ limit: l }, { resetPage: true }), [patch]);
  const setSearch = useCallback((s) => patch({ search: s }, { resetPage: true }), [patch]);
  const setSort = useCallback(
    (by, order) => patch({ sortBy: by, sortOrder: order }, { resetPage: true }),
    [patch],
  );
  const setFilter = useCallback((key, value) => patch({ [key]: value }, { resetPage: true }), [patch]);
  const clearFilters = useCallback(() => {
    const next = new URLSearchParams(sp);
    next.delete("search");
    next.delete("page");
    for (const key of filterKeys) next.delete(key);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, sp, filterKeys]);

  return {
    page,
    limit,
    search,
    sortBy,
    sortOrder,
    filters,
    activeFilterCount,
    setPage,
    setLimit,
    setSearch,
    setSort,
    setFilter,
    clearFilters,
  };
}
