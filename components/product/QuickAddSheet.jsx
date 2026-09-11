"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useDispatch, useSelector } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { closeQuickAdd, setCartOpen } from "../../store/uiSlice.js";
import { useCart } from "../../hooks/useCart.js";
import { useGetAttributesQuery } from "../../store/shopApi.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { attrLabel as translateAttrLabel, attrValue as translateAttrValue, departmentName } from "../../lib/i18n/catalog.js";
import {
  cn,
  resolveImage,
  getVariantAxes,
  getAxisOptions,
  resolveVariant,
  getDefaultVariantSelection,
  repairVariantSelection,
  resolveVariantPricing,
} from "../../lib/utils.js";
import useDialogFocus from "../../hooks/useDialogFocus.js";

/**
 * The board's variant picker, mounted once (like CartDrawer/SearchModal) and
 * opened by any ProductCard via uiSlice's quickAddProduct. Resolves a real
 * selectedVariant (color/size/fabric) the same way ProductDetailPage.jsx
 * does — not a bare size string, which collapsed different-colored variants
 * into indistinguishable buttons (see Phase 4 audit).
 */
export default function QuickAddSheet() {
  const product = useSelector((s) => s.ui.quickAddProduct);
  const dispatch = useDispatch();
  const cart = useCart();
  const settings = useSettings();
  const { t, locale } = useLocale();
  const panelRef = useRef(null);
  const [selection, setSelection] = useState({});
  const [adding, setAdding] = useState(false);

  const open = !!product;
  const variants = product?.variants ?? [];
  const { data: attrData } = useGetAttributesQuery(product?.topCategory, {
    skip: !product?.topCategory,
  });
  const attrDefs = attrData?.attributes ?? [];
  // Candidate variant axes for this product's department come from
  // AttributeDefinition.derivedFromVariant — never a fixed clothing-only
  // list — same as ProductDetailInteractive.jsx.
  const candidateAxes = attrDefs.filter((d) => d.derivedFromVariant).map((d) => d.key);
  const axes = getVariantAxes(variants, candidateAxes);
  // The DB always stores these in English — translateAttrLabel/Value
  // overlay a Bangla translation for every known seeded key/value (see
  // lib/i18n/catalog.js), same fix as ProductDetailPage.jsx.
  const attrLabel = (key) => translateAttrLabel(locale, key, attrDefs.find((d) => d.key === key)?.label);
  const attrOptions = (key) =>
    (attrDefs.find((d) => d.key === key)?.options ?? []).map((o) => ({
      ...o,
      label: translateAttrValue(locale, key, o.value, o.label),
    }));

  // Reseed the selection whenever the open product changes (a new product,
  // or closing back to none), or once candidateAxes finishes loading for the
  // same product (useGetAttributesQuery resolves after this sheet's first
  // render, so an empty candidateAxes on that first pass must not stick) —
  // React's "adjust state on prop change" shape, same pattern already used
  // for the sheet's open/close transitions.
  const axesKey = candidateAxes.join(",");
  const [lastSeed, setLastSeed] = useState(() => `${product?._id ?? null}|${axesKey}`);
  const seedKey = `${product?._id ?? null}|${axesKey}`;
  if (seedKey !== lastSeed) {
    setLastSeed(seedKey);
    setSelection(product ? getDefaultVariantSelection(product.variants ?? [], candidateAxes) : {});
    setAdding(false);
  }

  // Moves focus into the panel on open, traps Tab, closes on Escape, and
  // restores focus to the triggering product card on close — this sheet
  // previously did none of the focus-in/focus-restore parts (only the
  // scroll-lock and a partial Tab trap existed).
  useDialogFocus({ open, panelRef, onClose: () => dispatch(closeQuickAdd()) });

  if (!product) return null;

  const close = () => dispatch(closeQuickAdd());
  const selectedVariant = resolveVariant(variants, selection, axes);
  const pricing = resolveVariantPricing(product, selectedVariant);

  const setAxisValue = (axis, value) => {
    setSelection((prev) => repairVariantSelection(variants, { ...prev, [axis]: value }, axes, axis));
  };

  const confirm = async () => {
    if (!selectedVariant || adding) return;
    setAdding(true);
    try {
      await cart.addItem({ product, variant: selectedVariant, quantity: 1 });
      toast.success(t("quickAddSheet.addedToBag", { name: product.name, variant: selectedVariant.variantName }).trim());
      close();
      dispatch(setCartOpen(true));
    } catch (e) {
      toast.error(e?.data?.message || t("quickAddSheet.addToBagFailed"));
    } finally {
      setAdding(false);
    }
  };

  const missingAxisLabel = axes.find((a) => !selection[a]);
  const cta = adding
    ? t("quickAddSheet.adding")
    : !selectedVariant
      ? t("quickAddSheet.selectOption", { option: (attrLabel(missingAxisLabel) || missingAxisLabel || "").toLowerCase() })
      : pricing.stock <= 0
        ? t("quickAddSheet.outOfStock")
        : t("quickAddSheet.addToBag");
  const canAdd = !!selectedVariant && pricing.stock > 0 && !adding;

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
            aria-label={t("quickAddSheet.chooseOptions")}
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
              {(selectedVariant?.images?.[0] || product.images?.[0]) ? (
                <Image
                  src={resolveImage(selectedVariant?.images?.[0] || product.images[0], 480)}
                  alt={product.name}
                  fill
                  sizes="380px"
                  className="object-contain"
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
                  {product.category?.name && (
                    <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-stone">
                      {departmentName(locale, product.category.slug, product.category.name)}
                    </div>
                  )}
                  <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.025em]">
                    {product.name}
                  </h2>
                  <div data-tabular className="mt-1.5 text-[16px] font-semibold text-ink">
                    {settings.formatPrice(pricing.displayPrice)}
                  </div>
                </div>
                <button
                  onClick={close}
                  aria-label={t("quickAddSheet.closeOptions")}
                  className="grid h-10 w-10 flex-none place-items-center rounded-lg transition-colors hover:bg-wash focus-ring"
                >
                  <X className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>

              {axes.map((axis) => (
                <div key={axis} className="mt-[18px]">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                      {attrLabel(axis) || axis}
                    </span>
                    {axis === "size" && (
                      <Link
                        href="/size-guide"
                        className="text-[13.5px] text-stone underline underline-offset-[3px] hover:text-ink"
                      >
                        {t("quickAddSheet.sizeGuide")}
                      </Link>
                    )}
                  </div>
                  <div
                    role="group"
                    aria-label={t("quickAddSheet.availableOption", { option: attrLabel(axis) || axis })}
                    className="mt-3 grid grid-cols-5 gap-2"
                  >
                    {getAxisOptions(variants, axis).map((opt) => {
                      const low = !opt.disabled && (() => {
                        const v = resolveVariant(variants, { ...selection, [axis]: opt.value }, axes);
                        return v && v.stock > 0 && v.stock <= 2;
                      })();
                      const active = selection[axis] === opt.value;
                      const label = attrOptions(axis).find((o) => o.value === opt.value)?.label || opt.value;
                      return (
                        <button
                          key={opt.value}
                          disabled={opt.disabled}
                          aria-pressed={active}
                          onClick={() => setAxisValue(axis, opt.value)}
                          className={cn(
                            "relative h-[46px] rounded-lg border text-sm font-medium transition-colors focus-ring",
                            opt.disabled
                              ? "cursor-not-allowed border-line text-stone/50 line-through"
                              : active
                                ? "border-ink bg-ink text-canvas"
                                : "border-line text-ink hover:border-ink",
                          )}
                          title={opt.disabled ? t("quickAddSheet.outOfStockOption", { label }) : label}
                        >
                          <span data-tabular>{label}</span>
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
                </div>
              ))}

              {selectedVariant && pricing.stock > 0 && pricing.stock <= 2 && (
                <p className="mt-2.5 text-[13px] text-verm">
                  {t("product.lowStock", { count: pricing.stock })}
                </p>
              )}

              <button
                onClick={confirm}
                disabled={!canAdd}
                className={cn(
                  "mt-[22px] flex h-[54px] w-full items-center justify-center gap-2 rounded-[9px] text-base font-semibold transition-colors active:scale-[0.99]",
                  canAdd
                    ? "bg-verm-contrast text-white hover:bg-ink hover:text-canvas"
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
                {t("quickAddSheet.viewFullDetails")}
              </Link>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
