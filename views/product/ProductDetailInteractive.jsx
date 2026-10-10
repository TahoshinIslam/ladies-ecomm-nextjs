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
import { useRouter, useSearchParams } from "next/navigation";
import { useSelector, useDispatch } from "react-redux";
import { motion } from "framer-motion";
import {
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flame,
  Heart,
  Home,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Truck,
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

import { useWishlist } from "../../hooks/useWishlist.js";
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
  repairVariantSelection,
  resolveVariantPricing,
} from "../../lib/utils.js";
import FramedImage from "../../components/ui/FramedImage.jsx";
import { framingForUrl } from "../../lib/imageFraming.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { attrLabel as translateAttrLabel, attrValue as translateAttrValue, departmentName } from "../../lib/i18n/catalog.js";
import { formatQuantity, itemMeasure, packLabel, roundQuantity } from "../../lib/measure.js";

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
  const wishlist = useWishlist();

  const [selectedImage, setSelectedImage] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [tab, setTab] = useState("description");
  const [showAllThumbs, setShowAllThumbs] = useState(false);
  const [stackVisible, setStackVisible] = useState(false);
  const buyStackRef = useRef(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // The mobile sticky purchase bar only appears once the main buttons have scrolled out of view — until then they are the one set of
  // controls on screen.
  useEffect(() => {
    const node = buyStackRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => setStackVisible(entry.isIntersecting), { threshold: 0.2 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const variants = useMemo(() => product?.variants ?? [], [product]);
  // Candidate variant axes for this product's department come from
  // AttributeDefinition.derivedFromVariant (color/size/fabric for clothing,
  // shade/volumeMl for cosmetics, ...) — never a fixed clothing-only list.
  const candidateAxes = useMemo(() => attrDefs.filter((d) => d.derivedFromVariant).map((d) => d.key), [attrDefs]);
  const axes = useMemo(() => getVariantAxes(variants, candidateAxes), [variants, candidateAxes]);
  // Nothing is pre-selected on load — every axis (Color/Fabric/Size/...)
  // starts blank so the shopper has to actively choose each one, rather
  // than getDefaultVariantSelection() silently picking the first in-stock
  // variant for them (which made every option look already decided).
  // An axis with only one value to choose (a product sold in a single colour) is chosen for the shopper: there is nothing to decide,
  // and the page then shows that colour's photos and price straight away. Axes with a real choice stay blank.
  const [selection, setSelection] = useState(() => {
    const chosen = {};
    for (const axis of axes) {
      const options = getAxisOptions(variants, axis);
      if (options.length === 1) chosen[axis] = options[0].value;
    }
    // The colour is the one choice that decides the photos, so a colour is always showing: the first one that is in stock
    // (else the first). Without it the gallery mixes every colour's photos until the shopper clicks a swatch. Size and the
    // rest stay blank — those are for the shopper to choose.
    const colourAxis = axes.find((a) => attrDefs.find((d) => d.key === a)?.type === "swatch") ?? axes.find((a) => /^colou?r$/i.test(a));
    if (colourAxis && !chosen[colourAxis]) {
      const options = getAxisOptions(variants, colourAxis);
      const inStock = options.find((o) => !o.disabled) ?? options[0];
      if (inStock) chosen[colourAxis] = inStock.value;
    }
    // A link can name the variant — /product/t-shirt?color=black&size=m — so a campaign or a message can send a shopper
    // straight to the black one. Only values this product really has are taken.
    for (const axis of axes) {
      const wanted = searchParams.get(axis);
      if (!wanted) continue;
      const match = getAxisOptions(variants, axis).find((o) => String(o.value).toLowerCase() === wanted.toLowerCase());
      if (match) chosen[axis] = match.value;
    }
    return chosen;
  });

  const allAxesSelected = axes.every((a) => selection[a]);
  const selectedVariant = useMemo(
    () => (allAxesSelected ? resolveVariant(variants, selection, axes) : null),
    [variants, selection, axes, allAxesSelected],
  );
  const pricing = resolveVariantPricing(product ?? {}, selectedVariant);
  // An item sold by measure (kg, g, l, ml) is ordered by amount, in steps of its smallest pack, priced per unit.
  const measure = itemMeasure({ variant: selectedVariant });
  const isMeasured = measure.unit !== "pc";
  const packs = isMeasured ? selectedVariant?.packs ?? [] : [];
  // A newly chosen variant starts at one step (1 for a piece, 0.5 kg for loose mango sold in 500 g packs). Adjusted while
  // rendering — the documented way to derive state from a changed input — so there is no render with the old amount.
  const selectedVariantId = selectedVariant?._id ?? null;
  const [amountFor, setAmountFor] = useState(null);
  if (amountFor !== selectedVariantId) {
    setAmountFor(selectedVariantId);
    setQuantity(measure.step);
  }

  const setAxisValue = (axis, value) => {
    const next = repairVariantSelection(variants, { ...selection, [axis]: value }, axes, axis);
    setSelection(next);
    // Keep the address in step with the choice, so copying the link copies the variant.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      for (const a of axes) {
        if (next[a]) url.searchParams.set(a, next[a]);
        else url.searchParams.delete(a);
      }
      window.history.replaceState(window.history.state, "", url);
    }
    setSelectedImage(0);
    setImageFailed(false);
    setQuantity(1);
  };

  const touchStartX = useRef(null);
  // The photos of what is chosen so far: the exact variant's when all options are picked; with only some picked (a colour but no
  // size yet) the photos of the variants that match — so choosing Red never shows the black shirt. Nothing picked: the product's.
  const pickedAxes = axes.filter((a) => selection[a]);
  const matchingPhotos = pickedAxes.length
    ? [...new Set(variants.filter((v) => pickedAxes.every((a) => v.attributes?.[a] === selection[a])).flatMap((v) => v.images ?? []))]
    : [];
  const galleryImages = selectedVariant?.images?.length ? selectedVariant.images : matchingPhotos.length ? matchingPhotos : product?.images ?? [];
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

  const isWished = wishlist.has(product._id);
  // Every variant sold out — distinct from "this specific combination is
  // sold out while others are available."
  const isProductUnavailable = variants.every((v) => (v.stock ?? 0) <= 0);
  // Only a genuinely out-of-stock, FULLY chosen combination counts as
  // "unavailable" — an incomplete selection (nothing resolved yet) is a
  // distinct "needsSelection" state below, never mislabeled as out of stock.
  const isSelectionUnavailable = !isProductUnavailable && allAxesSelected && pricing.stock <= 0;
  const needsSelection = !isProductUnavailable && !allAxesSelected;

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

  // Buy now = add this exact selection to the cart, then go straight to checkout.
  const handleBuyNow = async () => {
    if (!selectedVariant) {
      toast.error(t("product.selectOptionError", { option: attrLabel(missingAxisLabel) || t("product.size") }));
      return;
    }
    setAdding(true);
    try {
      await cart.addItem({ product, variant: selectedVariant, quantity });
      router.push("/checkout");
    } catch (e) {
      toast.error(e?.data?.message || t("product.addToCartFailed"));
      setAdding(false);
    }
  };

  const handleWishlist = async () => {
    // No sign-in needed: a visitor's saved products stay on this device and join their account when they sign in.
    try {
      const r = await wishlist.toggle(product);
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

  const stockLeft = selectedVariant ? pricing.stock : variants.reduce((a, v) => a + (v.stock ?? 0), 0);
  const showLowStock = !isProductUnavailable && stockLeft > 0 && stockLeft <= 5;
  const discountPercent = pricing.hasDiscount ? Math.round(((pricing.price - pricing.discountPrice) / pricing.price) * 100) : 0;
  const highlights = infoRows.slice(0, 3);
  const exchangeDays = settings.exchangePolicy?.windowDays;

  const specRows = [
    ...(product.brand?.name ? [[t("shop.brand"), product.brand.name]] : []),
    ...(product.category?.name ? [[t("product.category"), departmentName(locale, product.category.slug, product.category.name)]] : []),
    ...infoRows.map((r) => [r.label, r.value]),
    ...(product.ageGroup && AGE_GROUP_KEYS[product.ageGroup] ? [[t("filters.ageGroup"), t(AGE_GROUP_KEYS[product.ageGroup])]] : []),
    ...(product.includedItems?.length ? [[t("product.whatsIncluded"), product.includedItems.join(", ")]] : []),
    ...(measurements.heightRange ? [[t("product.height"), measurements.heightRange]] : []),
    ...(measurements.chest ? [[t("product.chest"), measurements.chest]] : []),
    ...(measurements.sleeveLength ? [[t("product.sleeve"), measurements.sleeveLength]] : []),
    ...(selectedVariant?.sku ? [[t("product.sku"), selectedVariant.sku]] : []),
    ...(careInstructions ? [[t("product.careInstructions"), careInstructions]] : []),
  ];

  const tabs = [
    { id: "description", label: t("product.description") },
    { id: "specs", label: t("product.specifications") },
    { id: "reviews", label: `${t("product.reviews")}${product.numReviews ? ` (${product.numReviews})` : ""}` },
    { id: "shipping", label: t("footer.shippingReturns") },
  ];

  const mainBtnLabel = isSelectionUnavailable
    ? t("product.outOfStockCombination")
    : needsSelection
      ? t("product.selectOption", { label: attrLabel(missingAxisLabel) || missingAxisLabel })
      : null;

  return (
    <div className="container-x py-6 pb-28 sm:py-8 lg:pb-10">
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-10">
        {/* Gallery card: one big picture with arrows, a wishlist heart and a "only N left" flag, thumbnails underneath. */}
        <div className="w-full md:mx-auto md:max-w-[520px] lg:mx-0 lg:max-w-none">
          <div className="rounded-2xl border border-line bg-surface p-3 shadow-card sm:p-4">
            <motion.div
              key={`${selectedVariant?._id}-${selectedImage}`}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              onTouchStart={onGalleryTouchStart}
              onTouchEnd={onGalleryTouchEnd}
              className="relative aspect-4/5 overflow-hidden rounded-xl bg-media lg:aspect-[6/5]"
            >
              <div aria-hidden="true" className="absolute inset-0 hatch" />
              <div aria-hidden="true" className="absolute inset-0 glow" />
              {hasArtwork && !imageFailed ? (
                // The page's genuine LCP candidate — the only high-priority image on this route.
                framingForUrl(product.imageFraming, galleryImages[selectedImage]) ? (
                  <FramedImage
                    src={galleryImages[selectedImage]}
                    framing={framingForUrl(product.imageFraming, galleryImages[selectedImage])}
                    placement="product.gallery"
                    alt={product.name}
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    loading="eager"
                    lcp
                    onError={() => setImageFailed(true)}
                  />
                ) : (
                  <Image
                    src={resolveImage(galleryImages[selectedImage], 800)}
                    alt={product.name}
                    fill
                    sizes="(max-width: 1024px) 100vw, 50vw"
                    loading="eager"
                    fetchPriority="high"
                    // object-contain: always the whole photo, letterboxed on the plate when the ratio differs.
                    className="object-contain"
                    onError={() => setImageFailed(true)}
                  />
                )
              ) : imageFailed ? (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center text-stone">
                  <ImageOff className="h-5 w-5" strokeWidth={1.6} />
                  <span className="font-mono text-[11px] uppercase leading-[1.8] tracking-[0.08em]">{t("product.imageDidntLoad")}</span>
                </span>
              ) : (
                <span className="absolute inset-0 grid place-items-center px-8 text-center font-mono text-[11px] uppercase leading-[1.8] tracking-[0.08em] text-stone">
                  {product.name}
                </span>
              )}

              {showLowStock ? (
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-lg bg-danger/10 px-2.5 py-1.5 text-[12.5px] font-semibold text-danger backdrop-blur">
                  <Flame className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("product.lowStock", { count: stockLeft })}
                </span>
              ) : null}
              <button
                type="button"
                onClick={handleWishlist}
                aria-label={t("navigation.wishlist")}
                aria-pressed={isWished}
                className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-surface/95 text-ink shadow-card transition-transform hover:scale-105 focus-ring"
              >
                <Heart className={cn("h-5 w-5", isWished && "fill-danger text-danger")} />
              </button>
              {galleryImages.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setImageFailed(false); setSelectedImage((i) => (i - 1 + galleryImages.length) % galleryImages.length); }}
                    aria-label={t("pagination.previous")}
                    className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-surface/95 text-ink shadow-card transition-transform hover:scale-105 focus-ring"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setImageFailed(false); setSelectedImage((i) => (i + 1) % galleryImages.length); }}
                    aria-label={t("pagination.next")}
                    className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-surface/95 text-ink shadow-card transition-transform hover:scale-105 focus-ring"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              ) : null}
            </motion.div>

            {galleryImages.length > 1 && (
              <div className={cn("mt-3 grid grid-cols-5 gap-2", showAllThumbs && "sm:grid-cols-6")}>
                {(showAllThumbs || galleryImages.length <= 5 ? galleryImages : galleryImages.slice(0, 4)).map((src, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setSelectedImage(i);
                      setImageFailed(false);
                    }}
                    aria-label={t("product.viewImageNumber", { number: i + 1 })}
                    aria-current={i === selectedImage}
                    className={cn(
                      "relative aspect-square overflow-hidden rounded-xl border-2 bg-media transition-colors",
                      i === selectedImage ? "border-verm" : "border-line hover:border-ink/40",
                    )}
                  >
                    <Image src={resolveImage(src, 160)} alt="" fill sizes="96px" loading="lazy" className="object-contain" />
                  </button>
                ))}
                {!showAllThumbs && galleryImages.length > 5 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllThumbs(true)}
                    className="grid aspect-square place-items-center rounded-xl border-2 border-line bg-surface text-center text-[12px] font-semibold text-ink transition-colors hover:border-ink/40"
                  >
                    <span>
                      +{galleryImages.length - 4}
                      <span className="block text-[11px] font-medium text-stone">{t("product.moreImages")}</span>
                    </span>
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* Buying column */}
        <div className="flex min-w-0 flex-col">
          {product.brand?.name && (
            <p className="text-[12.5px] font-semibold uppercase tracking-wider text-stone">{product.brand.name}</p>
          )}
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-heading text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">{product.name}</h1>
            {product.isFeatured && <Badge variant="accent">{t("filters.featured")}</Badge>}
          </div>

          {/* No reviews yet means no rating row — never a fabricated score. */}
          {product.numReviews != null && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Rating value={product.rating} size={17} showValue />
              <span className="text-[13.5px] text-stone">{t("product.reviewsCount", { count: product.numReviews })}</span>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span data-tabular className="font-heading text-[40px] font-extrabold leading-none text-verm sm:text-[46px]">
              {settings.formatPrice(pricing.displayPrice, pricing.currency)}
            </span>
            {pricing.hasDiscount && (
              <>
                <span data-tabular className="text-[19px] text-stone line-through">{settings.formatPrice(pricing.price, pricing.currency)}</span>
                <span className="rounded-lg bg-danger/10 px-3 py-1.5 text-[13.5px] font-bold text-danger">
                  {t("product.discountBadge", { percent: discountPercent })}
                </span>
              </>
            )}
          </div>

          {highlights.length > 0 && (
            <ul className="mt-5 space-y-2">
              {highlights.map((r) => (
                <li key={r.key} className="flex items-center gap-2.5 text-[15px] text-ink">
                  <CheckCircle2 className="h-5 w-5 flex-none fill-verm text-surface" aria-hidden="true" />
                  <span>
                    <span className="text-stone">{r.label}:</span> {r.value}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {isProductUnavailable ? (
            <div className="mt-6 rounded-2xl border border-line bg-media p-6">
              <p className="text-[15.5px] leading-relaxed text-ink">{t("product.itemGoneMessage")}</p>
              <Button variant="primary" size="lg" onClick={handleNotify} className="mt-4 w-full sm:w-auto">
                {t("product.notifyIfReturns")}
              </Button>
            </div>
          ) : (
            <>
              {/* One control per axis that actually varies on this product (colour, size, fabric…). */}
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
                <p className="mt-2 text-xs text-stone">
                  {isSelectionUnavailable ? t("product.outOfStock") : t("product.stockCount", { count: formatQuantity(pricing.stock, measure.unit) })}
                  {selectedVariant.sku && <> · SKU {selectedVariant.sku}</>}
                </p>
              )}

              {isMeasured && packs.length > 0 && (
                <div className="mt-6">
                  <span className="text-[15px] font-semibold text-ink">{t("product.quantity")}</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {packs.map((pack) => {
                      const active = Math.abs(quantity - pack.baseQuantity) < 1e-6;
                      const unavailable = pack.baseQuantity > (pricing.stock || 0);
                      return (
                        <button
                          key={pack.id}
                          type="button"
                          disabled={unavailable}
                          onClick={() => setQuantity(pack.baseQuantity)}
                          aria-pressed={active}
                          className={cn(
                            "rounded-xl border px-4 py-2 text-left transition-colors disabled:opacity-40",
                            active ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink hover:bg-wash",
                          )}
                        >
                          <span className="block text-[14.5px] font-bold">{packLabel(pack, measure.unit)}</span>
                          <span data-tabular className={cn("block text-[12.5px]", active ? "text-white/80" : "text-stone")}>
                            {settings.formatPrice(pricing.displayPrice * pack.baseQuantity, pricing.currency)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <span className="text-[15px] font-semibold text-ink">{isMeasured ? t("product.amount") : t("product.quantity")}</span>
                <QuantityStepper quantity={quantity} setQuantity={setQuantity} max={pricing.stock || 99} step={measure.step} unit={measure.unit} />
                {isMeasured && (
                  <span data-tabular className="text-[15px] font-semibold text-ink">
                    {settings.formatPrice(pricing.displayPrice * quantity, pricing.currency)}
                    <span className="ml-1.5 text-[12.5px] font-normal text-stone">
                      ({settings.formatPrice(pricing.displayPrice, pricing.currency)} / {measure.unit})
                    </span>
                  </span>
                )}
              </div>

              <div ref={buyStackRef} className="mt-4 space-y-2.5">
                <Button
                  size="xl"
                  onClick={handleBuyNow}
                  loading={adding}
                  disabled={isSelectionUnavailable || needsSelection}
                  className="w-full bg-verm-contrast text-white hover:bg-verm-contrast hover:brightness-110"
                >
                  {mainBtnLabel ?? t("product.buyNow")}
                </Button>
                <Button
                  size="xl"
                  onClick={handleAdd}
                  loading={adding}
                  disabled={isSelectionUnavailable || needsSelection}
                  className="w-full bg-[#f5b324] text-[#1c1a14] hover:bg-[#f5b324] hover:brightness-95"
                >
                  <ShoppingCart className="h-5 w-5" />
                  {t("product.addToCart")}
                </Button>
                <Button size="xl" variant="subtle" onClick={handleWishlist} className="w-full">
                  <Heart className={cn("h-5 w-5", isWished && "fill-danger text-danger")} />
                  {isWished ? t("product.removeFromWishlist") : t("product.addToWishlist")}
                </Button>
              </div>
            </>
          )}

          {/* Delivery — only what the shop really promises: the free-delivery threshold it has configured, and cash on delivery. */}
          <div className="mt-5 flex items-start gap-3 text-verm">
            <Truck className="mt-0.5 h-7 w-7 flex-none" aria-hidden="true" />
            <div>
              <p className="text-[16px] font-bold">{freeShipAmount ? t("product.deliveryFreeOver", { amount: freeShipAmount }) : t("product.deliveryChargeAtCheckout")}</p>
              <p className="text-[13.5px]">{t("product.deliveryPayOnArrival")}</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <TrustCard icon={Lock} title={t("header.announcementSecureCheckout")} desc={t("checkout.cashOnDelivery")} />
            <TrustCard icon={RefreshCw} title={exchangeDays ? t("product.exchangesDays", { days: exchangeDays }) : t("product.exchanges14Day")} desc={t("product.easyAndFree")} />
            <TrustCard icon={ShieldCheck} title={t("product.trustQuality")} desc={t("product.trustQualityDesc")} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px] text-stone">
            <span>{t("product.weAccept")}</span>
            <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 font-semibold text-ink">
              <Banknote className="h-4 w-4 text-verm" aria-hidden="true" />
              {t("checkout.cashOnDelivery")}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs: description, specifications, reviews, shipping & returns. */}
      <section className="mt-10 rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-6" aria-label={t("product.details")}>
        <div role="tablist" aria-label={t("product.details")} className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
          {tabs.map((x) => (
            <button
              key={x.id}
              id={`tab-${x.id}`}
              role="tab"
              type="button"
              aria-selected={tab === x.id}
              aria-controls={`panel-${x.id}`}
              onClick={() => setTab(x.id)}
              className={cn(
                "relative flex-none whitespace-nowrap px-4 py-3 text-[15px] font-semibold transition-colors focus-ring",
                tab === x.id ? "text-verm after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-verm" : "text-ink hover:text-verm",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-5">
          {tab === "description" && (
            <p className="max-w-[80ch] whitespace-pre-line text-[15px] leading-relaxed text-ink/85 text-pretty">
              {product.description || t("product.noDescription")}
            </p>
          )}

          {tab === "specs" &&
            (specRows.length ? (
              <dl className="grid max-w-[760px] divide-y divide-line rounded-xl border border-line text-[14.5px]">
                {specRows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[minmax(120px,200px)_1fr] gap-4 px-4 py-2.5">
                    <dt className="text-stone">{label}</dt>
                    <dd className="min-w-0 break-words font-medium text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-[15px] text-stone">{t("product.noSpecifications")}</p>
            ))}

          {tab === "reviews" && (
            <div>
              <div className="mb-5 flex items-end justify-between gap-3">
                <h2 className="font-heading text-xl font-bold">{t("product.customerReviews")}</h2>
                <Link href="/orders" className="text-xs font-bold uppercase tracking-wider underline underline-offset-4 hover:text-verm">
                  {t("product.writeReview")}
                </Link>
              </div>
              <ReviewList productId={product._id} rating={product.rating} numReviews={product.numReviews} />
              <p className="mt-4 text-xs text-stone">
                {t("product.reviewEligibilityPre")}{" "}
                <Link href="/orders" className="text-verm hover:underline">
                  {t("product.reviewEligibilityLink")}
                </Link>
                {t("product.reviewEligibilityPost")}
              </p>
            </div>
          )}

          {tab === "shipping" && (
            <div className="max-w-[80ch] space-y-4 text-[15px] leading-relaxed text-ink/85">
              <div>
                <h3 className="font-semibold text-ink">{t("product.deliveryHeading")}</h3>
                <p>{freeShipAmount ? t("product.deliveryFreeOver", { amount: freeShipAmount }) : t("product.deliveryChargeAtCheckout")} {t("product.deliveryPayOnArrival")}.</p>
              </div>
              <div>
                <h3 className="font-semibold text-ink">{t("pages.shippingReturnsHeading")}</h3>
                <p>{t("pages.shippingReturnsBody")}</p>
                <p className="mt-2 text-[13.5px] text-stone">{t("pages.shippingReturnsNote")}</p>
                <Link href="/contact" className="mt-2 inline-block font-semibold text-verm hover:underline">
                  {t("pages.shippingReturnsCta")}
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* You may also like — ranked server-side by category/attribute overlap; renders nothing with zero results. */}
      <div className="mt-12">
        <ProductRail id="related-products-heading" title={t("product.relatedHeading")} products={relatedProducts} isLoading={false} />
      </div>

      {/* Recently viewed — hides itself entirely with no history. */}
      <RecentlyViewedRail excludeId={product._id} className="mt-12" />

      {/* Mobile sticky purchase bar — clears MobileNav's ~66px tab bar plus its own safe-area inset. Shown only once the main buttons
          have scrolled out of sight, so there is never a second set of buy buttons beside them. */}
      {!isProductUnavailable && (
        <div
          className="fixed inset-x-0 z-[70] flex items-center gap-3 border-t border-line bg-surface px-4 py-3 shadow-sheet lg:hidden"
          aria-hidden={stackVisible}
          style={{
            bottom: "calc(66px + max(10px, env(safe-area-inset-bottom)))",
            ...(stackVisible ? { display: "none" } : {}),
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{product.name}</div>
            <div data-tabular className="text-base font-bold text-verm">{settings.formatPrice(pricing.displayPrice, pricing.currency)}</div>
          </div>
          <button
            onClick={handleWishlist}
            aria-label={t("navigation.wishlist")}
            className="grid h-11 w-11 flex-none place-items-center rounded-md border border-border text-foreground"
          >
            <Heart className={cn("h-4 w-4", isWished && "fill-danger text-danger")} />
          </button>
          <Button onClick={handleAdd} loading={adding} disabled={isSelectionUnavailable || needsSelection} className="flex-none bg-[#f5b324] text-[#1c1a14] hover:bg-[#f5b324] hover:brightness-95">
            <ShoppingCart className="h-4 w-4" />
            {isSelectionUnavailable
              ? t("product.outOfStock")
              : needsSelection
                ? t("product.selectOption", { label: attrLabel(missingAxisLabel) || missingAxisLabel })
                : t("product.addToCart")}
          </Button>
        </div>
      )}
    </div>
  );
}

function VariantAxisRow({ label, options, displayOptions, selected, onSelect, swatch }) {
  const { t } = useLocale();
  const labelFor = (value) => displayOptions.find((o) => o.value === value)?.label || value;
  const hexFor = (value) => displayOptions.find((o) => o.value === value)?.swatchHex;

  // Swatch axes (color/shade) render as a row of circular color chips —
  // the selected one gets a ring, not a filled pill — with the currently
  // chosen value named in the header ("COLOR — BLACK") and the total
  // option count on the right, instead of every value repeating its own
  // text label inside a button.
  if (swatch) {
    return (
      <div className="mt-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div className="text-sm font-bold uppercase tracking-wider">
            {label}
            {selected && <span className="font-normal text-muted-foreground"> — {labelFor(selected)}</span>}
          </div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("product.optionCount", { count: options.length })}
          </span>
        </div>
        <div className="flex flex-wrap gap-3">
          {options.map((opt) => {
            const active = selected === opt.value;
            const hex = hexFor(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSelect(opt.value)}
                title={opt.disabled ? `${labelFor(opt.value)} — ${t("product.outOfStock")}` : labelFor(opt.value)}
                aria-label={labelFor(opt.value)}
                aria-pressed={active}
                className={cn(
                  "relative grid h-10 w-10 flex-none place-items-center rounded-full transition-all",
                  active ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "ring-1 ring-border hover:ring-foreground/50",
                  // Sold out is shown, not forbidden: the shopper can still pick it to see its photos (the button then says
                  // out of stock).
                  opt.disabled && "opacity-50"
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-[26px] w-[26px] rounded-full border border-black/10"
                  style={{ backgroundColor: hex || "transparent" }}
                />
                {opt.disabled && (
                  <span aria-hidden="true" className="absolute h-[1.5px] w-8 rotate-45 bg-foreground/40" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="mb-2 text-sm font-bold uppercase tracking-wider">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = selected === opt.value;
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
              {labelFor(opt.value)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QuantityStepper({ quantity, setQuantity, max, step = 1, unit = "pc" }) {
  const { t } = useLocale();
  return (
    <div className="inline-flex items-center overflow-hidden rounded-xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setQuantity((q) => Math.max(step, roundQuantity(q - step)))}
        disabled={quantity <= step}
        className="grid h-11 w-11 place-items-center text-ink transition-colors hover:bg-wash disabled:opacity-40"
        aria-label={t("product.decreaseQuantity")}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span aria-live="polite" className="min-w-12 border-x border-line px-2 text-center text-[15px] font-bold leading-[44px]">{formatQuantity(quantity, unit)}</span>
      <button
        type="button"
        onClick={() => setQuantity((q) => (roundQuantity(q + step) > (max || 99) ? q : roundQuantity(q + step)))}
        className="grid h-11 w-11 place-items-center text-ink transition-colors hover:bg-wash"
        aria-label={t("product.increaseQuantity")}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function TrustCard({ icon: Icon, title, desc }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-line bg-surface p-2.5 sm:gap-2.5 sm:p-3">
      <Icon className="mt-0.5 h-5 w-5 flex-none text-ink" strokeWidth={1.7} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[12px] font-bold leading-tight text-ink">{title}</p>
        <p className="mt-0.5 text-[11px] leading-tight text-stone">{desc}</p>
      </div>
    </div>
  );
}
