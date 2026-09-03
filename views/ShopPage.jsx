"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { SlidersHorizontal, X, AlertCircle } from "lucide-react";

import ProductCard from "../components/product/ProductCard.jsx";
import ProductCardSkeleton from "../components/product/ProductCardSkeleton.jsx";
import PriceHistogramSlider from "../components/product/PriceHistogramSlider.jsx";
import Button from "../components/ui/Button.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import { useGetProductsQuery, useGetProductGroupingsQuery } from "../store/productApi.js";
import { useGetBrandsQuery, useGetCategoriesQuery, useGetAttributesQuery } from "../store/shopApi.js";
import { cn } from "../lib/utils.js";

const SORTS = [
  { value: "-createdAt", label: "New arrivals" },
  { value: "basePrice", label: "Price: Low → High" },
  { value: "-basePrice", label: "Price: High → Low" },
  { value: "-rating", label: "Popular" },
  { value: "-isFeatured", label: "Featured" },
];
const PAGE_SIZE = 12;

const computeTitle = (sp, departments) => {
  const search = sp.get("search");
  if (search) return `Results for "${search}"`;
  const deptId = sp.get("category");
  const dept = deptId ? departments.find((d) => d._id === deptId) : null;
  if (dept) return dept.name;
  return "Shop all";
};

export default function ShopPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Filters live in the URL so they survive refresh and can be shared.
  // Scroll is pinned: re-filtering should not throw the grid back to the top.
  const setSp = useCallback(
    (next, { replace = false } = {}) => {
      const qs = next.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [router, pathname],
  );

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset visible count when filters/sort change (anything except `limit` itself)
  const filterKey = useMemo(() => {
    const next = new URLSearchParams(sp);
    next.delete("limit");
    return next.toString();
  }, [sp]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filterKey]);

  const query = useMemo(() => {
    const o = {};
    for (const [k, v] of sp.entries()) {
      if (k === "priceMin") {
        o.basePrice = { ...(o.basePrice || {}), gte: v };
      } else if (k === "priceMax") {
        o.basePrice = { ...(o.basePrice || {}), lte: v };
      } else if (k === "page") {
        // ignore — using show-more instead of pagination
      } else {
        o[k] = v;
      }
    }
    o.limit = visibleCount;
    if (!o.sort) o.sort = "-createdAt";
    return o;
  }, [sp, visibleCount]);

  const { data, isLoading, isFetching, isError, error } = useGetProductsQuery(query);
  // Unfiltered sample of catalog used only to draw the price histogram so the
  // bars represent the whole catalog, not the currently-filtered subset.
  const { data: histogramData } = useGetProductsQuery({ limit: 200, fields: "basePrice,discountPrice" });
  const { data: brandsData } = useGetBrandsQuery();
  const { data: catsData, isLoading: catsLoading } = useGetCategoriesQuery();

  const departments = useMemo(() => (catsData?.categories ?? []).filter((c) => !c.parent), [catsData]);
  const selectedDept = sp.get("category") || "";

  const { data: groupingsData, isLoading: groupingsLoading } = useGetProductGroupingsQuery(
    selectedDept ? { category: selectedDept } : undefined,
    { skip: !selectedDept },
  );
  const { data: attrData, isLoading: attrLoading } = useGetAttributesQuery(selectedDept, { skip: !selectedDept });
  const attributeDefs = (attrData?.attributes ?? []).filter((d) => d.filterable !== false);

  const activeFilterCount = useMemo(() => {
    const skip = new Set(["sort", "limit", "page", "search", "category"]);
    return [...sp.keys()].filter((k) => !skip.has(k)).length;
  }, [sp]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(sp);
    if (!value) next.delete(key);
    else next.set(key, value);
    next.delete("page");
    setSp(next);
  };

  // Comma-separated multi-value facets (fabric, color, occasion, ...): add
  // or remove one value from the CSV list at `key`.
  const toggleFacetValue = (key, value, checked) => {
    const current = (sp.get(key) || "").split(",").filter(Boolean);
    const next = checked ? [...new Set([...current, value])] : current.filter((v) => v !== value);
    setParam(key, next.join(","));
  };

  // Switching department invalidates every style/attribute selection made
  // under the previous one — reset to just the new department (keep sort,
  // search, price, since those are department-agnostic).
  const selectDepartment = (deptId) => {
    const next = new URLSearchParams();
    for (const k of ["sort", "search", "priceMin", "priceMax"]) {
      if (sp.get(k)) next.set(k, sp.get(k));
    }
    if (deptId) next.set("category", deptId);
    setSp(next);
  };

  const clearAll = () => setSp(new URLSearchParams());

  // Defensive: use empty array if data is undefined
  const products = data?.products ?? [];
  const total = data?.total ?? 0;
  const hasMore = products.length < total;
  const title = computeTitle(sp, departments);

  return (
    <div className="container-x py-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {total} products
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="shop-sort" className="sr-only">
            Sort products by
          </label>
          <select
            id="shop-sort"
            aria-label="Sort products by"
            value={sp.get("sort") || "-createdAt"}
            onChange={(e) => setParam("sort", e.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm focus-ring"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            className="relative inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-medium text-ink transition-colors hover:border-ink focus-ring active:scale-[0.98] lg:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span
                data-tabular
                className="grid h-4 min-w-4 place-items-center rounded-lg bg-verm px-1 font-mono text-[10px] leading-none text-white"
              >
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Department chips — the entry point for the whole dynamic filter
          system: picking one loads that department's real subcategories
          and attributes (fabric, coverage, occasion, ...) instead of any
          hardcoded filter set. Always visible, desktop and mobile. */}
      <DepartmentChips
        departments={departments}
        loading={catsLoading}
        selected={selectedDept}
        onSelect={selectDepartment}
      />

      {/* Mobile filter sheet — rises from the bottom, matching the board's
          "sheet" motion (320ms, not spring physics) used by every other
          overlay in the app. */}
      <FilterSheetMobile
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        activeFilterCount={activeFilterCount}
      >
        <FilterPanel
          sp={sp}
          setSp={setSp}
          setParam={setParam}
          toggleFacetValue={toggleFacetValue}
          clearAll={clearAll}
          brandsData={brandsData}
          selectedDept={selectedDept}
          groupingsData={groupingsData}
          groupingsLoading={groupingsLoading}
          attributeDefs={attributeDefs}
          attrLoading={attrLoading}
          histogramProducts={histogramData?.products ?? []}
        />
      </FilterSheetMobile>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Desktop sticky sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 overflow-y-auto rounded-lg border border-border bg-background p-5">
            <FilterPanel
              sp={sp}
              setParam={setParam}
              toggleFacetValue={toggleFacetValue}
              clearAll={clearAll}
              brandsData={brandsData}
              selectedDept={selectedDept}
              groupingsData={groupingsData}
              groupingsLoading={groupingsLoading}
              attributeDefs={attributeDefs}
              attrLoading={attrLoading}
              histogramProducts={histogramData?.products ?? []}
            />
          </div>
        </aside>

        {/* Product grid */}
        <div>
          {isLoading ? (
            <div className="grid grid-cols-2 gap-5 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : isError ? (
            <EmptyState
              icon={AlertCircle}
              title="Couldn't load products"
              message={error?.data?.message || "The server returned an error. Check your backend logs."}
              action={
                <Button onClick={() => window.location.reload()}>Try again</Button>
              }
            />
          ) : products.length === 0 ? (
            <EmptyState
              icon={SlidersHorizontal}
              title="No products match"
              message="Try adjusting your filters."
              action={<Button onClick={clearAll}>Clear filters</Button>}
            />
          ) : (
            <>
              <div
                className={cn(
                  "grid grid-cols-2 gap-5 lg:grid-cols-3 xl:grid-cols-4 transition-opacity",
                  isFetching && "opacity-60"
                )}
              >
                {products.map((p, i) => (
                  <ProductCard key={p._id} product={p} index={i} />
                ))}
              </div>

              {/* Show more */}
              {hasMore && (
                <div className="mt-10 flex flex-col items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    Showing {products.length} of {total}
                  </p>
                  <Button
                    variant="outline"
                    disabled={isFetching}
                    onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                  >
                    {isFetching ? "Loading..." : "Show more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DepartmentChips({ departments, loading, selected, onSelect }) {
  if (loading && !departments.length) {
    return (
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-10 w-24 flex-none rounded-full" />
        ))}
      </div>
    );
  }
  return (
    <div className="mb-6 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
      <button
        type="button"
        onClick={() => onSelect("")}
        className={cn(
          "h-10 flex-none rounded-full border px-4 text-sm font-medium transition-colors focus-ring",
          !selected ? "border-ink bg-ink text-canvas" : "border-line text-ink hover:border-ink",
        )}
      >
        All
      </button>
      {departments.map((d) => (
        <button
          key={d._id}
          type="button"
          onClick={() => onSelect(d._id)}
          className={cn(
            "h-10 flex-none rounded-full border px-4 text-sm font-medium transition-colors focus-ring",
            selected === d._id ? "border-ink bg-ink text-canvas" : "border-line text-ink hover:border-ink",
          )}
        >
          {d.name}
        </button>
      ))}
    </div>
  );
}

const SHEET_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Board's FilterSheet: a Radix-Dialog-style bottom sheet, not a side drawer. */
function FilterSheetMobile({ open, onClose, activeFilterCount, children }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const onKeydown = (e) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll(SHEET_FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[210] lg:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-[3px]"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-x-0 bottom-0 flex max-h-[86vh] flex-col rounded-t-[20px] border-t border-line bg-surface shadow-sheet"
          >
            <div className="mx-auto mt-3 h-1 w-9 flex-none rounded-full bg-line" aria-hidden="true" />
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h3 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
                Filters
                {activeFilterCount > 0 && (
                  <span
                    data-tabular
                    className="grid h-5 min-w-5 place-items-center rounded-lg bg-verm px-1.5 font-mono text-[11px] text-white"
                  >
                    {activeFilterCount}
                  </span>
                )}
              </h3>
              <button
                onClick={onClose}
                aria-label="Close filters"
                className="grid h-11 w-11 place-items-center rounded-lg transition-colors hover:bg-wash focus-ring"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function FilterPanel({
  sp,
  setSp,
  setParam,
  toggleFacetValue,
  clearAll,
  brandsData,
  selectedDept,
  groupingsData,
  groupingsLoading,
  attributeDefs,
  attrLoading,
  histogramProducts = [],
}) {
  if (!selectedDept) {
    return (
      <>
        <p className="mb-5 text-sm text-muted-foreground">
          Pick a department above to see its styles, fabrics, and other filters.
        </p>
        <PriceRange sp={sp} setSp={setSp} histogramProducts={histogramProducts} />
        <Button variant="outline" size="sm" onClick={clearAll} className="w-full">
          Clear all
        </Button>
      </>
    );
  }

  const groupings = groupingsData?.groupings ?? [];

  return (
    <>
      {(groupingsLoading || groupings.length > 0) && (
        <FilterGroup title="Style">
          {groupingsLoading ? (
            <FilterRowSkeleton count={4} />
          ) : (
            groupings.map((g) => (
              <CheckBox
                key={g._id}
                label={`${g.name} (${g.count})`}
                checked={sp.get("style") === g._id}
                onChange={(v) => setParam("style", v ? g._id : "")}
              />
            ))
          )}
        </FilterGroup>
      )}

      {attrLoading ? (
        <FilterGroup title="Loading filters">
          <FilterRowSkeleton count={4} />
        </FilterGroup>
      ) : (
        attributeDefs.map((def) => (
          <FilterGroup key={def.key} title={def.label}>
            {def.options?.length ? (
              def.options.map((opt) => (
                <CheckBox
                  key={opt.value}
                  label={opt.label}
                  swatchHex={def.type === "swatch" ? opt.swatchHex : undefined}
                  checked={(sp.get(def.key) || "").split(",").includes(opt.value)}
                  onChange={(v) => toggleFacetValue(def.key, opt.value, v)}
                />
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No options set yet.</p>
            )}
          </FilterGroup>
        ))
      )}

      {brandsData?.brands?.length > 0 && (
        <FilterGroup title="Brand">
          {brandsData.brands.map((b) => (
            <CheckBox
              key={b._id}
              label={b.name}
              checked={sp.get("brand") === b._id}
              onChange={(v) => setParam("brand", v ? b._id : "")}
            />
          ))}
        </FilterGroup>
      )}

      <PriceRange sp={sp} setSp={setSp} histogramProducts={histogramProducts} />

      <Button variant="outline" size="sm" onClick={clearAll} className="w-full">
        Clear all
      </Button>
    </>
  );
}

function PriceRange({ sp, setSp, histogramProducts }) {
  return (
    <div className="mb-5 border-b border-border pb-5">
      <PriceHistogramSlider
        products={histogramProducts}
        value={[
          sp.get("priceMin") ? Number(sp.get("priceMin")) : null,
          sp.get("priceMax") ? Number(sp.get("priceMax")) : null,
        ]}
        onChange={([lo, hi]) => {
          const next = new URLSearchParams(sp);
          if (lo === null || lo === undefined) next.delete("priceMin");
          else next.set("priceMin", String(lo));
          if (hi === null || hi === undefined) next.delete("priceMax");
          else next.set("priceMax", String(hi));
          next.delete("page");
          setSp(next);
        }}
      />
    </div>
  );
}

function FilterRowSkeleton({ count = 4 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="skeleton h-4 w-4 rounded" />
          <div
            className="skeleton h-3 rounded"
            style={{ width: `${50 + ((i * 13) % 35)}%` }}
          />
        </div>
      ))}
    </>
  );
}

function FilterGroup({ title, children }) {
  return (
    <div className="mb-5 border-b border-border pb-5 last:border-0 last:pb-0">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function CheckBox({ label, checked, onChange, swatchHex }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground hover:text-accent">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-accent"
      />
      {swatchHex && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 flex-none rounded-full border border-border"
          style={{ backgroundColor: swatchHex }}
        />
      )}
      {label}
    </label>
  );
}
