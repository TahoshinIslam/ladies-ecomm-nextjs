"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { Heart, Home, LayoutGrid, ShoppingBag, User } from "lucide-react";

import { toggleMobileMenu } from "../../store/uiSlice.js";
import { selectCurrentUser } from "../../store/authSlice.js";
import { useGetWishlistQuery } from "../../store/shopApi.js";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { cn } from "../../lib/utils.js";

/**
 * The mobile app shell: a fixed 5-tab bar (Home / Shop / Categories /
 * Saved / Profile) — the one persistent piece of chrome across the whole
 * mobile experience. Search is the full-width field under the header, and the
 * cart is the floating button at the bottom right, so neither needs a tab;
 * Categories opens the same drawer as the hamburger.
 *
 * Shown below the `lg` breakpoint (phones AND tablets) — the same breakpoint
 * where the header switches to its hamburger drawer and where the product
 * page's sticky purchase bar appears, so all the touch-first chrome turns on
 * and off together. The space it covers is reserved by StorefrontShell.jsx
 * (page bottom padding) and CompareTray.jsx (lifts above it).
 */
export default function MobileNav() {
  const pathname = usePathname();
  const dispatch = useDispatch();
  const { t } = useLocale();
  const user = useSelector(selectCurrentUser);
  // Wishlist has no guest/localStorage fallback (unlike cart) — same as Header.
  const { data: wlData } = useGetWishlistQuery(undefined, { skip: !user });
  const wlCount = wlData?.wishlist?.products?.length || 0;

  const isActive = (path) =>
    path === "/" ? pathname === "/" : pathname.startsWith(path);

  return (
    <nav
      aria-label={t("navigation.home")}
      className="fixed inset-x-0 bottom-0 z-[80] flex border-t border-line bg-surface pb-[max(10px,env(safe-area-inset-bottom))] shadow-sheet lg:hidden"
    >
      <NavTab href="/" label={t("navigation.home")} icon={Home} active={isActive("/")} />
      <NavTab href="/shop" label={t("navigation.shop")} icon={ShoppingBag} active={isActive("/shop")} />

      <button
        type="button"
        onClick={() => dispatch(toggleMobileMenu())}
        aria-label={t("navigation.categories")}
        className="flex h-[66px] flex-1 flex-col items-center justify-center gap-1 text-stone transition-transform active:scale-95"
      >
        <LayoutGrid className="h-[22px] w-[22px]" strokeWidth={1.6} />
        <span className="mt-1 text-[10.5px] font-medium">{t("navigation.categories")}</span>
      </button>

      <NavTab
        href="/wishlist"
        label={t("navigation.saved")}
        icon={Heart}
        active={isActive("/wishlist")}
        badge={wlCount}
      />
      <NavTab
        href={user ? "/profile" : "/login"}
        label={t("navigation.profile")}
        icon={User}
        active={isActive("/profile") || isActive("/login")}
      />
    </nav>
  );
}

function NavTab({ href, label, icon: Icon, active, badge }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[66px] flex-1 flex-col items-center justify-center gap-1 transition-transform active:scale-95",
        active ? "text-ink" : "text-stone",
      )}
    >
      <span className="relative">
        {/* Active pill — a soft rounded chip behind the icon, distinct from
            the other tabs. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 -m-2 rounded-full transition-colors duration-200",
            active ? "bg-wash" : "bg-transparent",
          )}
        />
        <Icon
          className="relative h-[22px] w-[22px]"
          strokeWidth={active ? 2 : 1.6}
          fill={active ? "currentColor" : "none"}
        />
        {badge > 0 && (
          <span
            aria-hidden="true"
            data-tabular
            className="absolute -right-[7px] -top-[3px] grid h-4 min-w-4 place-items-center rounded-lg bg-verm-contrast px-1 font-mono text-[9.5px] leading-none text-white"
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>
      <span className={cn("mt-1 text-[10.5px]", active ? "font-semibold" : "font-medium")}>
        {label}
      </span>
    </Link>
  );
}
