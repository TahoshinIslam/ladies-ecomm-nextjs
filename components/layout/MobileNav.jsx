"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { Heart, Home, Search, ShoppingBag, User } from "lucide-react";

import { toggleSearch } from "../../store/uiSlice.js";
import { selectCurrentUser } from "../../store/authSlice.js";
import { useGetWishlistQuery } from "../../store/shopApi.js";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { cn } from "../../lib/utils.js";

/**
 * The board's mobile app shell: a fixed 5-tab bar (Home / Shop / Search /
 * Saved / Profile), with Search raised as an accent pill — the one persistent
 * piece of chrome across the whole mobile experience. Discovery (gender,
 * brands, journal) still lives in the header's hamburger drawer; this bar is
 * for the five destinations someone reaches for with a thumb, one-handed.
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
      className="fixed inset-x-0 bottom-0 z-[80] flex border-t border-line bg-surface pb-[max(10px,env(safe-area-inset-bottom))] shadow-sheet md:hidden"
    >
      <NavTab href="/" label={t("navigation.home")} icon={Home} active={isActive("/")} />
      <NavTab href="/shop" label={t("navigation.shop")} icon={ShoppingBag} active={isActive("/shop")} />

      <button
        type="button"
        onClick={() => dispatch(toggleSearch())}
        aria-label={t("navigation.search")}
        className="flex flex-1 flex-col items-center justify-start gap-1.5 pt-0.5 text-stone transition-transform active:scale-95"
      >
        <span className="grid h-[38px] w-[46px] place-items-center rounded-xl bg-verm-contrast text-white shadow-[0_6px_16px_-8px_rgba(255,61,33,0.9)]">
          <Search className="h-[21px] w-[21px]" strokeWidth={2} />
        </span>
        <span className="text-[10.5px] font-medium">{t("navigation.search")}</span>
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
            Search's permanent accent pill so "current tab" and "search" read
            as two different signals rather than competing for the same one. */}
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
