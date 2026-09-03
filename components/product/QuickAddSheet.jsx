"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDispatch, useSelector } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { closeQuickAdd } from "../../store/uiSlice.js";
import { useCart } from "../../hooks/useCart.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { cn, resolveImage } from "../../lib/utils.js";

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The board's size picker, mounted once (like CartDrawer/SearchModal) and
 * opened by any ProductCard via uiSlice's quickAddProduct. Four states live
 * in the CTA alone: no size picked (disabled, "Select a size"), a size picked
 * ("Add to bag"), a size whose last pairs are going ("Add to bag" — the
 * urgency reads through the size button itself, not the CTA), and adding
 * (spinner, disabled, "Adding…").
 */
export default function QuickAddSheet() {
  const product = useSelector((s) => s.ui.quickAddProduct);
  const dispatch = useDispatch();
  const cart = useCart();
  const settings = useSettings();
  const panelRef = useRef(null);
  const [selectedSize, setSelectedSize] = useState(null);
  const [adding, setAdding] = useState(false);

  const open = !!product;

  // Clear the picked size the moment the sheet closes, computed during
  // render rather than in an effect (React's "adjust state on prop change"
  // shape) — see the same pattern in SearchModal/ProductFinder.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setSelectedSize(null);
      setAdding(false);
    }
  }

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
        dispatch(closeQuickAdd());
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

  if (!product) return null;

  const close = () => dispatch(closeQuickAdd());
  // `variants` is the modest-fashion schema; `sizes` is the legacy
  // mock-catalog shape.
  const sizes = product.variants?.length
    ? product.variants.map((v) => ({ size: v.attributes?.size || v.variantName, stock: v.stock }))
    : product.sizes ?? [];
  const stockFor = (size) => sizes.find((s) => s.size === size)?.stock ?? 0;
  const chosenStock = selectedSize ? stockFor(selectedSize) : 0;

  const confirm = async () => {
    if (!selectedSize || adding) return;
    setAdding(true);
    try {
      await cart.addItem({ product, size: selectedSize, quantity: 1 });
      toast.success(`Added ${product.brand?.name ?? ""} ${product.name} · ${selectedSize}`.trim());
      close();
    } catch (e) {
      toast.error(e?.data?.message || "Could not add to your bag");
    } finally {
      setAdding(false);
    }
  };

  const cta = adding ? "Adding…" : selectedSize ? "Add to bag" : "Select a size";

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[205] grid place-items-center p-6"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-black/55"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Choose a size"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className="relative grid w-full max-w-[760px] overflow-hidden rounded-[20px] border border-line bg-surface shadow-soft sm:grid-cols-2"
          >
            <div className="relative hidden min-h-[340px] bg-media sm:block">
              <div aria-hidden="true" className="absolute inset-0 hatch" />
              <div aria-hidden="true" className="absolute inset-0 glow" />
              {product.images?.[0] ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={resolveImage(product.images[0], 480)}
                  alt=""
                  className="relative h-full w-full object-contain p-8"
                />
              ) : (
                <span className="absolute bottom-[18px] left-5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-stone">
                  [Cutout 4:5]
                </span>
              )}
            </div>

            <div className="p-7 sm:p-[30px]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  {product.brand?.name && (
                    <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-stone">
                      {product.brand.name}
                    </div>
                  )}
                  <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.025em]">
                    {product.name}
                  </h2>
                  <div className="mt-1.5 text-[14.5px] text-stone">
                    {[product.colorway, product.colors && `${product.colors} colors`]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <button
                  onClick={close}
                  aria-label="Close size selector"
                  className="grid h-10 w-10 flex-none place-items-center rounded-lg transition-colors hover:bg-wash focus-ring"
                >
                  <X className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>

              <div className="mt-[22px] flex items-baseline justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                  Select size
                </span>
                <Link
                  href="/size-guide"
                  className="text-[13.5px] text-stone underline underline-offset-[3px] hover:text-ink"
                >
                  Size guide
                </Link>
              </div>

              <div
                role="group"
                aria-label="Available sizes"
                className="mt-3 grid grid-cols-5 gap-2"
              >
                {sizes.map((s) => {
                  const stock = s.stock ?? 0;
                  const out = stock <= 0;
                  const low = !out && stock <= 2;
                  const active = selectedSize === s.size;
                  return (
                    <button
                      key={s.size}
                      disabled={out}
                      aria-pressed={active}
                      onClick={() => setSelectedSize(s.size)}
                      className={cn(
                        "relative h-[46px] rounded-lg border text-sm font-medium transition-colors focus-ring",
                        out
                          ? "cursor-not-allowed border-line text-stone/50 line-through"
                          : active
                            ? "border-ink bg-ink text-canvas"
                            : "border-line text-ink hover:border-ink",
                      )}
                      title={
                        out
                          ? `${s.size} — out of stock`
                          : low
                            ? `${s.size} — only ${stock} left`
                            : s.size
                      }
                    >
                      <span data-tabular>{s.size.replace(/^US\s*/i, "")}</span>
                      {low && (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "absolute right-1 top-1 h-1.5 w-1.5 rounded-full",
                            active ? "bg-canvas" : "bg-verm",
                          )}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              {selectedSize && chosenStock > 0 && chosenStock <= 2 && (
                <p className="mt-2.5 text-[13px] text-verm">
                  Only {chosenStock} left in this size
                </p>
              )}

              <p className="mt-3.5 font-mono text-[10.5px] tracking-[0.06em] text-stone">
                Availability shown when live inventory is connected
              </p>

              <button
                onClick={confirm}
                disabled={!selectedSize || adding}
                className={cn(
                  "mt-[22px] flex h-[54px] w-full items-center justify-center gap-2 rounded-[9px] text-base font-semibold transition-colors active:scale-[0.99]",
                  selectedSize && !adding
                    ? "bg-verm text-white hover:bg-ink hover:text-canvas"
                    : "cursor-not-allowed bg-media text-stone",
                )}
              >
                {adding && <Loader2 className="h-4 w-4 animate-spin" />}
                {cta}
              </button>
              <Link
                href={`/product/${product.slug || product._id}`}
                onClick={close}
                className="mt-3.5 block text-center text-sm text-stone underline underline-offset-[3px] hover:text-ink"
              >
                View full details
              </Link>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
