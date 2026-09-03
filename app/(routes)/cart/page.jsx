"use client";

import { useState } from "react";
import Link from "next/link";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import Button from "@/components/ui/Button.jsx";
import EmptyState from "@/components/ui/EmptyState.jsx";
import Skeleton from "@/components/ui/Skeleton.jsx";
import { useCart } from "@/hooks/useCart.js";
import { useSettings } from "@/context/SettingsContext.jsx";
import { resolveImage } from "@/lib/utils.js";

const FREE_SHIPPING_THRESHOLD = 200;

export default function CartPage() {
  const settings = useSettings();
  const cart = useCart();
  const { items, isLoading } = cart;
  const [pending, setPending] = useState(() => new Set());

  const keyOf = (productId, size) => `${productId}-${size}`;

  const withPending = async (productId, size, run) => {
    const key = keyOf(productId, size);
    if (pending.has(key)) return;
    setPending((prev) => new Set(prev).add(key));
    try {
      await run();
    } catch (e) {
      toast.error(e?.data?.message || "Could not update your bag");
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const subtotal = items.reduce((sum, i) => {
    const p = i.product;
    if (!p) return sum;
    return sum + (p.discountPrice ?? p.basePrice) * i.quantity;
  }, 0);

  const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);
  const progress = Math.min(100, (subtotal / FREE_SHIPPING_THRESHOLD) * 100);

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
          title="Your bag is empty"
          message="Once you add a pair it'll show up here with size and color."
          action={
            <Link href="/shop">
              <Button size="lg">See the rotation</Button>
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
            const busy = pending.has(keyOf(id, item.size));
            const price = p.discountPrice ?? p.basePrice;

            return (
              <li
                key={keyOf(id, item.size)}
                className="flex gap-5 border-b border-line py-6 transition-opacity"
                style={{ opacity: busy ? 0.5 : 1 }}
              >
                <Link
                  href={`/product/${p.slug || id}`}
                  className="relative aspect-4/5 w-[88px] flex-none overflow-hidden rounded-[10px] bg-media sm:w-28"
                >
                  <div aria-hidden="true" className="absolute inset-0 hatch" />
                  {p.images?.[0] && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={resolveImage(p.images[0], 240)}
                      alt={p.name}
                      loading="lazy"
                      className="relative h-full w-full object-cover"
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
                      <div className="mt-1 text-[13.5px] text-stone">
                        Size {item.size}
                      </div>
                    </div>
                    <div data-tabular className="text-[15.5px] font-semibold">
                      {settings.formatPrice(price * item.quantity)}
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between pt-4">
                    <div className="flex items-center rounded-lg border border-line">
                      <button
                        type="button"
                        aria-label={`Decrease quantity of ${p.name}`}
                        disabled={busy}
                        onClick={() =>
                          withPending(id, item.size, () =>
                            item.quantity <= 1
                              ? cart.removeItem({ productId: id, size: item.size })
                              : cart.updateItem({
                                  productId: id,
                                  size: item.size,
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
                        className="min-w-[26px] text-center font-mono text-[13px]"
                      >
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label={`Increase quantity of ${p.name}`}
                        disabled={busy}
                        onClick={() =>
                          withPending(id, item.size, () =>
                            cart.updateItem({
                              productId: id,
                              size: item.size,
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
                        withPending(id, item.size, () =>
                          cart.removeItem({ productId: id, size: item.size }),
                        )
                      }
                      className="text-[13.5px] text-stone underline underline-offset-[3px] transition-colors hover:text-verm focus-ring"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Summary */}
        <aside className="rounded-2xl border border-line bg-surface p-7 lg:sticky lg:top-32">
          <div className="text-[13.5px] text-stone">
            {remaining > 0 ? (
              <>
                {settings.formatPrice(remaining)} away from complimentary
                delivery
              </>
            ) : (
              <span className="text-verm">
                You&rsquo;ve unlocked complimentary delivery
              </span>
            )}
          </div>
          <div className="mt-2.5 h-[5px] overflow-hidden rounded-[3px] bg-media">
            <div
              className="h-full rounded-[3px] bg-verm transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-7 flex items-baseline justify-between border-t border-line pt-6">
            <span className="text-[15px] text-stone">Subtotal</span>
            <span data-tabular className="text-[22px] font-semibold">
              {settings.formatPrice(subtotal)}
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] text-stone">
            Taxes and delivery calculated at checkout.
          </p>

          <Link href="/checkout" className="mt-5 block">
            <Button variant="accent" size="xl" className="w-full">
              Checkout
            </Button>
          </Link>
          <Link href="/shop" className="mt-2.5 block">
            <Button variant="ghost" size="lg" className="w-full text-stone">
              Continue shopping
            </Button>
          </Link>
        </aside>
      </div>
    </div>
  );
}

function PageHeading({ count }) {
  return (
    <div>
      <div className="eyebrow">Your bag</div>
      <h1 className="mt-4 text-[clamp(34px,4vw,52px)] font-semibold leading-none tracking-[-0.035em]">
        {count > 0 ? `${count} ${count === 1 ? "pair" : "pairs"} ready` : "Nothing here yet"}
      </h1>
    </div>
  );
}
