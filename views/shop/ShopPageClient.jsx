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
import { cn, responsiveBatchSize, visibleBufferCount } from "../../lib/utils.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { attrLabel, attrValue, departmentName } from "../../lib/i18n/catalog.js";

// The top-nav departments the storefront shows — root categories only
// (`!c.parent`, see `departments` below), matching
// services/productService.js's own STOREFRONT_DEPARTMENT_SLUGS exactly.
// A real allowlist, not just "any root category": a stray root category
// (e.g. leftover test/fixture data) must never silently appear in the
// storefront nav.
const STOREFRONT_DEPARTMENT_SLUGS = new Set([
  "burqa",
  "hijab",
  "niqab",
  "abaya",
  "khimar",
  "modest-sets",
  "t-shirt",
  "shirts",
  "jeans",
]);

// `value` is the stable filter/query value (see section 7 of the
// localization audit — never translated); `labelKey` is resolved via t()
// at every render site.
const AGE_GROUP_OPTIONS = [
  { value: "kids", labelKey: "filters.kids" },
  { value: "girls", labelKey: "filters.girls" },
  { value: "adult", labelKey: "filters.adults" },
];
// Single-select tab list — "" is the "All" tab (clears `collection`
// entirely), matching the department chips' own "All" convention.
const COLLECTION_TABS = [
  { value: "", labelKey: "shop.all" },
  { value: "new", labelKey: "filters.new" },
  { value: "featured", labelKey: "filters.featured" },
  { value: "discount", labelKey: "filters.discount" },
];
const AVAILABILITY_OPTIONS = [
  { value: "in_stock", labelKey: "filters.inStock" },
  { value: "out_of_stock", labelKey: "filters.outOfStock" },
];
// Pure, DOM-free responsive visibility class for the server-rendered
// up-to-12 product buffer (v3-1): cards 1-8 (index 0-7) always visible,
// the 9th (index 8) visible from `md` (tablet), the 10th-12th
// (index 9-11) visible from `lg` (desktop) — exactly the required 8/9/12
// visible-product counts, decided entirely by CSS so server and client
// render identical markup on first paint (zero hydration mismatch, zero
// layout shift). `revealedExtra` (only ever non-zero after a "Load more"
// click on a narrower breakpoint, see showMore()) forces cards beyond the
// always-visible 8 to render unconditionally, ahead of their normal
// breakpoint. Cards beyond the initial 12 (fetched via "Load more") are
// always visible immediately — the responsive clamp only ever applies to
// the original server-rendered buffer.
function initialCardVisibilityClass(index, revealedExtra = 0) {
  if (index >= 12) return "";
  if (index < 8 + revealedExtra) return "";
  // `md:flex`/`lg:flex` (not `block`) — ProductCard's own root element is
  // `flex flex-col`; toggling to `block` instead of `flex` once revealed
  // would silently drop that internal layout for exactly this card.
  if (index === 8) return "hidden md:flex";
  return "hidden lg:flex";
}

const SORTS = [
  { value: "-createdAt", labelKey: "sort.newest" },
  { value: "basePrice", labelKey: "sort.priceLowHigh" },
  { value: "-basePrice", labelKey: "sort.priceHighLow" },
  { value: "-rating", labelKey: "sort.popular" },
  { value: "-isFeatured", labelKey: "filters.featured" },
];
const PAGE_SIZE = 12;

// `allCategories` (not just the top-nav `departments` list) so a
// department reached by drilling into a division (e.g. ?category=<BurqaId>
// after selecting Clothes) still gets its own real title instead of
// falling back to "Shop All" — Burqa isn't a root category any more, but
// it's still a valid, nameable selection.
const computeTitle = (sp, allCategories, t, locale) => {
  const search = sp.get("search");
  if (search) return t("shop.resultsFor", { query: search });
  const deptId = sp.get("category");
  const dept = deptId ? allCategories.find((d) => d._id === deptId) : null;
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

  // Responsive visible-count (12 desktop / 9 tablet / 8 mobile): the FIRST
  // paint is pure server-rendered CSS (per-card nth-position classes below
  // — identical DOM on server and client, zero hydration risk). This hook
  // is only ever consulted post-mount, only to decide how many additional
  // cards a "Load more" click reveals/fetches — never what's in the DOM on
  // first render, so an SSR/client breakpoint mismatch here is harmless.
  const [breakpoint, setBreakpoint] = useState("desktop");
  useEffect(() => {
    const compute = () => {
      if (window.matchMedia("(min-width: 1024px)").matches) setBreakpoint("desktop");
      else if (window.matchMedia("(min-width: 768px)").matches) setBreakpoint("tablet");
      else setBreakpoint("mobile");
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  // How many of the server-rendered up-to-12 buffer are currently forced
  // visible beyond the CSS-driven responsive default (0 until "Load more"
  // is clicked at least once on a narrower breakpoint).
  const [revealedExtra, setRevealedExtra] = useState(0);
  const visibleBuffered = visibleBufferCount(breakpoint, revealedExtra, Math.min(products.length, PAGE_SIZE));

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

  // Canonical, single-select collection tabs (v3-2/v3-6): always clears
  // the legacy new/featured/discount booleans, so the new tab UI never
  // emits a request mixing both shapes (parseProductListQuery rejects that
  // combination outright — this just means the UI never generates it).
  const setCollection = (value) => {
    const next = new URLSearchParams(sp);
    next.delete("new");
    next.delete("featured");
    next.delete("discount");
    if (!value) next.delete("collection");
    else next.set("collection", value);
    next.delete("page");
    setSp(next);
  };

  // Switching department invalidates every style/attribute selection made
  // under the previous one — reset to just the new department. Kept
  // params are the ones that are genuinely cross-department (common
  // filters): sort, search, price, Age Group, Collection (both the
  // canonical param and the legacy booleans), Availability, and Rating.
  // Everything else (style, brand, and every department-specific
  // attribute facet like fabric/shade/shoeSize) is dropped — the same
  // stale-filter-removal guarantee services/productService.js's
  // stripInapplicableAttributeFilters() also enforces server-side as a
  // defensive backstop.
  const selectDepartment = (deptId) => {
    const next = new URLSearchParams();
    for (const k of ["sort", "search", "priceMin", "priceMax", "ageGroup", "collection", "new", "featured", "discount", "availability", "ratingGte"]) {
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
    // First, reveal whatever's still sitting in the server-rendered buffer
    // (up to 12) but responsively hidden — no fetch needed for that. Only
    // once the buffer is fully visible does a click fetch a new page.
    const bufferedHidden = Math.min(products.length, PAGE_SIZE) - visibleBuffered;
    if (bufferedHidden > 0) {
      setRevealedExtra((r) => r + Math.min(bufferedHidden, responsiveBatchSize(breakpoint)));
      return;
    }

    setLoadingMore(true);
    try {
      const query = {};
      for (const [k, v] of sp.entries()) {
        if (k === "priceMin") query.basePrice = { ...(query.basePrice || {}), gte: v };
        else if (k === "priceMax") query.basePrice = { ...(query.basePrice || {}), lte: v };
        else query[k] = v;
      }
      // Server pagination stays a constant PAGE_SIZE (12) per page — the
      // same limit the SSR first page used — so `page`/`skip` math never
      // desyncs (a varying limit here would either skip or re-fetch items
      // relative to the fixed-size first page). Every item from a
      // client-fetched page is immediately visible once it arrives (no
      // further breakpoint-based hiding — the responsive clamp only ever
      // applies to the original server-rendered buffer, see
      // visibleBufferCount()), so the responsive batch size only governs
      // how much of THAT buffer a click reveals, not how much is fetched.
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

  const title = computeTitle(sp, catsData?.categories ?? [], t, locale);
  const selectedDeptObj = selectedDept ? (catsData?.categories ?? []).find((d) => d._id === selectedDept) : null;

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

    for (const opt of COLLECTION_TABS) {
      if (!opt.value) continue; // "All" — nothing to show as a removable chip
      if (sp.get("collection") === opt.value || sp.get(opt.value) === "true") {
        chips.push({ id: `collection:${opt.value}`, label: t(opt.labelKey), onRemove: () => setCollection("") });
      }
    }

    const availabilityVal = sp.get("availability");
    if (availabilityVal) {
      const opt = AVAILABILITY_OPTIONS.find((o) => o.value === availabilityVal);
      if (opt) chips.push({ id: "availability", label: t(opt.labelKey), onRemove: () => setParam("availability", "") });
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
                className="grid h-4 min-w-4 place-items-center rounded-lg bg-verm-contrast px-1 font-mono text-[10px] leading-none text-white"
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
          setCollection={setCollection}
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
              setCollection={setCollection}
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
                  "grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4 transition-opacity",
                  loadingMore && "opacity-60"
                )}
              >
                {products.map((p, i) => (
                  // `priority` is deliberately only passed here: /shop has
                  // no hero image, so this grid's own first card is this
                  // route's genuine LCP candidate (see ProductCard.jsx's
                  // own comment on why every other grid on the site omits
                  // this prop). `initialCardVisibilityClass` is pure,
                  // server-rendered CSS (identical DOM on server and
                  // client) — cards 1-8 always visible, the 9th from `md`,
                  // 10th-12th from `lg`, matching the required 8/9/12
                  // visible-product counts with zero hydration risk; a
                  // "Load more" click can later force cards 9-12 visible
                  // early via `revealedExtra` (see showMore()) without
                  // ever touching first-paint markup.
                  <ProductCard
                    key={p._id}
                    product={p}
                    index={i}
                    attributeMeta={cardAttributeMeta}
                    priority
                    className={initialCardVisibilityClass(i, revealedExtra)}
                  />
                ))}
              </div>

              {/* Show more — visible whenever there's still something to
                  reveal: either buffered-but-responsively-hidden cards
                  (revealed instantly, no fetch) or a real next page. */}
              {(visibleBuffered < Math.min(products.length, PAGE_SIZE) || hasMore) && (
                <div className="mt-10 flex flex-col items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    {t("shop.showingOfTotal", {
                      count: Math.min(products.length, PAGE_SIZE) === products.length
                        ? visibleBuffered
                        : visibleBuffered + (products.length - Math.min(products.length, PAGE_SIZE)),
                      total,
                    })}
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
                    className="grid h-5 min-w-5 place-items-center rounded-lg bg-verm-contrast px-1.5 font-mono text-[11px] text-white"
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

// True only when the current result set actually has more than one
// non-zero Age Group bucket — Cosmetics/Shoes/Sunglasses (every product
// defaulted to "adult") naturally never satisfy this, so the filter simply
// doesn't render there, with no per-department hardcoding at all.
const hasMeaningfulAgeGroupVariety = (counts) => Object.values(counts || {}).filter((c) => c > 0).length > 1;

function FilterPanel({
  sp,
  setSp,
  setParam,
  setCollection,
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
  // Filter layout: Category, Age Group (only when meaningful), Collection,
  // Availability, Rating, [Style / attribute facets / Brand — only once a
  // department narrows what's available], Price Range. Collection/
  // Availability/Rating are permanently visible regardless of department
  // selection — they're common filters, not department-specific ones.
  if (!selectedDept) {
    return (
      <>
        <CategoryFilterGroup
          departments={departments}
          loading={deptLoading}
          selectedDept={selectedDept}
          onSelect={selectDepartment}
        />
        {hasMeaningfulAgeGroupVariety(facets?.ageGroup) && (
          <AgeGroupFilterGroup sp={sp} toggleFacetValue={toggleFacetValue} counts={facets?.ageGroup} />
        )}
        <CollectionTabs sp={sp} setCollection={setCollection} counts={facets?.collection} />
        <AvailabilityFilterGroup sp={sp} setParam={setParam} counts={facets?.availability} />
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

      {hasMeaningfulAgeGroupVariety(facets?.ageGroup) && (
        <AgeGroupFilterGroup sp={sp} toggleFacetValue={toggleFacetValue} counts={facets?.ageGroup} />
      )}
      <CollectionTabs sp={sp} setCollection={setCollection} counts={facets?.collection} />
      <AvailabilityFilterGroup sp={sp} setParam={setParam} counts={facets?.availability} />

      {(groupingsLoading || groupings.length > 0) && (
        <FilterGroup title={t("shop.style")}>
          {groupingsLoading ? (
            <FilterRowSkeleton count={4} />
          ) : (
            groupings.map((g) => (
              <CheckBox
                key={g._id}
                label={`${g.name} (${g.count})`}
                // A leaf grouping (a real style, e.g. Cosmetics' Lipstick)
                // is a facet within the selected department — toggle
                // `?style=`. A non-leaf grouping (a department under a
                // division, e.g. Burqa under Clothes) isn't a style at
                // all — it's a further department to drill into, so it
                // replaces the department selection instead (same as
                // clicking it in the top Category filter).
                checked={g.isLeaf ? sp.get("style") === g._id : selectedDept === g._id}
                onChange={(v) => {
                  if (g.isLeaf) setParam("style", v ? g._id : "");
                  else if (v) selectDepartment(g._id);
                }}
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

// Permanently visible, third group — All / New Arrivals / Featured /
// Discounts as a real single-select tab control (role="tablist"/"tab",
// aria-selected, Left/Right/Home/End keyboard nav — exactly one active tab
// at a time), not a checkbox group: selecting one always replaces the
// previous selection via the canonical `?collection=` param, never ORs
// multiple together the way the legacy boolean params could.
function CollectionTabs({ sp, setCollection, counts }) {
  const { t } = useLocale();
  const active = sp.get("collection") || "";
  const tabRefs = useRef([]);

  const focusAndSelect = (idx) => {
    const tab = COLLECTION_TABS[idx];
    tabRefs.current[idx]?.focus();
    setCollection(tab.value);
  };

  const onKeyDown = (e, idx) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAndSelect((idx + 1) % COLLECTION_TABS.length);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAndSelect((idx - 1 + COLLECTION_TABS.length) % COLLECTION_TABS.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusAndSelect(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusAndSelect(COLLECTION_TABS.length - 1);
    }
  };

  return (
    <div className="mb-5 border-b border-border pb-5">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {t("filters.productCollection")}
      </h3>
      <div role="tablist" aria-label={t("filters.productCollection")} className="flex flex-wrap gap-2">
        {COLLECTION_TABS.map((tab, idx) => {
          const isActive = active === tab.value;
          const count = tab.value ? (counts?.[tab.value] ?? 0) : null;
          return (
            <button
              key={tab.value || "all"}
              ref={(el) => (tabRefs.current[idx] = el)}
              type="button"
              role="tab"
              id={`collection-tab-${tab.value || "all"}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setCollection(tab.value)}
              onKeyDown={(e) => onKeyDown(e, idx)}
              className={cn(
                "h-9 rounded-full border px-3.5 text-xs font-medium transition-colors focus-ring",
                isActive ? "border-ink bg-ink text-canvas" : "border-line text-ink hover:border-ink",
              )}
            >
              {t(tab.labelKey)}
              {count !== null ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Common filter, permanently visible: in-stock vs out-of-stock, computed
// server-side from real purchasable variant stock (see
// services/productService.js's buildFilter — "at least one variant has
// stock > 0"), never a per-department concept.
function AvailabilityFilterGroup({ sp, setParam, counts }) {
  const { t } = useLocale();
  const selected = sp.get("availability") || "";
  return (
    <FilterGroup title={t("filters.availability")}>
      {AVAILABILITY_OPTIONS.map((opt) => {
        const checked = selected === opt.value;
        const count = counts?.[opt.value] ?? 0;
        return (
          <CheckBox
            key={opt.value}
            label={`${t(opt.labelKey)} (${count})`}
            checked={checked}
            disabled={count === 0 && !checked}
            onChange={(v) => setParam("availability", v ? opt.value : "")}
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
