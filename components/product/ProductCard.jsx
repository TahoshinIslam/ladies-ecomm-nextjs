"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { BellRing, Eye, Heart, ImageOff, Scale, ShoppingCart, Star } from "lucide-react";
import { useSelector, useDispatch } from "react-redux";
import { toast } from "sonner";

import {
  useToggleWishlistMutation,
  useGetWishlistQuery,
  usePrefetch,
} from "../../store/shopApi.js";
import { selectCurrentUser } from "../../store/authSlice.js";
import { addToCompare, removeFromCompare, openQuickAdd } from "../../store/uiSlice.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { attrLabel, attrValue, departmentName } from "../../lib/i18n/catalog.js";
import FramedImage from "../ui/FramedImage.jsx";
import { framingForUrl } from "../../lib/imageFraming.js";
import { cn, resolveImage, effectivePrice, isRealDiscount } from "../../lib/utils.js";

/**
 * EShopper's product-item card: a single bordered box (image, then a
 * centered name/price body, then a two-link footer row — "View Detail" /
 * "Add To Cart") rather than a borderless floating plate. Wishlist and
 * compare are real features the template has no equivalent for, so they
 * stay as small icon buttons overlaid on the image corner rather than
 * being dropped.
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
  // Warms QuickAddSheet's own attributes query (the same whole-collection
  // cache entry, undefined args — see QuickAddSheet.jsx) on hover/focus, so
  // by the time a shopper actually clicks Quick Add the data is already
  // resolved instead of only starting to fetch after the sheet opens.
  const prefetchAttributes = usePrefetch("getAttributes");
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

  const price = effectivePrice(product);
  const discounted = isRealDiscount(product);

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
      onMouseEnter={() => {
        setHovered(true);
        prefetchAttributes(undefined);
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => prefetchAttributes(undefined)}
      className={cn("group relative flex flex-col overflow-hidden rounded-lg border border-line", className)}
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
      <div className="relative aspect-4/5 overflow-hidden border-b border-line bg-media">
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
              framingForUrl(product.imageFraming, product.images[0]) ? (
                // Saved crop/fit for this photo (Admin → Products → Adjust framing):
                // same FramedImage the editor previews with. Unframed photos
                // keep the object-contain render below, unchanged.
                <FramedImage
                  src={product.images[0]}
                  framing={framingForUrl(product.imageFraming, product.images[0])}
                  placement="product.gallery"
                  alt={product.name}
                  sizes="(max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
                  loading={priority && index < 6 ? "eager" : "lazy"}
                  fetchPriority={priority && index === 0 ? "high" : "auto"}
                  onError={() => setImageFailed(true)}
                />
              ) : (
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
                // `object-contain`, not `object-cover`: the card box is a
                // fixed 4:5 plate, but not every uploaded product photo is
                // shot at 4:5 — a taller/narrower photo under `cover` gets
                // its top and bottom sliced off (a model's head or feet)
                // to fill the box. `contain` always shows the whole photo,
                // letterboxed on `bg-media` when the ratio doesn't match.
                className="object-contain"
                onError={() => setImageFailed(true)}
              />
              )
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
        </div>

        {/* Body — EShopper's card-body: centered, truncated name then
            price (+ struck-through compare-at price) on one line. Brand/
            category, rating, fabric, and swatches are real data the
            template has no fields for at all — kept, but folded into this
            centered layout rather than Leo's left-aligned stack. */}
        <Link href={href} className="block min-w-0 border-b border-line px-3 pb-3 pt-4 text-center focus-ring">
          {(categoryName || product.brand?.name) && (
            <div className="text-[11px] uppercase tracking-[0.08em] text-stone">
              {product.brand?.name || categoryName}
            </div>
          )}
          <h3 className="mt-1 truncate text-[14px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink md:text-[15.5px]">
            {product.name}
          </h3>
          <div className="mt-1 flex items-center justify-center gap-1">
            <span className="flex items-center gap-0.5" aria-hidden="true">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={cn(
                    "h-3 w-3",
                    i < Math.round(product.rating || 0) ? "fill-current text-star" : "text-line",
                  )}
                />
              ))}
            </span>
            <span className="text-[12px] text-stone">
              {product.rating > 0 ? `(${product.numReviews ?? 0})` : t("product.noReviewsYet")}
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-center gap-2">
            <span data-tabular className="text-[15.5px] font-semibold text-ink">
              {settings.formatPrice(price, product.priceCurrency)}
            </span>
            {discounted && (
              <span data-tabular className="text-[13px] text-stone line-through">
                {settings.formatPrice(product.basePrice, product.priceCurrency)}
              </span>
            )}
          </div>
          {(fabric || colorCount > 1) && (
            <div className="mt-1 text-[12.5px] text-stone">
              {[fabric, colorCount > 1 && t("product.colorsCount", { count: colorCount })]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
          {(colorValues.length > 0 || sizeValues.length > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1">
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
                    <span className="text-[10px] text-stone">
                      +{colorValues.length - VISIBLE_SWATCHES}
                    </span>
                  )}
                </span>
              )}
              {sizeValues.length > 0 && (
                <span className="text-[10.5px] uppercase tracking-[0.04em] text-stone">
                  {sizeLabel}: {sizeValues.slice(0, VISIBLE_SIZES).map((v) => attrValue(locale, "size", v)).join(" · ")}
                  {sizeValues.length > VISIBLE_SIZES ? "…" : ""}
                </span>
              )}
            </div>
          )}
        </Link>

        {/* Footer — EShopper's own two-link row (View Detail | Add To
            Cart) instead of Leo's single persistent full-width button. */}
        <div className="flex items-center justify-between bg-wash px-3 py-2.5 text-[13px] font-medium">
          <Link href={href} className="flex items-center gap-1.5 text-ink transition-colors hover:text-verm focus-ring">
            <Eye className="h-3.5 w-3.5 text-verm" strokeWidth={1.8} />
            {t("product.viewDetail")}
          </Link>
          {isUnavailable ? (
            <button
              onClick={handleNotify}
              className="flex items-center gap-1.5 text-ink transition-colors hover:text-verm focus-ring"
            >
              <BellRing className="h-3.5 w-3.5 text-verm" strokeWidth={1.8} />
              {t("product.notifyIfReturns")}
            </button>
          ) : (
            <button
              onClick={handleQuickAdd}
              className="flex items-center gap-1.5 text-ink transition-colors hover:text-verm focus-ring"
            >
              <ShoppingCart className="h-3.5 w-3.5 text-verm" strokeWidth={1.8} />
              {product.variants?.length > 1 ? t("quickAddSheet.chooseOptions") : t("product.quickAdd")}
            </button>
          )}
        </div>
    </motion.article>
  );
}
