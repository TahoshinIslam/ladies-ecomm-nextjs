"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { Home, X, ShoppingBag, Scale } from "lucide-react";
import { toast } from "sonner";

import Button from "../components/ui/Button.jsx";
import Rating from "../components/ui/Rating.jsx";
import Badge from "../components/ui/Badge.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Breadcrumb from "../components/ui/Breadcrumb.jsx";

import { useGetCompareProductsQuery } from "../store/productApi.js";
import { selectCurrentUser } from "../store/authSlice.js";
import { useCart } from "../hooks/useCart.js";
import { removeFromCompare, clearCompare } from "../store/uiSlice.js";
import { cn, resolveImage } from "../lib/utils.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { useLocale } from "../context/LocaleProvider.jsx";
import { attrValue, departmentName } from "../lib/i18n/catalog.js";

// `variants` is the real modest-fashion schema — `product.sizes` (the
// legacy mock-catalog shape) is dead against real data and dropped here.
const getVariants = (product) => product.variants ?? [];

export default function ComparePage() {
  const settings = useSettings();
  const { t, locale } = useLocale();
  const compareList = useSelector((s) => s.ui.compareList);
  const user = useSelector(selectCurrentUser);
  const dispatch = useDispatch();
  const router = useRouter();
  const cart = useCart();
  const [pendingId, setPendingId] = useState(null);
  // Which variant is picked per compared product — a variant id, not a bare
  // size string, so two variants sharing a size (e.g. Black/M and Navy/M)
  // stay distinguishable (see Phase 4 audit).
  const [variantBy, setVariantBy] = useState({});

  const { data, isLoading, isFetching } = useGetCompareProductsQuery(
    compareList,
    { skip: compareList.length === 0 },
  );
  const products = data?.products || [];

  const pickVariant = (productId, variantId) =>
    setVariantBy((prev) => ({ ...prev, [productId]: variantId }));

  const handleAddToCart = async (product) => {
    const inStockVariants = getVariants(product).filter((v) => (v.stock ?? 0) > 0);
    if (inStockVariants.length === 0) {
      toast.error(t("compare.outOfStock"));
      return;
    }
    const pickedId = variantBy[product._id];
    const variant = (pickedId && inStockVariants.find((v) => v._id === pickedId)) || inStockVariants[0];
    try {
      setPendingId(product._id);
      await cart.addItem({ product, variant, quantity: 1 });
      toast.success(t("compare.addedToCart", { name: product.name }));
    } catch (e) {
      toast.error(e?.data?.message || t("compare.addToCartFailed"));
    } finally {
      setPendingId(null);
    }
  };

  // Empty state
  if (compareList.length === 0) {
    return (
      <div className="container-x py-12">
        <Breadcrumb
          items={[
            { label: t("navigation.home"), href: "/", icon: Home },
            { label: t("navigation.compare"), icon: Scale },
          ]}
        />
        <EmptyState
          icon={Scale}
          title={t("compare.emptyTitle")}
          message={t("compare.emptyMessage")}
          action={
            <Link href="/shop">
              <Button>{t("compare.browseProducts")}</Button>
            </Link>
          }
        />
      </div>
    );
  }

  // Loading state
  if (isLoading || (isFetching && products.length === 0)) {
    return (
      <div className="container-x py-8">
        <Skeleton className="mb-6 h-10 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {compareList.map((id) => (
            <Skeleton key={id} className="h-96" />
          ))}
        </div>
      </div>
    );
  }

  const ROWS = [
    { key: "brand", label: t("compare.brand"), get: (p) => p.brand?.name || "—" },
    {
      key: "category",
      label: t("compare.category"),
      get: (p) => (p.category ? departmentName(locale, p.category.slug, p.category.name) : "—"),
    },
    {
      key: "price",
      label: t("compare.price"),
      get: (p) => {
        const hasDiscount =
          p.discountPrice && p.discountPrice < p.basePrice;
        return hasDiscount ? (
          <span className="flex flex-col items-start">
            <span className="text-lg font-bold text-foreground">
              {settings.formatPrice(p.discountPrice)}
            </span>
            <span className="text-xs text-muted-foreground line-through">
              {settings.formatPrice(p.basePrice)}
            </span>
          </span>
        ) : (
          <span className="text-lg font-bold text-foreground">
            {settings.formatPrice(p.basePrice)}
          </span>
        );
      },
    },
    {
      key: "rating",
      label: t("compare.rating"),
      get: (p) =>
        p.numReviews > 0 ? (
          <span className="inline-flex flex-col items-start gap-1">
            <Rating value={p.rating} showValue />
            <span className="text-xs text-muted-foreground">
              {t("product.reviewsCount", { count: p.numReviews })}
            </span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t("product.noReviewsYet")}</span>
        ),
    },
    {
      key: "ageGroup",
      label: t("compare.ageGroup"),
      get: (p) => (
        <span className="capitalize">
          {p.ageGroup ? t(`filters.${p.ageGroup === "adult" ? "adults" : p.ageGroup}`) : "—"}
        </span>
      ),
    },
    {
      key: "color",
      label: t("compare.color"),
      get: (p) =>
        p.attributes
          ?.find((a) => a.key === "color")
          ?.values?.map((v) => attrValue(locale, "color", v))
          .join(", ") || "—",
    },
    {
      key: "fabric",
      label: t("compare.fabric"),
      get: (p) =>
        p.attributes
          ?.find((a) => a.key === "fabric")
          ?.values?.map((v) => attrValue(locale, "fabric", v))
          .join(", ") || "—",
    },
    {
      key: "stock",
      label: t("compare.totalStock"),
      get: (p) => {
        const total = getVariants(p).reduce((s, v) => s + (v.stock || 0), 0);
        if (total === 0) return <Badge variant="danger">{t("compare.outOfStock")}</Badge>;
        if (total <= 10) return <Badge variant="warning">{t("compare.lowStock", { count: total })}</Badge>;
        return <span className="text-sm font-semibold">{total}</span>;
      },
    },
    {
      key: "tags",
      label: t("compare.tags"),
      get: (p) =>
        p.tags?.length ? (
          <div className="flex flex-wrap gap-1">
            {p.tags.slice(0, 4).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div className="container-x py-8">
      <Breadcrumb
        items={[
          { label: t("navigation.home"), href: "/", icon: Home },
          { label: t("navigation.shop"), href: "/shop", icon: ShoppingBag },
          { label: t("navigation.compare"), icon: Scale },
        ]}
      />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black sm:text-4xl">
            {t("compare.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("compare.subtitle", { count: products.length })}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            dispatch(clearCompare());
            toast.success(t("compare.clearedToast"));
          }}
        >
          {t("compare.clearAll")}
        </Button>
      </div>

      {/* Side-by-side table on every screen size. Sticky left "spec" column,
          horizontally scrollable so phones can swipe between product columns. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="sticky left-0 z-10 w-20 border-r border-border bg-muted/30 p-2 text-left text-[10px] uppercase tracking-wider text-muted-foreground sm:w-32 sm:p-3 sm:text-xs">
                {t("compare.specColumn")}
              </th>
              {products.map((p) => (
                <ProductColumnHeader
                  key={p._id}
                  product={p}
                  onRemove={() => dispatch(removeFromCompare(p._id))}
                  removeLabel={t("compare.removeAria", { name: p.name })}
                />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ROWS.map((row) => (
              <tr key={row.key} className="hover:bg-muted/20">
                <th
                  scope="row"
                  className="sticky left-0 z-10 w-20 border-r border-border bg-background p-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:w-32 sm:p-3 sm:text-xs"
                >
                  {row.label}
                </th>
                {products.map((p) => (
                  <td
                    key={p._id}
                    className="min-w-[140px] p-3 align-top sm:min-w-[180px] sm:p-4"
                  >
                    {row.get(p)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th
                scope="row"
                className="sticky left-0 z-10 w-20 border-r border-t border-border bg-background p-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:w-32 sm:p-3 sm:text-xs"
              >
                {t("compare.addToCartRow")}
              </th>
              {products.map((p) => (
                <td
                  key={p._id}
                  className="min-w-[140px] border-t border-border p-3 align-top sm:min-w-[180px] sm:p-4"
                >
                  <SizeAndAddToCart
                    product={p}
                    selectedVariantId={variantBy[p._id]}
                    onPickVariant={(id) => pickVariant(p._id, id)}
                    onAdd={() => handleAddToCart(p)}
                    loading={pendingId === p._id}
                    locale={locale}
                    t={t}
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-center text-xs text-muted-foreground sm:hidden">
        {t("compare.swipeHint")}
      </p>
    </div>
  );
}

function ProductColumnHeader({ product, onRemove, removeLabel }) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <th
      scope="col"
      className="min-w-[140px] border-b border-border p-3 align-top text-left sm:min-w-[180px] sm:p-4"
    >
      <div className="relative">
        <button
          onClick={onRemove}
          aria-label={removeLabel}
          className="absolute right-0 top-0 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-background text-muted-foreground shadow-card hover:text-danger"
        >
          <X className="h-4 w-4" />
        </button>
        <Link
          href={`/product/${product.slug || product._id}`}
          className="block focus-ring rounded-md"
        >
          <div className="relative aspect-4/5 w-full overflow-hidden rounded-md bg-muted">
            {product.images?.[0] && !imageFailed ? (
              <Image
                src={resolveImage(product.images[0], 400)}
                alt={product.name}
                fill
                sizes="(max-width: 640px) 140px, 180px"
                loading="lazy"
                className="object-contain"
                onError={() => setImageFailed(true)}
              />
            ) : null}
          </div>
          <div className="mt-3">
            {product.brand?.name && (
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {product.brand.name}
              </p>
            )}
            <p className="mt-0.5 line-clamp-2 font-heading text-xs font-semibold leading-tight sm:text-sm">
              {product.name}
            </p>
          </div>
        </Link>
      </div>
    </th>
  );
}

function SizeAndAddToCart({ product, selectedVariantId, onPickVariant, onAdd, loading, locale, t }) {
  const inStockVariants = getVariants(product).filter((v) => (v.stock ?? 0) > 0);
  const allOut = inStockVariants.length === 0;

  return (
    <div className="space-y-2">
      {allOut ? (
        <Badge variant="danger">{t("compare.outOfStock")}</Badge>
      ) : (
        <div className="flex flex-wrap gap-1">
          {inStockVariants.slice(0, 8).map((v) => {
            const active = selectedVariantId === v._id;
            const label =
              [
                v.attributes?.color && attrValue(locale, "color", v.attributes.color),
                v.attributes?.size && attrValue(locale, "size", v.attributes.size),
              ]
                .filter(Boolean)
                .join(" / ") || v.variantName;
            return (
              <button
                key={v._id}
                onClick={() => onPickVariant(v._id)}
                title={v.variantName}
                className={cn(
                  "rounded border px-2 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-background hover:border-accent",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      <Button
        size="sm"
        onClick={onAdd}
        disabled={allOut}
        loading={loading}
        className="w-full"
      >
        <ShoppingBag className="h-4 w-4" />
        {t("compare.addToCart")}
      </Button>
    </div>
  );
}
