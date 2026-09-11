"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Home, Minus, Plus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import Button from "@/components/ui/Button.jsx";
import EmptyState from "@/components/ui/EmptyState.jsx";
import Skeleton from "@/components/ui/Skeleton.jsx";
import Breadcrumb from "@/components/ui/Breadcrumb.jsx";
import { useCart } from "@/hooks/useCart.js";
import { useSettings } from "@/context/SettingsContext.jsx";
import { useLocale } from "@/context/LocaleProvider.jsx";
import { resolveImage, resolveVariantPricing, formatVariantAttributes } from "@/lib/utils.js";

export default function CartPage() {
  const settings = useSettings();
  const { t, locale } = useLocale();
  const cart = useCart();
  const { items, isLoading } = cart;
  const [pending, setPending] = useState(() => new Set());

  const keyOf = (productId, variantId) => `${productId}-${variantId}`;

  const withPending = async (productId, variantId, run) => {
    const key = keyOf(productId, variantId);
    if (pending.has(key)) return;
    setPending((prev) => new Set(prev).add(key));
    try {
      await run();
    } catch (e) {
      toast.error(e?.data?.message || t("errors.generic"));
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const subtotalUsd = items.reduce((sum, i) => {
    if (!i.product) return sum;
    const { displayPrice } = resolveVariantPricing(i.product, i.variant);
    return sum + displayPrice * i.quantity;
  }, 0);
  const subtotal = settings.toBdt(subtotalUsd);
  // Same settings-backed threshold CartDrawer/PDP read — never a number
  // invented in this component, so bag/drawer/checkout can't disagree.
  const threshold = settings.freeShippingThreshold();
  const remaining = threshold ? Math.max(0, threshold.amount - subtotal) : 0;
  const progress = threshold ? Math.min(100, (subtotal / threshold.amount) * 100) : 0;
  const thresholdMet = !!threshold && remaining <= 0;

  if (isLoading) {
    return (
      <div className="container-x py-16">
        <Skeleton className="h-10 w-48" />
        <div className="mt-10 space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="container-x py-10">
        <PageHeading count={0} />
        <EmptyState
          icon={ShoppingBag}
          title={t("cart.empty")}
          message={t("cart.emptyBody")}
          action={
            <Link href="/shop">
              <Button size="lg">{t("cart.startShopping")}</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="container-x py-10">
      <PageHeading count={items.length} />

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_380px] lg:items-start">
        {/* Line items */}
        <ul className="border-t border-line">
          {items.map((item) => {
            const p = item.product;
            if (!p) return null;
            const id = p._id;
            const variantId = item.variantId;
            const busy = pending.has(keyOf(id, variantId));
            const { displayPrice } = resolveVariantPricing(p, item.variant);
            const variantLine = formatVariantAttributes(item.variant?.attributes, locale);

            return (
              <li
                key={keyOf(id, variantId)}
                className="flex gap-5 border-b border-line py-6 transition-opacity"
                style={{ opacity: busy ? 0.5 : 1 }}
              >
                <Link
                  href={`/product/${p.slug || id}`}
                  className="relative aspect-4/5 w-[88px] flex-none overflow-hidden rounded-[10px] bg-media sm:w-28"
                >
                  <div aria-hidden="true" className="absolute inset-0 hatch" />
                  {(item.variant?.image || p.images?.[0]) && (
                    <Image
                      src={resolveImage(item.variant?.image || p.images[0], 240)}
                      alt={p.name}
                      fill
                      sizes="(max-width: 640px) 88px, 112px"
                      loading="lazy"
                      className="object-contain"
                    />
                  )}
                </Link>

                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      {p.brand?.name && (
                        <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-stone">
                          {p.brand.name}
                        </div>
                      )}
                      <Link
                        href={`/product/${p.slug || id}`}
                        className="mt-1.5 block text-base font-semibold tracking-[-0.015em] hover:text-verm"
                      >
                        {p.name}
                      </Link>
                      {variantLine && (
                        <div className="mt-1 text-[13.5px] text-stone">
                          {variantLine}
                        </div>
                      )}
                    </div>
                    <div data-tabular className="text-[15.5px] font-semibold">
                      {settings.formatPrice(displayPrice * item.quantity)}
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between pt-4">
                    <div className="flex items-center rounded-lg border border-line">
                      <button
                        type="button"
                        aria-label={t("product.decreaseQuantity")}
                        disabled={busy}
                        onClick={() =>
                          withPending(id, variantId, () =>
                            item.quantity <= 1
                              ? cart.removeItem({ productId: id, variantId })
                              : cart.updateItem({
                                  productId: id,
                                  variantId,
                                  quantity: item.quantity - 1,
                                }),
                          )
                        }
                        className="grid h-[38px] w-[38px] place-items-center text-stone transition-colors hover:text-ink focus-ring"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span
                        data-tabular
                        aria-live="polite"
                        className="min-w-[26px] text-center font-mono text-[13px]"
                      >
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label={t("product.increaseQuantity")}
                        disabled={busy}
                        onClick={() =>
                          withPending(id, variantId, () =>
                            cart.updateItem({
                              productId: id,
                              variantId,
                              quantity: item.quantity + 1,
                            }),
                          )
                        }
                        className="grid h-[38px] w-[38px] place-items-center text-stone transition-colors hover:text-ink focus-ring"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        withPending(id, variantId, () =>
                          cart.removeItem({ productId: id, variantId }),
                        )
                      }
                      className="text-[13.5px] text-stone underline underline-offset-[3px] transition-colors hover:text-verm focus-ring"
                    >
                      {t("common.remove")}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Summary */}
        <aside className="rounded-2xl border border-line bg-surface p-7 lg:sticky lg:top-32">
          {threshold && (
            <>
              <div className="text-[13.5px] text-stone">
                {thresholdMet ? (
                  <span className="text-verm">{t("cart.freeShippingUnlocked")}</span>
                ) : (
                  t("cart.freeShippingProgress", { amount: settings.formatBdt(remaining) })
                )}
              </div>
              <div className="mt-2.5 h-[5px] overflow-hidden rounded-[3px] bg-media">
                <div
                  className="h-full rounded-[3px] bg-verm transition-[width] duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </>
          )}

          <div className="mt-7 flex items-baseline justify-between border-t border-line pt-6">
            <span className="text-[15px] text-stone">{t("cart.subtotal")}</span>
            <span data-tabular className="text-[22px] font-semibold">
              {settings.formatBdt(subtotal)}
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] text-stone">{t("cart.taxAndDeliveryNote")}</p>

          <Link href="/checkout" className="mt-5 block">
            <Button variant="accent" size="xl" className="w-full">
              {t("checkout.title")}
            </Button>
          </Link>
          <Link href="/shop" className="mt-2.5 block">
            <Button variant="ghost" size="lg" className="w-full text-stone">
              {t("cart.continueShopping")}
            </Button>
          </Link>
        </aside>
      </div>
    </div>
  );
}

function PageHeading({ count }) {
  const { t } = useLocale();
  return (
    <div>
      <Breadcrumb
        items={[
          { label: t("navigation.home"), href: "/", icon: Home },
          { label: t("cart.bag"), icon: ShoppingBag },
        ]}
      />
      <div className="eyebrow">{t("cart.yourBag")}</div>
      <h1 className="mt-4 text-[clamp(34px,4vw,52px)] font-semibold leading-none tracking-[-0.035em]">
        {count > 0 ? t("cart.pairsReady", { count }) : t("cart.nothingHereYet")}
      </h1>
    </div>
  );
}
