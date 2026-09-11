"use client";

// Phase 7 — the interactive body of the product-detail page: gallery
// selection, variant selection, quantity, add-to-cart, wishlist, and the
// review/related/recently-viewed islands. `product`/`relatedProducts`/
// `attrDefs` all arrive as plain, already-localized, already-serialized
// props from the Server Component (views/ProductDetailPage.jsx) — no
// useGetProductQuery/useGetRelatedProductsQuery/useGetAttributesQuery
// fetch is needed to see the product itself; RTK Query here is reserved
// for genuinely interactive, user-owned state (wishlist membership/toggle,
// cart).
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSelector, useDispatch } from "react-redux";
import { motion } from "framer-motion";
import {
  Heart,
  Home,
  ShoppingBag,
  Minus,
  Plus,
  Truck,
  RefreshCw,
  Shield,
  ImageOff,
} from "lucide-react";
import { toast } from "sonner";

import Button from "../../components/ui/Button.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Rating from "../../components/ui/Rating.jsx";
import Breadcrumb from "../../components/ui/Breadcrumb.jsx";
import ProductRail from "../../components/product/ProductRail.jsx";
import RecentlyViewedRail from "../../components/product/RecentlyViewedRail.jsx";
import ReviewList from "../../components/review/ReviewList.jsx";

import { useToggleWishlistMutation, useGetWishlistQuery } from "../../store/shopApi.js";
import { selectCurrentUser } from "../../store/authSlice.js";
import { setCartOpen } from "../../store/uiSlice.js";
import { useCart } from "../../hooks/useCart.js";
import { recordProductView } from "../../hooks/useRecentlyViewed.js";
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
import { useSettings } from "../../context/SettingsContext.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { attrLabel as translateAttrLabel, attrValue as translateAttrValue, departmentName } from "../../lib/i18n/catalog.js";

const AGE_GROUP_KEYS = { kids: "filters.kids", girls: "filters.girls", adult: "filters.adults" };

export default function ProductDetailInteractive({ product, relatedProducts, attrDefs: attrDefsProp }) {
  const { t, locale } = useLocale();
  const settings = useSettings();
  const freeShipAmount = settings.freeShippingPitch();
  // Stable empty-array identity when there's no prop, so the useMemo below
  // (which depends on attrDefs) doesn't invalidate on every render.
  const attrDefs = useMemo(() => attrDefsProp ?? [], [attrDefsProp]);

  // Records the view only once, on mount — the server already guaranteed
  // this is a real, currently-displayed product (see the Server Component's
  // own notFound() handling for anything else).
  useEffect(() => {
    recordProductView(product._id);
  }, [product._id]);

  const attrLabel = (key) => translateAttrLabel(locale, key, attrDefs.find((d) => d.key === key)?.label);
  const attrOptions = (key) =>
    (attrDefs.find((d) => d.key === key)?.options ?? []).map((o) => ({
      ...o,
      label: translateAttrValue(locale, key, o.value, o.label),
    }));

  const user = useSelector(selectCurrentUser);
  const dispatch = useDispatch();
  const cart = useCart();
  const [adding, setAdding] = useState(false);
  const [toggleWishlist] = useToggleWishlistMutation();
  const { data: wlData } = useGetWishlistQuery(undefined, { skip: !user });

  const [selectedImage, setSelectedImage] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const variants = useMemo(() => product?.variants ?? [], [product]);
  // Candidate variant axes for this product's department come from
  // AttributeDefinition.derivedFromVariant (color/size/fabric for clothing,
  // shade/volumeMl for cosmetics, ...) — never a fixed clothing-only list.
  const candidateAxes = useMemo(() => attrDefs.filter((d) => d.derivedFromVariant).map((d) => d.key), [attrDefs]);
  const axes = useMemo(() => getVariantAxes(variants, candidateAxes), [variants, candidateAxes]);
  const [selection, setSelection] = useState(() => getDefaultVariantSelection(variants, candidateAxes));

  const selectedVariant = useMemo(() => resolveVariant(variants, selection, axes), [variants, selection, axes]);
  const pricing = resolveVariantPricing(product ?? {}, selectedVariant);

  const setAxisValue = (axis, value) => {
    setSelection((prev) => repairVariantSelection(variants, { ...prev, [axis]: value }, axes, axis));
    setSelectedImage(0);
    setImageFailed(false);
    setQuantity(1);
  };

  const touchStartX = useRef(null);
  const galleryImages = selectedVariant?.images?.length ? selectedVariant.images : product?.images ?? [];
  const hasArtwork = galleryImages.length > 0;
  const onGalleryTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onGalleryTouchEnd = (e) => {
    if (touchStartX.current == null || galleryImages.length < 2) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 40) return;
    setImageFailed(false);
    setSelectedImage((i) => {
      const next = delta < 0 ? i + 1 : i - 1;
      return Math.max(0, Math.min(galleryImages.length - 1, next));
    });
  };

  const isWished = !!wlData?.wishlist?.products?.some(
    (p) => (p._id || p) === product._id
  );
  // Every variant sold out — distinct from "this specific combination is
  // sold out while others are available."
  const isProductUnavailable = variants.every((v) => (v.stock ?? 0) <= 0);
  const isSelectionUnavailable = !isProductUnavailable && pricing.stock <= 0;

  const missingAxisLabel = axes.find((a) => !selection[a]);

  const handleNotify = () => {
    toast.success(t("product.notifySuccess"));
  };

  const handleAdd = async () => {
    if (!selectedVariant) {
      toast.error(t("product.selectOptionError", { option: attrLabel(missingAxisLabel) || t("product.size") }));
      return;
    }
    setAdding(true);
    try {
      await cart.addItem({ product, variant: selectedVariant, quantity });
      toast.success(t("product.addedToCart"));
      dispatch(setCartOpen(true));
    } catch (e) {
      toast.error(e?.data?.message || t("product.addToCartFailed"));
    } finally {
      setAdding(false);
    }
  };

  const handleWishlist = async () => {
    if (!user) {
      toast.error(t("product.pleaseSignIn"));
      return;
    }
    try {
      const r = await toggleWishlist(product._id).unwrap();
      toast.success(r.added ? t("product.addedToWishlist") : t("product.removedFromWishlist"));
    } catch {
      toast.error(t("product.wishlistUpdateFailed"));
    }
  };

  // Product-level info rows — coverage/closure/lining/occasion for clothing,
  // skinType for cosmetics, ..., from the denormalized attributes array.
  // Whichever axes are rendered as interactive selectors above (`axes`) and
  // careInstructions (its own paragraph) are excluded so nothing duplicates.
  const infoRows = (product.attributes ?? [])
    .filter((a) => !axes.includes(a.key) && a.key !== "careInstructions")
    .map((a) => ({
      key: a.key,
      label: attrLabel(a.key) || a.key,
      value: a.values
        .map((v) => attrOptions(a.key).find((o) => o.value === v)?.label || v)
        .join(", "),
    }))
    .filter((r) => r.value);

  const careInstructions = product.attributes?.find((a) => a.key === "careInstructions")?.values?.[0];

  const measurements = product.measurements || {};
  const hasMeasurements = measurements.heightRange || measurements.chest || measurements.sleeveLength;

  return (
    <div className="container-x py-10 pb-28 lg:pb-10">
      <Breadcrumb
        items={[
          { label: t("navigation.home"), href: "/", icon: Home },
          { label: t("navigation.shop"), href: "/shop", icon: ShoppingBag },
          ...(product.category?.name
            ? [{
                label: departmentName(locale, product.category.slug, product.category.name),
                href: `/shop?category=${product.topCategory}`,
              }]
            : []),
          { label: product.name },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Gallery — capped and centered at 768-1023px only: the grid stays
            single-column until lg (1024), so without this the image (and
            its aspect-4/5) renders at the full column width and can run
            very tall on a tablet, pushing price/size/CTA off the first
            screen. Reverts to filling its lg:grid-cols-2 column at 1024+.
            aspect-4/5 (not aspect-square) so this matches ProductCard's own
            grid-card plate exactly — one consistent image box across the
            whole site, so a photo that fits one fits the other. */}
        <div className="w-full space-y-4 md:mx-auto md:max-w-[440px] lg:mx-0 lg:max-w-none">
          <motion.div
            key={`${selectedVariant?._id}-${selectedImage}`}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            onTouchStart={onGalleryTouchStart}
            onTouchEnd={onGalleryTouchEnd}
            className="relative aspect-4/5 overflow-hidden rounded-2xl bg-media"
          >
            {/* Hatched plate stands in until artwork exists, matching the way
                ProductCard renders a product with no images. */}
            <div aria-hidden="true" className="absolute inset-0 hatch" />
            <div aria-hidden="true" className="absolute inset-0 glow" />
            {hasArtwork && !imageFailed ? (
              // The product-detail page's genuine LCP candidate — the only
              // high-fetch-priority image on this route (thumbnails below
              // stay default/lazy, per this phase's "thumbnails must not be
              // priority" rule).
              <Image
                src={resolveImage(galleryImages[selectedImage], 800)}
                alt={product.name}
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                loading="eager"
                fetchPriority="high"
                // `object-contain`, not `object-cover` — see
                // components/product/ProductCard.jsx's identical fix: this
                // box is a fixed 1:1 square, but not every uploaded photo
                // is shot square, so `cover` was slicing off the top/sides
                // of taller/narrower photos (a model's head, in practice).
                // `contain` always shows the whole photo, letterboxed on
                // the existing bg-media plate when the ratio doesn't match.
                className="object-contain"
                onError={() => setImageFailed(true)}
              />
            ) : imageFailed ? (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center text-stone">
                <ImageOff className="h-5 w-5" strokeWidth={1.6} />
                <span className="font-mono text-[11px] uppercase leading-[1.8] tracking-[0.08em]">
                  {t("product.imageDidntLoad")}
                </span>
              </span>
            ) : (
              <span className="absolute inset-0 grid place-items-center px-8 text-center font-mono text-[11px] uppercase leading-[1.8] tracking-[0.08em] text-stone">
                {product.name}
              </span>
            )}
          </motion.div>
          {galleryImages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {galleryImages.map((src, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setSelectedImage(i);
                    setImageFailed(false);
                  }}
                  aria-label={t("product.viewImageNumber", { number: i + 1 })}
                  aria-current={i === selectedImage}
                  className={cn(
                    "h-20 w-20 flex-shrink-0 overflow-hidden rounded-md border-2 bg-media transition-colors",
                    i === selectedImage ? "border-accent" : "border-transparent"
                  )}
                >
                  <Image src={resolveImage(src, 160)} alt="" width={80} height={80} loading="lazy" className="h-full w-full object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <div>
              {product.brand?.name && (
                <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {product.brand.name}
                </p>
              )}
              <h1 className="mt-1 font-heading text-3xl font-black lg:text-4xl">
                {product.name}
              </h1>
            </div>
            {product.isFeatured && <Badge variant="accent">{t("filters.featured")}</Badge>}
          </div>

          {/* No reviews have been collected yet — the rating row simply
              doesn't render rather than showing a fabricated 0-star score. */}
          {product.numReviews != null && (
            <div className="mt-3 flex items-center gap-3">
              <Rating value={product.rating} size={16} showValue />
              <span className="text-sm text-muted-foreground">
                {t("product.reviewsCount", { count: product.numReviews })}
              </span>
            </div>
          )}

          <div className="mt-5 flex items-baseline gap-3">
            <span className="font-heading text-4xl font-black">
              {settings.formatPrice(pricing.displayPrice)}
            </span>
            {pricing.hasDiscount && (
              <>
                <span className="text-xl text-muted-foreground line-through">
                  {settings.formatPrice(pricing.price)}
                </span>
                <Badge variant="danger">
                  {t("product.discountBadge", {
                    percent: Math.round(((pricing.price - pricing.discountPrice) / pricing.price) * 100),
                  })}
                </Badge>
              </>
            )}
          </div>

          <p className="mt-5 text-foreground/80 text-pretty">
            {product.description}
          </p>

          {/* Modest-fashion product info — fabric, coverage, closure,
              lining, occasion (whichever apply to this category). */}
          {infoRows.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {infoRows.map((r) => (
                <Badge key={r.key} variant="outline">
                  {r.label}: {r.value}
                </Badge>
              ))}
              {product.ageGroup && AGE_GROUP_KEYS[product.ageGroup] && (
                <Badge variant="outline">{t(AGE_GROUP_KEYS[product.ageGroup])}</Badge>
              )}
            </div>
          )}

          {product.includedItems?.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{t("product.includes")}</span>{" "}
              {product.includedItems.join(", ")}
            </div>
          )}

          {hasMeasurements && (
            <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg border border-border p-3 text-center text-xs">
              {measurements.heightRange && (
                <div><div className="font-semibold text-foreground">{measurements.heightRange}</div><div className="text-muted-foreground">{t("product.height")}</div></div>
              )}
              {measurements.chest && (
                <div><div className="font-semibold text-foreground">{measurements.chest}</div><div className="text-muted-foreground">{t("product.chest")}</div></div>
              )}
              {measurements.sleeveLength && (
                <div><div className="font-semibold text-foreground">{measurements.sleeveLength}</div><div className="text-muted-foreground">{t("product.sleeve")}</div></div>
              )}
            </div>
          )}

          {isProductUnavailable ? (
            /* Every variant is gone — the exact copy the design calls for, not
               a disabled "Out of stock" button standing in for it. */
            <div className="mt-6 rounded-2xl border border-line bg-media p-6">
              <p className="text-[15.5px] leading-relaxed text-ink">
                {t("product.itemGoneMessage")}
              </p>
              <Button
                variant="primary"
                size="lg"
                onClick={handleNotify}
                className="mt-4 w-full sm:w-auto"
              >
                {t("product.notifyIfReturns")}
              </Button>
            </div>
          ) : (
            <>
              {/* Variant selectors — only the axes that actually vary on
                  this product get a control (see lib/utils.js
                  getVariantAxes), driven by AttributeDefinition rather than
                  a fixed clothing-only list. Never renders a combination
                  that doesn't exist as a real variant — only stock=0 ones,
                  disabled. */}
              {axes.map((axis) => (
                <VariantAxisRow
                  key={axis}
                  label={attrLabel(axis) || axis}
                  options={getAxisOptions(variants, axis)}
                  displayOptions={attrOptions(axis)}
                  swatch={attrDefs.find((d) => d.key === axis)?.type === "swatch"}
                  selected={selection[axis]}
                  onSelect={(v) => setAxisValue(axis, v)}
                />
              ))}

              {selectedVariant && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {isSelectionUnavailable ? t("product.outOfStock") : t("product.stockCount", { count: pricing.stock })}
                  {selectedVariant.sku && <> · SKU {selectedVariant.sku}</>}
                </p>
              )}

              {/* Quantity + actions — hidden on mobile in favor of the sticky
                  bar below, so there's only one Add to cart control visible
                  at a time. */}
              <div className="mt-6 hidden gap-3 lg:flex">
                <QuantityStepper quantity={quantity} setQuantity={setQuantity} max={pricing.stock || 99} />
                <Button
                  size="lg"
                  onClick={handleAdd}
                  loading={adding}
                  disabled={isSelectionUnavailable}
                  className="flex-1"
                >
                  <ShoppingBag className="h-4 w-4" />
                  {isSelectionUnavailable ? t("product.outOfStockCombination") : t("product.addToCart")}
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={handleWishlist}
                  aria-label={t("navigation.wishlist")}
                >
                  <Heart className={cn("h-4 w-4", isWished && "fill-danger text-danger")} />
                </Button>
              </div>
            </>
          )}

          {careInstructions && (
            <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">{t("product.careLabel")}</span>
              {careInstructions}
            </p>
          )}

          {/* Perks */}
          <div className="mt-8 grid grid-cols-3 gap-3 border-t border-border pt-6">
            <Perk
              icon={Truck}
              title={t("product.freeShipping")}
              desc={freeShipAmount ? t("product.freeShippingOver", { amount: freeShipAmount }) : t("product.onQualifyingOrders")}
            />
            <Perk icon={RefreshCw} title={t("product.exchanges14Day")} desc={t("product.easyAndFree")} />
            <Perk icon={Shield} title={t("header.announcementSecureCheckout")} desc={t("checkout.cashOnDelivery")} />
          </div>
        </div>
      </div>

      {/* Reviews */}
      <section className="mt-16">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="font-heading text-2xl font-bold">
              {t("product.customerReviews")}
            </h2>
            {product.numReviews != null && (
              <div className="mt-1 flex items-center gap-2">
                <Rating value={product.rating} size={14} showValue />
                <span className="text-sm text-muted-foreground">
                  {t("product.reviewsCount", { count: product.numReviews }).replace(/[()]/g, "")}
                </span>
              </div>
            )}
          </div>
        </div>
        <ReviewList productId={product._id} />
        <p className="mt-4 text-xs text-muted-foreground">
          {t("product.reviewEligibilityPre")}{" "}
          <Link href="/orders" className="text-accent hover:underline">
            {t("product.reviewEligibilityLink")}
          </Link>
          {t("product.reviewEligibilityPost")}
        </p>
      </section>

      {/* You may also like — real MongoDB candidates, ranked by category/
          attribute overlap with a real-signal fallback fill (see
          services/productService.js's listRelated), already resolved
          server-side. Renders nothing of its own accord with zero results. */}
      <div className="mt-16">
        <ProductRail
          id="related-products-heading"
          title={t("product.relatedHeading")}
          products={relatedProducts}
          isLoading={false}
        />
      </div>

      {/* Recently viewed — hides itself entirely with no history. Excludes
          the product currently on screen. */}
      <RecentlyViewedRail excludeId={product._id} className="mt-16" />

      {/* Mobile sticky purchase bar — clears MobileNav's ~66px tab bar plus
          its own safe-area inset, so it never overlaps the fixed bottom nav. */}
      {!isProductUnavailable && (
        <div
          className="fixed inset-x-0 z-[70] flex items-center gap-3 border-t border-line bg-surface px-4 py-3 shadow-sheet lg:hidden"
          // Matches MobileNav.jsx's own height math exactly: its 66px tab
          // row plus max(10px, safe-area-inset-bottom) padding — not a bare
          // env() alone, which under-shoots by 10px on devices with a
          // near-zero safe area (most non-notched phones).
          style={{ bottom: "calc(66px + max(10px, env(safe-area-inset-bottom)))" }}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{product.name}</div>
            <div data-tabular className="text-base font-bold">{settings.formatPrice(pricing.displayPrice)}</div>
          </div>
          <button
            onClick={handleWishlist}
            aria-label={t("navigation.wishlist")}
            className="grid h-11 w-11 flex-none place-items-center rounded-md border border-border text-foreground"
          >
            <Heart className={cn("h-4 w-4", isWished && "fill-danger text-danger")} />
          </button>
          <Button
            onClick={handleAdd}
            loading={adding}
            disabled={isSelectionUnavailable}
            className="flex-none"
          >
            <ShoppingBag className="h-4 w-4" />
            {isSelectionUnavailable ? t("product.outOfStock") : t("product.addToCart")}
          </Button>
        </div>
      )}
    </div>
  );
}

function VariantAxisRow({ label, options, displayOptions, selected, onSelect, swatch }) {
  const labelFor = (value) => displayOptions.find((o) => o.value === value)?.label || value;
  const hexFor = (value) => displayOptions.find((o) => o.value === value)?.swatchHex;

  return (
    <div className="mt-6">
      <div className="mb-2 text-sm font-bold uppercase tracking-wider">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = selected === opt.value;
          const hex = swatch ? hexFor(opt.value) : null;
          return (
            <button
              key={opt.value}
              disabled={opt.disabled}
              onClick={() => onSelect(opt.value)}
              title={labelFor(opt.value)}
              aria-pressed={active}
              className={cn(
                "flex h-11 items-center gap-2 rounded-md border px-3.5 text-sm font-semibold transition-all",
                active && "border-accent bg-accent text-accent-foreground shadow-card",
                !active && !opt.disabled && "border-border hover:border-foreground",
                opt.disabled && "cursor-not-allowed border-border bg-muted/30 text-muted-foreground/50 line-through"
              )}
            >
              {hex && (
                <span
                  aria-hidden="true"
                  className="h-4 w-4 flex-none rounded-full border border-border"
                  style={{ backgroundColor: hex }}
                />
              )}
              {labelFor(opt.value)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QuantityStepper({ quantity, setQuantity, max }) {
  const { t } = useLocale();
  return (
    <div className="flex items-center rounded-md border border-border">
      <button
        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
        disabled={quantity <= 1}
        className="px-3 py-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
        aria-label={t("product.decreaseQuantity")}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span aria-live="polite" className="w-10 text-center text-sm font-bold">{quantity}</span>
      <button
        onClick={() => setQuantity((q) => Math.min(max || 99, q + 1))}
        className="px-3 py-2 text-muted-foreground hover:text-foreground"
        aria-label={t("product.increaseQuantity")}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function Perk({ icon: Icon, title, desc }) {
  return (
    <div className="flex flex-col items-center text-center">
      <Icon className="mb-1 h-5 w-5 text-accent" />
      <p className="text-xs font-bold">{title}</p>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}
