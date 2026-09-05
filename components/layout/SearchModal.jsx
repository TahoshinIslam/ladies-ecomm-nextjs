"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Clock, Search, X } from "lucide-react";

import { setSearchOpen } from "../../store/uiSlice.js";
import { useGetProductsQuery } from "../../store/productApi.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { storage, resolveImage } from "../../lib/utils.js";

const POPULAR = ["Abaya", "Hijab", "Burqa", "Eid"];
const RECENT_KEY = "ss:recentSearches";
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Highlights the matched substring the way the board's search does — a lime
 * <mark>, not bold or color-only, so it reads at a glance even for someone
 * who can't rely on color.
 */
function Highlight({ text, query }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[3px] bg-lime px-0.5 text-[#101012]">
        {text.slice(i, i + query.length)}
      </mark>
      {text.slice(i + query.length)}
    </>
  );
}

export default function SearchModal() {
  const open = useSelector((s) => s.ui.searchOpen);
  const dispatch = useDispatch();
  const router = useRouter();
  const settings = useSettings();
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [recent, setRecent] = useState([]);

  // Reset query state the moment `open` flips, during render rather than in
  // an effect — this is React's recommended "adjust state on prop change"
  // shape: it re-renders once immediately instead of committing stale state
  // to the DOM first and correcting it a tick later.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setRecent(storage.getJSON(RECENT_KEY, []));
    } else {
      setTerm("");
      setDebounced("");
    }
  }

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term]);

  // Focusing the input is an imperative DOM action, not state — it stays in
  // an effect.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Tab stays inside the dialog; Escape closes it.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const onKeydown = (e) => {
      if (e.key === "Escape") {
        dispatch(setSearchOpen(false));
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll(FOCUSABLE));
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
  }, [open, dispatch]);

  const { data, isFetching, isError, refetch } = useGetProductsQuery(
    { search: debounced, limit: 6 },
    { skip: !debounced },
  );
  const results = data?.products ?? [];

  const close = () => dispatch(setSearchOpen(false));

  const remember = (q) => {
    const next = [q, ...recent.filter((r) => r !== q)].slice(0, 5);
    setRecent(next);
    storage.setJSON(RECENT_KEY, next);
  };

  const goToResults = (q) => {
    if (!q) return;
    remember(q);
    close();
    router.push(`/shop?search=${encodeURIComponent(q)}`);
  };

  const goToProduct = (p) => {
    remember(term.trim());
    close();
    router.push(`/product/${p.slug || p._id}`);
  };

  const submit = (e) => {
    e?.preventDefault();
    goToResults(term.trim());
  };

  // Which of the five states is showing — mirrors the board's sc-if ladder
  // (empty / loading / results / none / error) one to one.
  const state = !debounced
    ? "empty"
    : isError
      ? "error"
      : isFetching
        ? "loading"
        : results.length
          ? "results"
          : "none";

  return (
    <AnimatePresence>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search products"
          className="fixed inset-0 z-[200] flex justify-center bg-black/50 p-6 pt-[88px] backdrop-blur-[3px]"
          onClick={close}
        >
          <motion.div
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="flex w-full max-w-[800px] flex-col overflow-hidden rounded-[18px] border border-line bg-surface shadow-soft"
            style={{ maxHeight: "min(680px, 100%)" }}
          >
            <form
              onSubmit={submit}
              className="flex items-center gap-3.5 border-b border-line px-5 py-4"
            >
              <Search className="h-5 w-5 flex-none text-stone" strokeWidth={1.7} />
              <input
                ref={inputRef}
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search abayas, hijabs, fabrics"
                aria-label="Search abayas, hijabs, fabrics"
                className="h-[34px] flex-1 bg-transparent text-xl tracking-[-0.02em] text-ink outline-none placeholder:text-stone"
              />
              {term && (
                <button
                  type="button"
                  onClick={() => setTerm("")}
                  aria-label="Clear search"
                  className="grid h-9 w-9 place-items-center rounded-lg text-stone transition-colors hover:bg-wash hover:text-ink focus-ring"
                >
                  <X className="h-[15px] w-[15px]" />
                </button>
              )}
              <button
                type="button"
                onClick={close}
                className="h-9 rounded-lg border border-line px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-stone focus-ring"
              >
                Esc
              </button>
            </form>

            <div className="overflow-y-auto p-[22px]">
              {state === "empty" && (
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.03em]">
                    What are you looking for?
                  </h2>
                  {recent.length > 0 && (
                    <>
                      <div className="mt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                        Recent
                      </div>
                      <div className="mt-3 flex flex-col">
                        {recent.map((r) => (
                          <button
                            key={r}
                            onClick={() => {
                              setTerm(r);
                              goToResults(r);
                            }}
                            className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-[15.5px] transition-colors hover:bg-wash focus-ring"
                          >
                            <Clock className="h-[15px] w-[15px] text-stone" strokeWidth={1.7} />
                            {r}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="mt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                    Popular searches
                  </div>
                  <div className="mt-3.5 flex flex-wrap gap-2">
                    {POPULAR.map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          setTerm(p);
                          goToResults(p);
                        }}
                        className="h-10 rounded-lg border border-line px-4 text-[14.5px] font-medium transition-colors hover:border-ink hover:bg-wash focus-ring"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {state === "loading" && (
                <div>
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-4 py-3">
                      <div className="skeleton h-[62px] w-[62px] flex-none rounded-[10px]" />
                      <div className="flex-1">
                        <div className="skeleton h-[11px] w-[34%] rounded" />
                        <div className="skeleton mt-2.5 h-3.5 w-[58%] rounded" />
                      </div>
                      <div className="skeleton h-3.5 w-14 rounded" />
                    </div>
                  ))}
                </div>
              )}

              {state === "results" && (
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                    {results.length} {results.length === 1 ? "result" : "results"}
                  </div>
                  <div className="mt-3 flex flex-col">
                    {results.map((p) => (
                      <button
                        key={p._id}
                        onClick={() => goToProduct(p)}
                        className="flex items-center gap-4 rounded-[10px] px-2.5 py-3 text-left transition-colors hover:bg-wash focus-ring"
                      >
                        <span className="relative h-[62px] w-[62px] flex-none overflow-hidden rounded-[10px] bg-media">
                          {p.images?.[0] ? (
                            <Image
                              src={resolveImage(p.images[0], 124)}
                              alt={p.name}
                              fill
                              sizes="62px"
                              loading="lazy"
                              className="object-cover"
                            />
                          ) : (
                            <span aria-hidden="true" className="absolute inset-0 hatch" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-base font-semibold tracking-[-0.015em]">
                            <Highlight text={p.name} query={debounced} />
                          </span>
                          <span className="mt-1 block text-[13.5px] text-stone">
                            {p.category?.name}
                          </span>
                        </span>
                        <span data-tabular className="text-[15.5px] font-semibold">
                          {settings.formatPrice(p.discountPrice ?? p.basePrice)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {state === "none" && (
                <div className="py-11 text-center">
                  <div className="text-[22px] font-semibold tracking-[-0.02em]">
                    We couldn&rsquo;t find that.
                  </div>
                  <p className="mx-auto mt-3 max-w-[38ch] text-base leading-relaxed text-stone">
                    Try another name, style, or fabric.
                  </p>
                  <div className="mt-[26px] flex flex-wrap justify-center gap-2">
                    {POPULAR.map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          setTerm(p);
                          goToResults(p);
                        }}
                        className="h-10 rounded-lg border border-line px-4 text-[14.5px] transition-colors hover:border-ink focus-ring"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {state === "error" && (
                <div className="py-10 text-center">
                  <span className="grid h-[46px] w-[46px] mx-auto place-items-center rounded-full bg-coral text-verm">
                    <AlertCircle className="h-5 w-5" strokeWidth={1.9} />
                  </span>
                  <div className="mt-[18px] text-xl font-semibold">
                    Search is unavailable
                  </div>
                  <p className="mx-auto mt-2.5 max-w-[40ch] text-[15.5px] leading-relaxed text-stone">
                    We lost the connection before results came back. Your bag
                    and saved pairs are unaffected.
                  </p>
                  <button
                    onClick={() => refetch()}
                    className="mt-[22px] h-[46px] rounded-[9px] bg-ink px-[22px] text-[14.5px] font-semibold text-canvas transition-colors hover:bg-verm hover:text-white focus-ring"
                  >
                    Retry search
                  </button>
                </div>
              )}
            </div>

            <div className="flex gap-5 border-t border-line px-5 py-3.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-stone">
              <span>↑↓ Navigate</span>
              <span>↵ Open</span>
              <span>Esc Close</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
