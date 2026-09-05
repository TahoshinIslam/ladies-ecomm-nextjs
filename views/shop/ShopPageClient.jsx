"use client";

// Phase 7 — the interactive shell around the shop page's server-rendered
// initial product list. `initialProducts`/`total`/`facets` arrive as
// plain, already-serialized props from the Server Component (views/
// ShopPage.jsx), which fetched them through the same Phase 5 validated
// services/productService.js contract GET /api/products itself uses — no
// client fetch is needed to see the first page of results. This
// component is remounted (via a `key` set by the Server Component, tied
// to the current search params) on every filter/sort/search change, so
// its local state always starts fresh from the new server-rendered data
// rather than fighting stale client state. RTK Query remains here only
// for: supporting filter-sidebar metadata (brands/categories/attribute
// definitions/groupings/histogram sample — legitimately client-owned,
// interactive-filter-construction data, not the product list itself) and
// "Show more" pagination beyond the server-rendered first page.
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Home, ShoppingBag, SlidersHorizontal, X } from "lucide-react";

import ProductCard from "../../components/product/ProductCard.jsx";
import PriceHistogramSlider from "../../components/product/PriceHistogramSlider.jsx";
import Button from "../../components/ui/Button.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import Breadcrumb from "../../components/ui/Breadcrumb.jsx";
import { useGetProductsQuery, useLazyGetProductsQuery, useGetProductGroupingsQuery } from "../../store/productApi.js";
import { useGetBrandsQuery, useGetCategoriesQuery, useGetAttributesQuery } from "../../store/shopApi.js";
import { cn } from "../../lib/utils.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { attrLabel, attrValue, departmentName } from "../../lib/i18n/catalog.js";

// The storefront only ever shows these departments and their subcategories
// (see services/productService.js's STOREFRONT_DEPARTMENT_SLUGS, the source
// of truth the backend enforces this same scope against).
const STOREFRONT_DEPARTMENT_SLUGS = new Set(["burqa", "hijab", "niqab", "abaya", "khimar", "modest-sets"]);

// `value` is the stable filter/query value (see section 7 of the
// localization audit — never translated); `labelKey` is resolved via t()
// at every render site.
const AGE_GROUP_OPTIONS = [
  { value: "kids", labelKey: "filters.kids" },
  { value: "girls", labelKey: "filters.girls" },
  { value: "adult", labelKey: "filters.adults" },
];
const COLLECTION_OPTIONS = [
  { value: "new", labelKey: "filters.new" },
  { value: "featured", labelKey: "filters.featured" },
  { value: "discount", labelKey: "filters.discount" },
];

const SORTS = [
  { value: "-createdAt", labelKey: "sort.newest" },
  { value: "basePrice", labelKey: "sort.priceLowHigh" },
  { value: "-basePrice", labelKey: "sort.priceHighLow" },
  { value: "-rating", labelKey: "sort.popular" },
  { value: "-isFeatured", labelKey: "filters.featured" },
];
const PAGE_SIZE = 12;

const computeTitle = (sp, departments, t, locale) => {
  const search = sp.get("search");
  if (search) return t("shop.resultsFor", { query: search });
  const deptId = sp.get("category");
  const dept = deptId ? departments.find((d) => d._id === deptId) : null;
  if (dept) return departmentName(locale, dept.slug, dept.name);
  return t("shop.shopAll");
};

export default function ShopPageClient({ initialProducts, total, facets }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const settings = useSettings();
  const { t, locale } = useLocale();

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

  // "Show more" pagination — starts from the server-rendered first page
  // (page 1) and appends subsequent pages on demand. Remounted (via the
  // parent Server Component's `key`) whenever the URL's filters change,
  // so this always restarts from a fresh page 1.
  const [products, setProducts] = useState(initialProducts);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [triggerGetProducts] = useLazyGetProductsQuery();
  const hasMore = products.length < total;

  const { data: brandsData } = useGetBrandsQuery();
  const { data: catsData, isLoading: catsLoading } = useGetCategoriesQuery();
  // Unfiltered sample of catalog used only to draw the price histogram so the
  // bars represent the whole catalog, not the currently-filtered subset.
  const { data: histogramData } = useGetProductsQuery({ limit: 200, fields: "basePrice,discountPrice" });

  const departments = useMemo(
    () => (catsData?.categories ?? []).filter((c) => !c.parent && STOREFRONT_DEPARTMENT_SLUGS.has(c.slug)),
    [catsData],
  );
  const selectedDept = sp.get("category") || "";

  const { data: groupingsData, isLoading: groupingsLoading } = useGetProductGroupingsQuery(
    selectedDept ? { category: selectedDept } : undefined,
    { skip: !selectedDept },
  );
  const { data: attrData, isLoading: attrLoading } = useGetAttributesQuery(selectedDept, { skip: !selectedDept });
  const attributeDefs = (attrData?.attributes ?? []).filter((d) => d.filterable !== false);

  // Unscoped (no category arg) — the full raw AttributeDefinition list,
  // fetched once regardless of which department is selected. Used only to
  // resolve color swatch hexes and the size/length label for product cards
  // in the grid, which can show products from every department at once
  // (unlike the sidebar's attributeDefs above, which is deliberately
  // scoped to the selected department).
  const { data: allAttrsData } = useGetAttributesQuery();
  const colorDef = allAttrsData?.attributes?.find((d) => d.key === "color");
  const sizeDef = allAttrsData?.attributes?.find((d) => d.key === "size");
  const cardAttributeMeta = useMemo(() => ({ colorDef, sizeDef }), [colorDef, sizeDef]);

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
  // search, price, Age Group, and Product Collection, since none of those
  // are department-specific the way Style/attribute facets are).
  const selectDepartment = (deptId) => {
    const next = new URLSearchParams();
    for (const k of ["sort", "search", "priceMin", "priceMax", "ageGroup", "new", "featured", "discount"]) {
      if (sp.get(k)) next.set(k, sp.get(k));
    }
    if (deptId) next.set("category", deptId);
    setSp(next);
  };

  // Clears product-filter parameters only — search and sort aren't filters
  // in this app's own vocabulary (activeFilterCount below already excludes
  // them), and which department you're browsing is page-level navigation,
  // not a filter, so Clear All leaves both alone.
  const clearAll = () => {
    const next = new URLSearchParams();
    for (const k of ["category", "search", "sort"]) {
      if (sp.get(k)) next.set(k, sp.get(k));
    }
    setSp(next);
  };

  const showMore = async () => {
    setLoadingMore(true);
    try {
      const query = {};
      for (const [k, v] of sp.entries()) {
        if (k === "priceMin") query.basePrice = { ...(query.basePrice || {}), gte: v };
        else if (k === "priceMax") query.basePrice = { ...(query.basePrice || {}), lte: v };
        else query[k] = v;
      }
      query.limit = PAGE_SIZE;
      query.page = page + 1;
      if (!query.sort) query.sort = "-createdAt";
      const result = await triggerGetProducts(query).unwrap();
      setProducts((prev) => [...prev, ...(result.products ?? [])]);
      setPage((p) => p + 1);
    } catch {
      // A failed "show more" leaves the existing list untouched — the user
      // can just try again; nothing about the already-shown page is lost.
    } finally {
      setLoadingMore(false);
    }
  };

  const title = computeTitle(sp, departments, t, locale);
  const selectedDeptObj = selectedDept ? departments.find((d) => d._id === selectedDept) : null;

  // Individually removable chips for every active product-filter param —
  // built from the same URL state and lookup data the sidebar renders
  // from, so a chip's label always matches what's actually applied.
  const activeChips = useMemo(() => {
    const chips = [];

    for (const opt of AGE_GROUP_OPTIONS) {
      if ((sp.get("ageGroup") || "").split(",").includes(opt.value)) {
        chips.push({ id: `ageGroup:${opt.value}`, label: t(opt.labelKey), onRemove: () => toggleFacetValue("ageGroup", opt.value, false) });
      }
    }

    for (const opt of COLLECTION_OPTIONS) {
      if (sp.get(opt.value) === "true") {
        chips.push({ id: opt.value, label: t(opt.labelKey), onRemove: () => setParam(opt.value, "") });
      }
    }

    const styleId = sp.get("style");
    if (styleId) {
      const styleName = (groupingsData?.groupings ?? []).find((g) => g._id === styleId)?.name || t("shop.style");
      chips.push({ id: "style", label: styleName, onRemove: () => setParam("style", "") });
    }

    const brandId = sp.get("brand");
    if (brandId) {
      const brandName = brandsData?.brands?.find((b) => b._id === brandId)?.name || t("shop.brand");
      chips.push({ id: "brand", label: brandName, onRemove: () => setParam("brand", "") });
    }

    for (const def of attributeDefs) {
      for (const v of (sp.get(def.key) || "").split(",").filter(Boolean)) {
        const dbLabel = def.options?.find((o) => o.value === v)?.label || v;
        const optLabel = attrValue(locale, def.key, v, dbLabel);
        chips.push({ id: `${def.key}:${v}`, label: optLabel, onRemove: () => toggleFacetValue(def.key, v, false) });
      }
    }

    const priceMin = sp.get("priceMin");
    const priceMax = sp.get("priceMax");
    if (priceMin || priceMax) {
      const label = `${priceMin ? settings.formatPrice(Number(priceMin)) : t("filters.min")} – ${priceMax ? settings.formatPrice(Number(priceMax)) : t("filters.max")}`;
      chips.push({
        id: "price",
        label,
        onRemove: () => {
          const next = new URLSearchParams(sp);
          next.delete("priceMin");
          next.delete("priceMax");
          next.delete("page");
          setSp(next);
        },
      });
    }

    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, groupingsData, brandsData, attributeDefs, settings, t, locale]);

  return (
    <div className="container-x py-8">
      <Breadcrumb
        items={[
          { label: t("navigation.home"), href: "/", icon: Home },
          { label: t("navigation.shop"), href: "/shop", icon: ShoppingBag },
          ...(selectedDeptObj ? [{ label: selectedDeptObj.name }] : []),
        ]}
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {t("shop.productsCount", { count: total })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="shop-sort" className="sr-only">
            {t("shop.sortBy")}
          </label>
          <select
            id="shop-sort"
            aria-label={t("shop.sortBy")}
            value={sp.get("sort") || "-createdAt"}
            onChange={(e) => setParam("sort", e.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm focus-ring"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.labelKey)}
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
            {t("filters.filters")}
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

      <ActiveFilterChips chips={activeChips} onClearAll={clearAll} />

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
          departments={departments}
          deptLoading={catsLoading}
          selectedDept={selectedDept}
          selectDepartment={selectDepartment}
          groupingsData={groupingsData}
          groupingsLoading={groupingsLoading}
          attributeDefs={attributeDefs}
          attrLoading={attrLoading}
          histogramProducts={histogramData?.products ?? []}
          facets={facets}
        />
      </FilterSheetMobile>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Desktop sticky sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 overflow-y-auto rounded-lg border border-border bg-background p-5">
            <FilterPanel
              sp={sp}
              setSp={setSp}
              setParam={setParam}
              toggleFacetValue={toggleFacetValue}
              clearAll={clearAll}
              brandsData={brandsData}
              departments={departments}
              deptLoading={catsLoading}
              selectedDept={selectedDept}
              selectDepartment={selectDepartment}
              groupingsData={groupingsData}
              groupingsLoading={groupingsLoading}
              attributeDefs={attributeDefs}
              attrLoading={attrLoading}
              histogramProducts={histogramData?.products ?? []}
              facets={facets}
            />
          </div>
        </aside>

        {/* Product grid */}
        <div>
          {products.length === 0 ? (
            <EmptyState
              icon={SlidersHorizontal}
              title={t("shop.noProductsMatch")}
              message={t("shop.tryAdjustingFilters")}
              action={<Button onClick={clearAll}>{t("shop.clearFilters")}</Button>}
            />
          ) : (
            <>
              <div
                className={cn(
                  "grid grid-cols-2 gap-5 lg:grid-cols-3 xl:grid-cols-4 transition-opacity",
                  loadingMore && "opacity-60"
                )}
              >
                {products.map((p, i) => (
                  <ProductCard key={p._id} product={p} index={i} attributeMeta={cardAttributeMeta} />
                ))}
              </div>

              {/* Show more */}
              {hasMore && (
                <div className="mt-10 flex flex-col items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    {t("shop.showingOfTotal", { count: products.length, total })}
                  </p>
                  <Button
                    variant="outline"
                    disabled={loadingMore}
                    onClick={showMore}
                  >
                    {loadingMore ? t("shop.loadingEllipsis") : t("shop.showMore")}
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
  const { t, locale } = useLocale();
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
        {t("shop.all")}
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
          {departmentName(locale, d.slug, d.name)}
        </button>
      ))}
    </div>
  );
}

const SHEET_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Board's FilterSheet: a Radix-Dialog-style bottom sheet, not a side drawer. */
function FilterSheetMobile({ open, onClose, activeFilterCount, children }) {
  const { t } = useLocale();
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
            aria-label={t("filters.filters")}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-x-0 bottom-0 flex max-h-[86vh] flex-col rounded-t-[20px] border-t border-line bg-surface shadow-sheet"
          >
            <div className="mx-auto mt-3 h-1 w-9 flex-none rounded-full bg-line" aria-hidden="true" />
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h3 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.02em]">
                {t("filters.filters")}
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
                aria-label={t("shop.closeFilters")}
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
  departments = [],
  deptLoading,
  selectedDept,
  selectDepartment,
  groupingsData,
  groupingsLoading,
  attributeDefs,
  attrLoading,
  histogramProducts = [],
  facets,
}) {
  const { t, locale } = useLocale();
  // Filter layout: Category, Age Group, Product Collection, [Style /
  // attribute facets / Brand — only once a department narrows what's
  // available], Price Range. Age Group and Product Collection are
  // permanently visible regardless of department selection.
  if (!selectedDept) {
    return (
      <>
        <CategoryFilterGroup
          departments={departments}
          loading={deptLoading}
          selectedDept={selectedDept}
          onSelect={selectDepartment}
        />
        <AgeGroupFilterGroup sp={sp} toggleFacetValue={toggleFacetValue} counts={facets?.ageGroup} />
        <ProductCollectionFilterGroup sp={sp} setParam={setParam} counts={facets?.collection} />
        <PriceRange sp={sp} setSp={setSp} histogramProducts={histogramProducts} />
        <Button variant="outline" size="sm" onClick={clearAll} className="w-full">
          {t("common.clearAll")}
        </Button>
      </>
    );
  }

  const groupings = groupingsData?.groupings ?? [];

  return (
    <>
      <CategoryFilterGroup
        departments={departments}
        loading={deptLoading}
        selectedDept={selectedDept}
        onSelect={selectDepartment}
      />

      <AgeGroupFilterGroup sp={sp} toggleFacetValue={toggleFacetValue} counts={facets?.ageGroup} />
      <ProductCollectionFilterGroup sp={sp} setParam={setParam} counts={facets?.collection} />

      {(groupingsLoading || groupings.length > 0) && (
        <FilterGroup title={t("shop.style")}>
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
        <FilterGroup title={t("shop.loadingFilters")}>
          <FilterRowSkeleton count={4} />
        </FilterGroup>
      ) : (
        attributeDefs.map((def) => (
          <FilterGroup key={def.key} title={attrLabel(locale, def.key, def.label)}>
            {def.options?.length ? (
              def.options.map((opt) => (
                <CheckBox
                  key={opt.value}
                  label={attrValue(locale, def.key, opt.value, opt.label)}
                  swatchHex={def.type === "swatch" ? opt.swatchHex : undefined}
                  checked={(sp.get(def.key) || "").split(",").includes(opt.value)}
                  onChange={(v) => toggleFacetValue(def.key, opt.value, v)}
                />
              ))
            ) : (
              <p className="text-xs text-muted-foreground">{t("shop.noOptionsYet")}</p>
            )}
          </FilterGroup>
        ))
      )}

      {brandsData?.brands?.length > 0 && (
        <FilterGroup title={t("shop.brand")}>
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
        {t("common.clearAll")}
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

// Always the first group in the sidebar — Category, then (once one's
// picked) Style, then the department's attribute-driven facets, then
// Brand, then Price. Single-select via checkboxes, same convention the
// Style/gender facets below already use elsewhere in this file: clicking
// the active department clears it back to "Shop all," clicking another
// switches to it (selectDepartment resets every filter that doesn't
// survive a department change).
function CategoryFilterGroup({ departments, loading, selectedDept, onSelect }) {
  const { t, locale } = useLocale();
  return (
    <FilterGroup title={t("shop.category")}>
      {loading && !departments.length ? (
        <FilterRowSkeleton count={5} />
      ) : (
        departments.map((d) => (
          <CheckBox
            key={d._id}
            label={departmentName(locale, d.slug, d.name)}
            checked={selectedDept === d._id}
            onChange={(v) => onSelect(v ? d._id : "")}
          />
        ))
      )}
    </FilterGroup>
  );
}

// Permanently visible, second group in the sidebar. UI shows Kids / Girls /
// Adults; stored ageGroup values stay exactly "kids" / "girls" / "adult"
// (see productModel.js — "girls" added without renaming the pre-existing
// two). Multiple selections OR together (toggleFacetValue's usual CSV
// convention) — e.g. Kids + Girls returns Kids OR Girls products.
function AgeGroupFilterGroup({ sp, toggleFacetValue, counts }) {
  const { t } = useLocale();
  const selected = (sp.get("ageGroup") || "").split(",").filter(Boolean);
  return (
    <FilterGroup title={t("filters.ageGroup")}>
      {AGE_GROUP_OPTIONS.map((opt) => {
        const checked = selected.includes(opt.value);
        const count = counts?.[opt.value] ?? 0;
        return (
          <CheckBox
            key={opt.value}
            label={`${t(opt.labelKey)} (${count})`}
            checked={checked}
            disabled={count === 0 && !checked}
            onChange={(v) => toggleFacetValue("ageGroup", opt.value, v)}
          />
        );
      })}
    </FilterGroup>
  );
}

// Permanently visible, third group — New / Featured / Discount. Each is its
// own boolean URL param (not a CSV multi-value field like ageGroup), and
// checking more than one ORs them together server-side (see
// services/productService.js's buildFilter: 2+ of new/featured/discount
// become a $or block instead of independent AND'd conditions).
function ProductCollectionFilterGroup({ sp, setParam, counts }) {
  const { t } = useLocale();
  return (
    <FilterGroup title={t("filters.productCollection")}>
      {COLLECTION_OPTIONS.map((opt) => {
        const checked = sp.get(opt.value) === "true";
        const count = counts?.[opt.value] ?? 0;
        return (
          <CheckBox
            key={opt.value}
            label={`${t(opt.labelKey)} (${count})`}
            checked={checked}
            disabled={count === 0 && !checked}
            onChange={(v) => setParam(opt.value, v ? "true" : "")}
          />
        );
      })}
    </FilterGroup>
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

function CheckBox({ label, checked, onChange, swatchHex, disabled }) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 text-sm",
        disabled ? "cursor-not-allowed text-muted-foreground/50" : "cursor-pointer text-foreground hover:text-accent",
      )}
    >
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-accent disabled:cursor-not-allowed disabled:opacity-50"
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

// Row of removable pills, one per active product-filter selection — sits
// between the department chips and the grid, always full-width so it never
// crowds the sort/filter-button row above it. Renders nothing when no
// product filter is active (department/search/sort don't count — they're
// not "filters" in this app's vocabulary, see activeFilterCount/clearAll).
function ActiveFilterChips({ chips, onClearAll }) {
  const { t } = useLocale();
  if (!chips.length) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={chip.onRemove}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-wash pl-3 pr-2 text-xs font-medium text-ink transition-colors hover:border-ink focus-ring"
        >
          {chip.label}
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{t("shop.removeFilterLabel", { label: chip.label })}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="h-8 rounded-full px-3 text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-ink hover:underline focus-ring"
      >
        {t("common.clearAll")}
      </button>
    </div>
  );
}
