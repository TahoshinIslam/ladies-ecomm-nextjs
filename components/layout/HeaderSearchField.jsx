"use client";

// Leo's header search is a real, always-typeable inline field with a live
// results dropdown underneath it (ui_kits/storefront/shell.jsx's
// SearchField) — not a button that opens something else. This reuses the
// exact same real search endpoint/hook SearchModal.jsx already used
// (useGetProductsQuery, debounced), so results, loading and empty states
// are the same real data — only the presentation moved from a full-screen
// overlay into the header itself. Kept as its own file because it's a
// genuinely different composition (inline combobox vs. modal dialog) that
// SearchModal.jsx cannot also serve as.
import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { useGetProductsQuery } from "../../store/productApi.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { storage, resolveImage, cn } from "../../lib/utils.js";

const RECENT_KEY = "ss:recentSearches";

export default function HeaderSearchField() {
  const { t } = useLocale();
  const settings = useSettings();
  const router = useRouter();
  const listboxId = useId();
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 220);
    return () => clearTimeout(id);
  }, [term]);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const { data, isFetching } = useGetProductsQuery(
    { search: debounced, limit: 6 },
    { skip: !debounced },
  );
  const results = data?.products ?? [];

  const remember = (q) => {
    const prev = storage.getJSON(RECENT_KEY, []);
    storage.setJSON(RECENT_KEY, [q, ...prev.filter((r) => r !== q)].slice(0, 5));
  };

  const goToResults = (q) => {
    if (!q) return;
    remember(q);
    setOpen(false);
    inputRef.current?.blur();
    router.push(`/shop?search=${encodeURIComponent(q)}`);
  };

  const goToProduct = (p) => {
    remember(term.trim());
    setOpen(false);
    router.push(`/product/${p.slug || p._id}`);
  };

  const submit = (e) => {
    e.preventDefault();
    if (activeIndex >= 0 && results[activeIndex]) goToProduct(results[activeIndex]);
    else goToResults(term.trim());
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    }
  };

  const showDropdown = open && debounced.length > 0;

  return (
    <div ref={wrapRef} className="relative mx-auto w-full max-w-[520px]">
      <form role="search" onSubmit={submit} className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-stone"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t("header.searchPlaceholder")}
          aria-label={t("header.searchPlaceholder")}
          className="h-11 w-full rounded-lg border border-line bg-surface pl-10 pr-9 text-[14px] text-ink outline-none transition-colors placeholder:text-stone focus:border-ink"
        />
        {term && (
          <button
            type="button"
            onClick={() => {
              setTerm("");
              setOpen(false);
              inputRef.current?.focus();
            }}
            aria-label={t("common.remove")}
            className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-stone transition-colors hover:bg-wash hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </form>

      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute inset-x-0 top-[calc(100%+6px)] z-[200] overflow-hidden rounded-lg border border-line bg-surface shadow-md"
        >
          {isFetching ? (
            <div className="p-4 text-[13.5px] text-stone">{t("search.searching")}</div>
          ) : results.length === 0 ? (
            <div className="p-4 text-[13.5px] text-stone">
              {t("search.noResultsFor", { query: debounced })}
            </div>
          ) : (
            results.map((p, i) => (
              <button
                key={p._id}
                type="button"
                role="option"
                id={`${listboxId}-${i}`}
                aria-selected={i === activeIndex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => goToProduct(p)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                  i === activeIndex ? "bg-wash" : "hover:bg-wash",
                )}
              >
                <span className="relative h-10 w-10 flex-none overflow-hidden rounded-md bg-media">
                  {p.images?.[0] && (
                    <Image
                      src={resolveImage(p.images[0], 80)}
                      alt=""
                      fill
                      sizes="40px"
                      className="object-contain"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{p.name}</span>
                <span data-tabular className="text-[13px] text-stone">
                  {settings.formatPrice(p.discountPrice ?? p.basePrice)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
