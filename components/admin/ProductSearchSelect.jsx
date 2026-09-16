"use client";

// A searchable product combobox for the promotion editor's "target: product"
// field — stores only the product id (`value`); the storefront resolves the
// actual public URL from live product data at read time
// (services/promotionService.js's resolvePromotionTarget()), so this
// component never asks an admin to paste a product URL.
import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import { useGetProductsQuery } from "../../store/productApi.js";
import { cn } from "../../lib/utils.js";

export default function ProductSearchSelect({ value, onChange, label = "Product" }) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);

  const { data, isFetching } = useGetProductsQuery(
    { search: debounced, limit: 8 },
    { skip: debounced.length < 2 },
  );
  const results = useMemo(() => data?.products ?? [], [data]);

  // Selected product's own name isn't known from just the id. `pickedLabel`
  // (set directly in the onClick handler below) covers the normal
  // pick-from-search-results flow; `useMemo` (not state+effect — this is a
  // pure derivation of already-available data, not a synchronization with
  // an external system) covers the edit-an-existing-promotion case where
  // `value` arrives from outside before any search has run, as long as a
  // search for it happens to already be in the current results. Either way
  // falls back to the raw id, never a blank label.
  const [pickedLabel, setPickedLabel] = useState("");
  const selectedLabel = useMemo(() => pickedLabel || results.find((p) => p._id === value)?.name || "", [pickedLabel, results, value]);

  if (value) {
    return (
      <div>
        {label && <p className="mb-1.5 block text-sm font-medium text-ink">{label}</p>}
        <div className="flex items-center justify-between rounded-lg border border-line bg-wash px-3 py-2.5 text-sm">
          <span className="truncate">{selectedLabel || value}</span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setPickedLabel("");
              setTerm("");
            }}
            aria-label="Clear selected product"
            className="ml-2 grid h-6 w-6 flex-none place-items-center rounded-full text-stone hover:bg-line focus-ring"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {label && <label className="mb-1.5 block text-sm font-medium text-ink">{label}</label>}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone" />
        <input
          type="text"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search products by name…"
          className="w-full rounded-lg border border-line bg-elev py-2.5 pl-9 pr-3 text-sm outline-none focus:border-ink"
        />
      </div>
      {open && debounced.length >= 2 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-elev shadow-soft"
        >
          {isFetching ? (
            <li className="px-3 py-2.5 text-sm text-stone">Searching…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-stone">No products found</li>
          ) : (
            results.map((p) => (
              <li key={p._id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()} // keep focus so onBlur doesn't fire first
                  onClick={() => {
                    onChange(p._id);
                    setPickedLabel(p.name);
                    setTerm("");
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-wash",
                  )}
                >
                  <span className="truncate">{p.name}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
