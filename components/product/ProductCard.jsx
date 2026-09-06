"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { BellRing, Heart, ImageOff, Scale } from "lucide-react";
import { useSelector, useDispatch } from "react-redux";
import { toast } from "sonner";

import {
  useToggleWishlistMutation,
  useGetWishlistQuery,
} from "../../store/shopApi.js";
import { selectCurrentUser } from "../../store/authSlice.js";
import { addToCompare, removeFromCompare, openQuickAdd } from "../../store/uiSlice.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { attrLabel, attrValue, departmentName } from "../../lib/i18n/catalog.js";
import { cn, resolveImage } from "../../lib/utils.js";

/**
 * The board's card is a 4:5 media plate on the surface colour with the product
 * floating on it — no card border, no shadow. Depth comes from the hatch, the
 * contact shadow under the shoe, and a 1.6° tilt on hover; the quick-add bar
 * rises into the plate rather than covering the whole image.
 */
export default function ProductCard({ product, className, index = 0, onQuickAdd, attributeMeta, priority = false }) {
  const user = useSelector(selectCurrentUser);
  const dispatch = useDispatch();
  const settings = useSettings();
  const { t, locale } = useLocale();
  const [hovered, setHovered] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const [toggleWishlist, { isLoading: wlLoading }] = useToggleWishlistMutation();
  const { data: wlData } = useGetWishlistQuery(undefined, { skip: !user });
  const compareList = useSelector((s) => s.ui.compareList);

  const isCompared = compareList.includes(product._id);
  const compareFull = !isCompared && compareList.length >= 4;
  const isWished = !!wlData?.wishlist?.products?.some(
    (p) => (p._id || p) === product._id,
  );

  // Unavailable when every variant/size is out of stock. `variants` is the
  // modest-fashion schema; `sizes` is the legacy mock-catalog shape — check
  // both so this works against either data source.
  const isUnavailable = product.variants?.length
    ? product.variants.every((v) => (v.stock ?? 0) <= 0)
    : product.sizes?.length
    ? product.sizes.every((s) => (s.stock ?? 0) <= 0)
    : product.stock === 0;

  const price = product.discountPrice ?? product.basePrice;
  const discounted =
    product.discountPrice && product.discountPrice < product.basePrice;

  const categoryName = departmentName(locale, product.category?.slug, product.category?.name);
  const fabric = product.attributes
    ?.find((a) => a.key === "fabric")
    ?.values.map((v) => attrValue(locale, "fabric", v)).join(", ");
  const colorValues = product.attributes?.find((a) => a.key === "color")?.values ?? [];
  const colorCount = colorValues.length;
  const sizeValues = product.attributes?.find((a) => a.key === "size")?.values ?? [];
  // "Size" reads as "Length" for Burqa/Khimar etc — same per-department
  // override AttributeDefinition drives on the PDP and filter sidebar,
  // resolved here against this card's own topCategory so a mixed "Shop
  // all" grid still labels each card correctly. attrLabel() (which checks
  // this app's own translation map first) takes priority over the DB's own
  // label/labelOverrides, same fix as ProductDetailPage/ShopPage — see
  // lib/i18n/catalog.js.
  const sizeLabel = attrLabel(
    locale,
    "size",
    attributeMeta?.sizeDef?.labelOverrides?.find(
      (o) => String(o.category) === String(product.topCategory),
    )?.label ||
      attributeMeta?.sizeDef?.label ||
      t("product.size"),
  );
  const hexForColor = (value) =>
    attributeMeta?.colorDef?.options?.find((o) => o.value === value)?.swatchHex;
  const VISIBLE_SWATCHES = 4;
  const VISIBLE_SIZES = 5;
  const availabilityLabel =
    product.availability === "preOrder"
      ? t("product.preOrder")
      : product.availability === "madeToOrder"
        ? t("product.madeToOrder")
        : null;

  const handleWishlist = async (e) => {
    e.preventDefault();
    if (!user) {
      toast.error(t("product.signInToSave"));
      return;
    }
    try {
      const res = await toggleWishlist(product._id).unwrap();
      toast.success(res.added ? t("product.saved") : t("product.removedFromSaved"));
    } catch {
      toast.error(t("product.saveFailed"));
    }
  };

  const handleCompare = (e) => {
    e.preventDefault();
    if (isCompared) {
      dispatch(removeFromCompare(product._id));
      return;
    }
    if (compareFull) {
      toast.error(t("product.compareLimitReached"));
      return;
    }
    dispatch(addToCompare(product._id));
  };

  // A single QuickAddSheet instance lives in the storefront layout (same
  // pattern as CartDrawer/SearchModal); the card just tells it which product
  // to open for. `onQuickAdd` stays available as an override for callers that
  // want different behavior (e.g. the compare tray).
  const handleQuickAdd = (e) => {
    e.preventDefault();
    if (onQuickAdd) onQuickAdd(product);
    else dispatch(openQuickAdd(product));
  };

  const handleNotify = (e) => {
    e.preventDefault();
    toast.success(t("product.notifySuccess"));
  };

  const href = `/product/${product.slug || product._id}`;

  return (
    <motion.article
      id={`product-${product._id}`}
      data-reveal
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-8% 0px -12%" }}
      transition={{ duration: 0.5, delay: Math.min(index, 7) * 0.06, ease: [0.16, 1, 0.3, 1] }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn("group relative flex flex-col", className)}
    >
      {/* Phase 10 — the image area and the action buttons (wishlist/
          compare/quick-add/notify) are siblings, not a <button> nested
          inside this <Link>'s <a>: an anchor cannot validly contain other
          interactive content (WHATWG "transparent content model"
          exception excludes it), and browsers/AT are inconsistent about
          exposing a nested button's own role/name when it happens
          anyway. The image Link fills the box via `absolute inset-0`
          (identical visual result to the old flow-layout wrapper); the
          buttons sit in their own `z-10` layer above it so they keep
          receiving their own clicks/focus, and the name/price block below
          is its own separate real link. */}
      <div className="relative aspect-4/5 overflow-hidden rounded-[14px] bg-media">
        <Link href={href} aria-label={product.name} className="absolute inset-0 z-0 focus-ring rounded-[14px]">
          <div aria-hidden="true" className="absolute inset-0 hatch" />
          <div aria-hidden="true" className="absolute inset-0 glow" />

          <div
            className="absolute inset-0 grid place-items-center transition-transform duration-[220ms]"
            style={{
              transform: hovered && !isUnavailable ? "scale(1.045)" : "none",
              opacity: isUnavailable ? 0.45 : 1,
            }}
          >
            {product.images?.[0] && !imageFailed ? (
              // Absolutely positioned rather than w-full/h-full on purpose:
              // this wrapper is `grid place-items-center` for the
              // text-fallback branches below, and a grid item sized only via
              // w-full/h-full doesn't stretch under place-items:center — it
              // falls back to its own intrinsic (natural photo) aspect ratio
              // instead, leaving visible gaps. Taking the img out of grid
              // flow with `absolute inset-0` sizes it from the box's own
              // edges, independent of its natural ratio.
              <Image
                src={resolveImage(product.images[0], 640)}
                alt={product.name}
                fill
                sizes="(max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
                // `priority` is only ever passed by the ONE grid on a page
                // that's genuinely this route's above-the-fold, no-hero
                // content (see ShopPageClient.jsx) — every other call site
                // (Home's secondary sections, product-detail's related/
                // recently-viewed rails, wishlist) renders below other
                // priority content or below the fold, so it must stay
                // plain lazy/auto regardless of its own local index.
                loading={priority && index < 6 ? "eager" : "lazy"}
                fetchPriority={priority && index === 0 ? "high" : "auto"}
                className="object-cover"
                onError={() => setImageFailed(true)}
              />
            ) : imageFailed ? (
              <span className="relative flex flex-col items-center gap-2 px-4 text-center text-stone">
                <ImageOff className="h-5 w-5" strokeWidth={1.6} />
                <span className="font-mono text-[10.5px] uppercase leading-[1.7] tracking-[0.08em]">
                  {t("product.imageDidntLoad")}
                  <br />
                  {product.name}
                </span>
              </span>
            ) : (
              <span className="relative px-4 text-center font-mono text-[10.5px] uppercase leading-[1.7] tracking-[0.08em] text-stone">
                {product.name}
              </span>
            )}
          </div>

          {isUnavailable ? (
            <span className="absolute left-3 top-3 inline-flex items-center rounded-md bg-ink/85 px-2.5 py-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.1em] text-canvas">
              {t("product.soldOut")}
            </span>
          ) : availabilityLabel ? (
            <span className="absolute left-3 top-3 inline-flex items-center rounded-md bg-ink/85 px-2.5 py-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.1em] text-canvas">
              {availabilityLabel}
            </span>
          ) : discounted ? (
            <span className="absolute left-3 top-3 inline-flex items-center rounded-md bg-verm-contrast px-2.5 py-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.1em] text-white">
              {t("product.discountBadge", {
                percent: Math.round(
                  ((product.basePrice - product.discountPrice) / product.basePrice) * 100,
                ),
              })}
            </span>
          ) : null}
        </Link>

        {/* Save / compare */}
        <div className="absolute right-2.5 top-2.5 z-10 flex flex-col gap-2">
            <button
              onClick={handleWishlist}
              disabled={wlLoading}
              aria-label={isWished ? t("product.removeSavedProduct", { name: product.name }) : t("product.saveProduct", { name: product.name })}
              aria-pressed={isWished}
              className={cn(
                "grid h-[38px] w-[38px] place-items-center rounded-lg border border-line bg-elev transition-colors hover:border-ink focus-ring active:scale-95",
                isWished ? "text-verm" : "text-ink",
              )}
            >
              <Heart
                className="h-[17px] w-[17px]"
                strokeWidth={1.7}
                fill={isWished ? "currentColor" : "none"}
              />
            </button>
            <button
              onClick={handleCompare}
              aria-label={isCompared ? t("product.removeCompareProduct", { name: product.name }) : t("product.compareProduct", { name: product.name })}
              aria-pressed={isCompared}
              className={cn(
                "grid h-[38px] w-[38px] place-items-center rounded-lg border border-line bg-elev opacity-0 transition-[opacity,color,border-color] hover:border-ink focus-ring focus-visible:opacity-100 group-hover:opacity-100",
                isCompared && "border-ink text-verm opacity-100",
                compareFull && "opacity-40",
              )}
            >
              <Scale className="h-[17px] w-[17px]" strokeWidth={1.7} />
            </button>
          </div>

          {/* Quick add / restock notice */}
          {isUnavailable ? (
            <div className="absolute inset-x-2.5 bottom-2.5">
              <button
                onClick={handleNotify}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-line bg-elev text-sm font-semibold text-ink transition-colors hover:border-ink focus-ring active:scale-[0.985]"
              >
                <BellRing className="h-4 w-4" strokeWidth={1.8} />
                {t("product.notifyIfReturns")}
              </button>
            </div>
          ) : (
            // CSS-driven visibility (group-hover/group-focus-within),
            // never tabIndex-gated: the button previously only entered
            // the tab order while `hovered` (a mouse-only state) was
            // true, making it permanently unreachable by keyboard. It
            // stays a real, always-focusable button; only its visibility
            // reacts to hover/focus-within the card.
            <div
              className={cn(
                "absolute inset-x-2.5 bottom-2.5 opacity-0 transition-[opacity,transform] duration-200 translate-y-2",
                "group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100",
              )}
            >
              <button
                onClick={handleQuickAdd}
                className="h-11 w-full rounded-lg bg-ink text-sm font-semibold text-canvas transition-colors hover:bg-verm-contrast hover:text-white focus-ring active:scale-[0.985]"
              >
                {t("product.quickAdd")}
              </button>
            </div>
          )}
        </div>

        <Link href={href} className="mt-3.5 flex items-start justify-between gap-3.5 focus-ring rounded-md">
          <div className="min-w-0">
            {categoryName && (
              <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-stone">
                {categoryName}
              </div>
            )}
            <h3 className="mt-1.5 text-[17.5px] font-semibold leading-[1.25] tracking-[-0.015em] text-ink">
              {product.name}
            </h3>
            <div className="mt-1.5 text-[13.5px] text-stone">
              {[fabric, colorCount > 1 && t("product.colorsCount", { count: colorCount }), product.brand?.name]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {(colorValues.length > 0 || sizeValues.length > 0) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                {colorValues.length > 0 && (
                  <span className="flex items-center gap-1">
                    {colorValues.slice(0, VISIBLE_SWATCHES).map((v) => (
                      <span
                        key={v}
                        aria-hidden="true"
                        title={v}
                        className="h-3.5 w-3.5 flex-none rounded-full border border-line"
                        style={{ backgroundColor: hexForColor(v) || "#d4d4d4" }}
                      />
                    ))}
                    {colorValues.length > VISIBLE_SWATCHES && (
                      <span className="font-mono text-[10px] text-stone">
                        +{colorValues.length - VISIBLE_SWATCHES}
                      </span>
                    )}
                  </span>
                )}
                {sizeValues.length > 0 && (
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-stone">
                    {sizeLabel}: {sizeValues.slice(0, VISIBLE_SIZES).map((v) => attrValue(locale, "size", v)).join(" · ")}
                    {sizeValues.length > VISIBLE_SIZES ? "…" : ""}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-none flex-col items-end">
            <span data-tabular className="text-[16.5px] font-semibold text-ink">
              {settings.formatPrice(price)}
            </span>
            {discounted && (
              <span
                data-tabular
                className="text-[13px] text-stone line-through"
              >
                {settings.formatPrice(product.basePrice)}
              </span>
            )}
          </div>
        </Link>
    </motion.article>
  );
}
