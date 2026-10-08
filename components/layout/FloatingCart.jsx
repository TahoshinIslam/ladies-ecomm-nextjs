"use client";

// The cart, stuck to the right edge of the screen on every storefront page — not a button in the header that scrolls away.
//   Desktop (lg+):  a slim vertical tab halfway down the right edge: bag, "N Items" and the running total; click opens the cart drawer.
//   Phones/tablets: a round button at the bottom right, lifted clear of the bottom tab bar (and of the product page's own sticky
//                   buy bar), with the item count as a badge.
// Hidden where the cart is already the page (cart, checkout, order confirmation).
import { usePathname } from "next/navigation";
import { useDispatch } from "react-redux";
import { ShoppingBag } from "lucide-react";

import { useLocale } from "../../context/LocaleProvider.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useCart } from "../../hooks/useCart.js";
import { toggleCart } from "../../store/uiSlice.js";
import { resolveVariantPricing } from "../../lib/utils.js";

const HIDDEN_ON = ["/cart", "/checkout", "/order-success"];

export default function FloatingCart() {
  const pathname = usePathname();
  const dispatch = useDispatch();
  const { t } = useLocale();
  const settings = useSettings();
  const { items, count } = useCart();

  if (HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  // Normalised to BDT per item before summing, exactly like the cart drawer, so the two always agree.
  const subtotal = items.reduce((sum, i) => {
    if (!i.product) return sum;
    const { displayPrice, currency } = resolveVariantPricing(i.product, i.variant);
    return sum + settings.toBdt(displayPrice, currency) * i.quantity;
  }, 0);
  const label = count ? t("header.cartLabel", { count }) : t("header.cartEmpty");
  // The product page has its own fixed buy bar above the tab bar on small screens; sit above that too.
  const onProductPage = pathname.startsWith("/product/");

  return (
    <>
      {/* Desktop: vertical tab on the right edge */}
      <button
        type="button"
        onClick={() => dispatch(toggleCart())}
        aria-label={label}
        title={label}
        className="fixed right-0 top-1/2 z-[85] hidden w-[78px] -translate-y-1/2 flex-col items-center gap-1 rounded-l-2xl bg-verm px-2 py-3 text-accent-foreground shadow-[0_10px_30px_-8px_rgba(0,0,0,0.45)] transition-[padding,box-shadow] hover:pr-3 focus-ring lg:flex"
      >
        <ShoppingBag className="h-[22px] w-[22px]" strokeWidth={1.7} aria-hidden="true" />
        <span data-tabular className="text-[11px] font-semibold uppercase leading-tight tracking-wide">
          {count} {t(count === 1 ? "header.cartItemShort" : "header.cartItemsShort")}
        </span>
        <span aria-hidden="true" className="my-0.5 h-px w-8 bg-white/35" />
        <span data-tabular className="rounded-md bg-white/15 px-1.5 py-1 text-[12px] font-bold leading-tight">
          {settings.formatBdt(subtotal)}
        </span>
      </button>

      {/* Phones and tablets: round button, bottom right */}
      <button
        type="button"
        onClick={() => dispatch(toggleCart())}
        aria-label={label}
        style={{ bottom: `calc(${onProductPage ? 152 : 78}px + max(10px, env(safe-area-inset-bottom)))` }}
        className="fixed right-3 z-[85] grid h-14 w-14 place-items-center rounded-full bg-verm text-accent-foreground shadow-[0_10px_26px_-6px_rgba(0,0,0,0.5)] transition-transform active:scale-95 focus-ring lg:hidden"
      >
        <ShoppingBag className="h-6 w-6" strokeWidth={1.7} aria-hidden="true" />
        {count > 0 ? (
          <span data-tabular className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-lime px-1 text-[11px] font-bold leading-none text-ink">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>
    </>
  );
}
