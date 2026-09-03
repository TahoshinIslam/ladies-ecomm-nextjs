"use client";

import { useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import Drawer from "../ui/Drawer.jsx";
import Button from "../ui/Button.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import Skeleton from "../ui/Skeleton.jsx";
import { setCartOpen } from "../../store/uiSlice.js";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useCart } from "../../hooks/useCart.js";
import { resolveImage } from "../../lib/utils.js";

const FREE_SHIPPING_THRESHOLD = 200;

export default function CartDrawer() {
  const open = useSelector((s) => s.ui.cartOpen);
  const dispatch = useDispatch();
  const router = useRouter();
  const settings = useSettings();
  const cart = useCart();
  const { items, isLoading } = cart;
  const [pending, setPending] = useState(() => new Set());

  const keyOf = (productId, size) => `${productId}-${size}`;
  const isBusy = (productId, size) => pending.has(keyOf(productId, size));

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
  const thresholdMet = remaining <= 0 && items.length > 0;

  const close = () => dispatch(setCartOpen(false));
  const goCheckout = () => {
    close();
    router.push("/checkout");
  };

  return (
    <Drawer open={open} onClose={close} title="Your bag">
      {isLoading ? (
        <CartDrawerSkeleton />
      ) : items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-10">
          <EmptyState
            icon={ShoppingBag}
            title="Your bag is empty"
            message="Once you add a pair it'll show up here with size and color."
            action={
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  close();
                  router.push("/shop");
                }}
              >
                See the rotation
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="border-b border-line px-6 py-[18px]">
            <div className="flex justify-between text-[13.5px] text-stone">
              <span>
                {thresholdMet
                  ? "You've unlocked complimentary delivery"
                  : `${settings.formatPrice(remaining)} away from complimentary delivery`}
              </span>
              <span data-tabular className="font-mono text-[11.5px]">
                {settings.formatPrice(FREE_SHIPPING_THRESHOLD)}
              </span>
            </div>
            <div className="mt-2.5 h-[5px] overflow-hidden rounded-[3px] bg-media">
              <div
                className="h-full rounded-[3px] bg-verm transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <ul className="flex-1 overflow-y-auto px-6">
            {items.map((item) => {
              const p = item.product;
              if (!p) return null;
              const busy = isBusy(p._id, item.size);
              const price = p.discountPrice ?? p.basePrice;

              return (
                <li
                  key={keyOf(p._id, item.size)}
                  className="flex gap-4 border-b border-line py-5 transition-opacity"
                  style={{ opacity: busy ? 0.5 : 1 }}
                >
                  <Link
                    href={`/product/${p.slug || p._id}`}
                    onClick={close}
                    className="relative aspect-4/5 w-[88px] flex-none overflow-hidden rounded-[10px] bg-media"
                  >
                    <div aria-hidden="true" className="absolute inset-0 hatch" />
                    {p.images?.[0] && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={resolveImage(p.images[0], 180)}
                        alt=""
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
                          href={`/product/${p.slug || p._id}`}
                          onClick={close}
                          className="mt-1 block text-base font-semibold tracking-[-0.015em] hover:text-verm"
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

                    <div className="mt-auto flex items-center justify-between pt-3.5">
                      <div className="flex items-center rounded-lg border border-line">
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`Decrease quantity of ${p.name}`}
                          onClick={() =>
                            withPending(p._id, item.size, () =>
                              item.quantity <= 1
                                ? cart.removeItem({ productId: p._id, size: item.size })
                                : cart.updateItem({
                                    productId: p._id,
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
                          aria-live="off"
                          data-tabular
                          className="min-w-[26px] text-center font-mono text-[13px]"
                        >
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`Increase quantity of ${p.name}`}
                          onClick={() =>
                            withPending(p._id, item.size, () =>
                              cart.updateItem({
                                productId: p._id,
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
                          withPending(p._id, item.size, () =>
                            cart.removeItem({ productId: p._id, size: item.size }),
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

          <div className="border-t border-line bg-elev p-6">
            <div className="flex items-baseline justify-between">
              <span className="text-[15px] text-stone">Subtotal</span>
              <span data-tabular className="text-[22px] font-semibold">
                {settings.formatPrice(subtotal)}
              </span>
            </div>
            <p className="mt-1.5 text-[12.5px] text-stone">
              Taxes and delivery calculated at checkout.
            </p>
            <Button variant="accent" size="xl" className="mt-5 w-full" onClick={goCheckout}>
              Checkout
            </Button>
            <Button variant="ghost" size="lg" className="mt-2.5 w-full text-stone" onClick={close}>
              Continue shopping
            </Button>
          </div>
        </>
      )}
    </Drawer>
  );
}

/** Mirrors the loaded layout exactly: threshold bar, then N line-item rows. */
function CartDrawerSkeleton() {
  return (
    <>
      <div className="border-b border-line px-6 py-[18px]">
        <div className="flex justify-between">
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-3.5 w-10" />
        </div>
        <Skeleton className="mt-2.5 h-[5px] w-full rounded-[3px]" />
      </div>
      <div className="flex-1 px-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4 border-b border-line py-5">
            <Skeleton className="aspect-4/5 w-[88px] flex-none rounded-[10px]" />
            <div className="flex flex-1 flex-col gap-2 py-1">
              <Skeleton className="h-[10px] w-16" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="mt-auto h-[38px] w-24 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
