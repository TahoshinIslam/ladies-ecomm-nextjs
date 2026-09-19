"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import Wordmark from "../brand/Wordmark.jsx";
import HeaderSearchField from "./HeaderSearchField.jsx";
import MobileCategoryDrawer from "./MobileCategoryDrawer.jsx";
import HeaderCategoryMenu from "./HeaderCategoryMenu.jsx";
import {
  Bell,
  Check,
  CheckCheck,
  Heart,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Moon,
  Package,
  Scale,
  ShoppingCart,
  Sun,
  User as UserIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "../../lib/utils.js";
import { useTheme } from "../../context/ThemeProvider.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import LanguageSwitcher from "./LanguageSwitcher.jsx";
import {
  selectCurrentUser,
  selectCanAccessAdmin,
  clearCredentials,
} from "../../store/authSlice.js";
import { useLogoutMutation } from "../../store/userApi.js";
import {
  useGetCartQuery,
  useGetWishlistQuery,
  useGetCategoriesQuery,
  useGetNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} from "../../store/shopApi.js";
import { toggleCart, toggleMobileMenu, setMobileMenuOpen } from "../../store/uiSlice.js";
import useDialogFocus from "../../hooks/useDialogFocus.js";
import { useUserEventStream } from "../../hooks/useUserEventStream.js";

/**
 * Storefront header — composed after the classic EShopper template's own
 * shell (a slim utility topbar; a logo/search/actions row; a nav row led
 * by a "Categories" panel trigger) rebuilt in this app's real Tailwind
 * tokens, Lucide icons, and Next.js routing/data — no jQuery, Bootstrap,
 * or Owl Carousel, and no static/demo links: every control here is wired
 * to the same real cart, wishlist, auth, notifications and department
 * data the rest of the app uses.
 */
export default function Header({ initialDepartments = [] }) {
  const { isDark, toggleTheme } = useTheme();
  const { t, locale } = useLocale();
  const settings = useSettings();
  const user = useSelector(selectCurrentUser);
  // Mounted once here — Header renders on every storefront page — so a
  // signed-in shopper's order-status/delivery notifications reach their
  // bell live, matching how useAdminEventStream is mounted once in
  // AdminLayout for the same reason on the admin side.
  useUserEventStream();
  const isAdmin = useSelector(selectCanAccessAdmin);
  const mobileMenuOpen = useSelector((s) => s.ui.mobileMenuOpen);
  const compareCount = useSelector((s) => s.ui.compareList.length);
  const dispatch = useDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [logout] = useLogoutMutation();

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // Lifted up from MobileCategoryDrawer itself: that component previously
  // owned this as local state, which reset to [] every time because
  // AnimatePresence unmounts the drawer's contents on close — so drilling
  // into Food -> Fruits & Vegetables, tapping a leaf product to navigate,
  // then reopening the hamburger always dumped the shopper back at the
  // top-level department list instead of back where they'd been browsing.
  // Header.jsx itself never unmounts, so keeping the drill-down path here
  // instead makes it survive the drawer closing and reopening.
  const [mobileCategoryPath, setMobileCategoryPath] = useState([]);

  const shopName = settings?.store?.name || "TAHOS.";

  const { data: cartData } = useGetCartQuery(undefined, { skip: !user });
  const { data: wlData } = useGetWishlistQuery(undefined, { skip: !user });
  const guestCount = useSelector((s) =>
    s.guestCart.items.reduce((n, i) => n + i.quantity, 0),
  );
  const cartCount = user
    ? cartData?.cart?.items?.reduce((s, i) => s + i.quantity, 0) || 0
    : guestCount;
  const wlCount = wlData?.wishlist?.products?.length || 0;

  // Real departments for the "Shop by Category" header menu and the mobile
  // drawer — same query ShopPage.jsx's category filter already uses.
  // `initialDepartments` (from app/(routes)/layout.jsx, a Server
  // Component) seeds the very first paint so the list isn't empty until
  // this client query resolves.
  const { data: catsData } = useGetCategoriesQuery();
  const allCategories = catsData?.categories ?? initialDepartments;

  // Route change closes every transient surface. Local panels reset during
  // render (React's "adjust state when a prop changes" pattern) so the new
  // page never paints with a stale menu open; the Redux drawer follows in
  // an effect, since dispatching during render is not allowed.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setUserMenuOpen(false);
  }

  useEffect(() => {
    dispatch(setMobileMenuOpen(false));
  }, [pathname, dispatch]);

  const mobileNavPanelRef = useRef(null);
  useDialogFocus({
    open: mobileMenuOpen,
    panelRef: mobileNavPanelRef,
    onClose: () => dispatch(setMobileMenuOpen(false)),
  });

  const handleLogout = async () => {
    try {
      await logout().unwrap();
    } catch {
      // Server-side session may already be gone; clear locally regardless.
    }
    dispatch(clearCredentials());
    setUserMenuOpen(false);
    toast.success(t("auth.signedOut"));
    router.push("/");
  };

  return (
    <>
      {/* Utility topbar — EShopper's slim FAQ/Help/Support strip, wired to
          the real pages that exist here (FAQ, Contact) instead of empty
          anchors, with the language/theme controls taking the place of
          social links this store doesn't have. Desktop/tablet only.
          Default (non-green) styling — of the header's 3 stacked rows, only
          the main logo/search/actions row below is brand-green. */}
      <div className="hidden border-b border-line bg-media md:block">
        <div className="container-x flex h-9 items-center justify-between text-[12.5px] text-stone">
          <div className="flex items-center gap-3">
            <Link href="/faq" className="hover:text-ink">{t("footer.faq")}</Link>
            <span className="text-line">|</span>
            <Link href="/contact" className="hover:text-ink">{t("footer.contact")}</Link>
          </div>
          <div className="flex items-center gap-1">
            <LanguageSwitcher />
            <button
              onClick={toggleTheme}
              aria-label={isDark ? t("header.switchLightTheme") : t("header.switchDarkTheme")}
              title={isDark ? t("header.switchLightTheme") : t("header.switchDarkTheme")}
              className="grid h-8 w-8 place-items-center rounded-md text-ink transition-colors hover:bg-wash focus-ring"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      <header className="sticky top-0 z-[90] border-b border-line bg-surface">
        {/* Mobile app-shell bar (<768px): logo, theme toggle, cart — search
            gets its own full-width row below. This is mobile's one
            equivalent of the desktop main row below, so it shares that
            row's brand-green treatment; the utility topbar and nav row
            above/below stay default and are hidden on mobile anyway. */}
        <div className="container-x flex h-[58px] items-center gap-3 bg-verm text-accent-foreground md:hidden">
          <button
            onClick={() => dispatch(toggleMobileMenu())}
            aria-label={t("header.openMenu")}
            className="-ml-2 grid h-11 w-11 flex-none place-items-center rounded-lg text-accent-foreground transition-colors hover:bg-white/10 focus-ring"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link href="/" className="flex-none focus-ring" aria-label={shopName}>
            <Wordmark name={shopName} onAccent className="text-[20px]" />
          </Link>
          <div className="flex-1" />
          <button
            onClick={toggleTheme}
            aria-label={isDark ? t("header.switchLightTheme") : t("header.switchDarkTheme")}
            className="grid h-11 w-11 place-items-center rounded-lg text-accent-foreground transition-colors hover:bg-white/10 focus-ring"
          >
            {isDark ? <Sun className="h-[20px] w-[20px]" /> : <Moon className="h-[20px] w-[20px]" />}
          </button>
          {user && <NotificationBell />}
          <button
            onClick={() => dispatch(toggleCart())}
            aria-label={cartCount ? t("header.cartLabel", { count: cartCount }) : t("header.cartEmpty")}
            className="relative grid h-11 w-11 place-items-center rounded-lg text-accent-foreground transition-colors hover:bg-white/10 focus-ring"
          >
            <ShoppingCart className="h-[21px] w-[21px]" strokeWidth={1.6} />
            {cartCount > 0 && <Badge count={cartCount} />}
          </button>
        </div>
        {/* Confirmed bug, fixed: this inline field and the mobile bottom
            nav's own "Search" tab (which opens SearchModal.jsx, a
            full-screen overlay with the same search) were two separate
            search entry points stacked on small screens — this one has
            been removed here entirely on mobile, not just hidden while
            the overlay is open. Desktop keeps its own HeaderSearchField
            row further down (the `hidden md:block` section) — that one
            is unaffected. (The bottom nav now also shows on tablets, below
            `lg`, where that inline field remains.) */}

        {/* Main row — EShopper's logo / search / action-buttons row. The
            ONE brand-green section of the header (matching Footer.jsx's own
            `bg-verm`) — the utility topbar above and the nav row below both
            stay the header's normal default background. The green fill is
            on this full-width OUTER div, not the centered inner one, so it
            reaches both edges of the viewport instead of leaving default-
            colored gutters on screens wider than the 1480px content max. */}
        <div className="hidden bg-verm text-accent-foreground md:block">
          <div className="container-x flex items-center gap-6 py-4">
            <Link href="/" className="flex-none focus-ring" aria-label={shopName}>
              <Wordmark name={shopName} onAccent className="text-[25px]" />
            </Link>

          <div className="flex-1">
            <HeaderSearchField />
          </div>

          <div className="flex flex-none items-center gap-2">
            {compareCount > 0 && (
              <Link
                href="/compare"
                aria-label={t("header.compareLabel", { count: compareCount })}
                className="relative grid h-11 w-11 place-items-center rounded-lg border border-white/25 text-accent-foreground transition-colors hover:border-white/60 focus-ring"
              >
                <Scale className="h-[18px] w-[18px]" />
                <Badge count={compareCount} />
              </Link>
            )}
            <Link
              href="/wishlist"
              aria-label={wlCount ? t("header.wishlistLabel", { count: wlCount }) : t("header.wishlistEmpty")}
              className="relative grid h-11 w-11 place-items-center rounded-lg border border-white/25 text-accent-foreground transition-colors hover:border-white/60 focus-ring"
            >
              <Heart className="h-[18px] w-[18px]" />
              {wlCount > 0 && <Badge count={wlCount} />}
            </Link>
            <button
              onClick={() => dispatch(toggleCart())}
              aria-label={cartCount ? t("header.cartLabel", { count: cartCount }) : t("header.cartEmpty")}
              className="relative grid h-11 w-11 place-items-center rounded-lg border border-white/25 text-accent-foreground transition-colors hover:border-white/60 focus-ring"
            >
              <ShoppingCart className="h-[18px] w-[18px]" />
              {cartCount > 0 && <Badge count={cartCount} />}
            </button>
            {user && <NotificationBell />}

            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-label={t("header.account")}
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                className="grid h-11 w-11 place-items-center rounded-lg border border-white/25 text-accent-foreground transition-colors hover:border-white/60 focus-ring"
              >
                <UserIcon className="h-[18px] w-[18px]" />
              </button>
              <AnimatePresence>
                {userMenuOpen && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.16 }}
                    onMouseLeave={() => setUserMenuOpen(false)}
                    className="absolute right-0 top-[52px] z-[110] w-56 overflow-hidden rounded-xl border border-line bg-elev p-1.5 shadow-soft"
                  >
                    {user ? (
                      <>
                        <div className="border-b border-line px-3 pb-2.5 pt-2">
                          <div className="truncate text-sm font-semibold">{user.name}</div>
                          <div className="truncate text-xs text-stone">{user.email}</div>
                        </div>
                        {isAdmin ? (
                          <MenuLink href="/admin" icon={LayoutDashboard}>{t("navigation.admin")}</MenuLink>
                        ) : (
                          <MenuLink href="/dashboard" icon={LayoutDashboard}>{t("navigation.dashboard")}</MenuLink>
                        )}
                        <MenuLink href="/profile" icon={UserIcon}>{t("navigation.profile")}</MenuLink>
                        <MenuLink href="/orders" icon={Package}>{t("navigation.orders")}</MenuLink>
                        <button
                          role="menuitem"
                          onClick={handleLogout}
                          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink transition-colors hover:bg-wash focus-ring"
                        >
                          <LogOut className="h-4 w-4 text-stone" />
                          {t("navigation.signOut")}
                        </button>
                      </>
                    ) : (
                      <>
                        <MenuLink href="/login" icon={LogIn}>{t("navigation.signIn")}</MenuLink>
                        <MenuLink href="/register" icon={UserIcon}>{t("navigation.createAccount")}</MenuLink>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          </div>
        </div>

        {/* Nav row — "All Categories" now sits at the far left on every
            storefront page (not just /shop): the homepage's old always-
            expanded CategorySidebar is gone, so this is the one category
            entry point everywhere above the mobile drawer's own breakpoint.
            A plain flex row (not the old 3-column grid built to keep the
            center nav mathematically centered around a page-dependent left
            column) — the nav links now sit immediately beside the trigger,
            left-aligned, matching this row's left-anchored composition. */}
        <div className="hidden border-t border-line md:block">
          <div className="container-x flex items-center gap-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => dispatch(toggleMobileMenu())}
                aria-label={t("header.openMenu")}
                className="-ml-2 grid h-11 w-11 flex-none place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring lg:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
              {/* lg+ only — below that, the hamburger above already opens
                  the mobile drawer's own category browser
                  (MobileCategoryDrawer), so showing this trigger too would
                  be a duplicate, redundant category entry point. */}
              <HeaderCategoryMenu categories={allCategories} className="hidden lg:flex" />
            </div>

            <nav aria-label="Primary" className="flex h-11 items-center gap-5 text-[14.5px] font-medium">
              <HeaderNavLink href="/" pathname={pathname} searchParams={searchParams}>
                {t("navigation.home")}
              </HeaderNavLink>
              <HeaderNavLink href="/shop" pathname={pathname} searchParams={searchParams}>
                {t("navigation.shop")}
              </HeaderNavLink>
              <HeaderNavLink
                href="/shop?collection=new"
                pathname={pathname}
                searchParams={searchParams}
                className="hidden sm:flex"
              >
                {t("navigation.new")}
              </HeaderNavLink>
              <HeaderNavLink
                href="/shop?collection=featured"
                pathname={pathname}
                searchParams={searchParams}
                className="hidden sm:flex"
              >
                {t("home.navDeals")}
              </HeaderNavLink>
              <HeaderNavLink href="/contact" pathname={pathname} searchParams={searchParams} className="hidden sm:flex">
                {t("footer.contact")}
              </HeaderNavLink>
            </nav>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("header.openMenu")}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-[3px] lg:hidden"
            onClick={() => dispatch(setMobileMenuOpen(false))}
          >
            <motion.nav
              ref={mobileNavPanelRef}
              aria-label={t("header.departments")}
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="flex h-full w-[min(340px,86%)] flex-col overflow-y-auto bg-surface"
            >
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <Wordmark name={shopName} className="text-[21px]" />
                <button
                  onClick={() => dispatch(setMobileMenuOpen(false))}
                  aria-label={t("header.closeMenu")}
                  className="grid h-11 w-11 place-items-center rounded-lg transition-colors hover:bg-wash focus-ring"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Category drill-down is the drawer's entire job now — Home,
                  Shop, Wishlist ("Saved") and the account area are already
                  one tap away on the bottom mobile tab bar
                  (components/layout/MobileNav.jsx), Contact is in the
                  footer, and Orders now lives in the account section's own
                  nav (components/account/AccountSidebar.jsx) — repeating
                  any of them here was pure duplication. */}
              <MobileCategoryDrawer
                categories={allCategories}
                locale={locale}
                t={t}
                path={mobileCategoryPath}
                setPath={setMobileCategoryPath}
                onNavigate={() => dispatch(setMobileMenuOpen(false))}
              />

              <div className="mt-auto border-t border-line p-4">
                {/* Confirmed bug, fixed: LanguageSwitcher only ever
                    rendered in the desktop-only utility topbar (`hidden
                    md:block`, see the header's own top strip above) — on
                    every screen below md there was no way at all to
                    switch languages. `showLabel="always"`: this drawer's
                    own width is well under the component's default
                    `sm:inline` viewport breakpoint, which would otherwise
                    hide the "English"/"বাংলা" label on every real phone. */}
                <LanguageSwitcher
                  showLabel="always"
                  className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-normal text-ink hover:bg-wash focus-ring"
                />
                {user ? (
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm hover:bg-wash focus-ring"
                  >
                    <LogOut className="h-4 w-4 text-stone" /> {t("navigation.signOut")}
                  </button>
                ) : (
                  <Link
                    href="/login"
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm hover:bg-wash focus-ring"
                  >
                    <LogIn className="h-4 w-4 text-stone" /> {t("navigation.signIn")}
                  </Link>
                )}
              </div>
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A plain nav link that knows whether it's the current page. Several of
 * these links share /shop as their path (New, and one per department) —
 * matching on pathname alone would light up all of them together the
 * instant the pathname is /shop, regardless of which query params are
 * actually set. So this checks the path AND, when the href carries a query
 * string, that every one of its params is present with the exact same
 * value in the current URL.
 */
function HeaderNavLink({ href, pathname, searchParams, className, children }) {
  const [linkPath, linkQuery] = href.split("?");
  const isActive =
    pathname === linkPath &&
    (!linkQuery ||
      [...new URLSearchParams(linkQuery)].every(
        ([key, value]) => searchParams?.get(key) === value,
      )) &&
    (linkPath !== "/shop" || !linkQuery || searchParams?.toString() === linkQuery);
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        // This nav row is the header's default (non-green) background, so
        // the usual brand-green accent still works fine here for hover/
        // active — only the main logo/search/actions row above is green.
        "flex items-center transition-colors hover:text-verm focus-ring",
        isActive && "text-verm",
        className,
      )}
    >
      {children}
    </Link>
  );
}

function MenuLink({ href, icon: Icon, children }) {
  return (
    <Link
      role="menuitem"
      href={href}
      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink transition-colors hover:bg-wash focus-ring"
    >
      <Icon className="h-4 w-4 text-stone" />
      {children}
    </Link>
  );
}

function Badge({ count }) {
  return (
    <span
      data-tabular
      // These badges sit on icon buttons whose own background is
      // transparent, so they show directly against the header's brand-
      // green fill — `bg-verm-contrast` (the same green) would be
      // invisible there. `bg-lime` is this design system's other
      // on-accent highlight color, which needs dark text (see its own
      // definition comment in app/globals.css).
      className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-lg bg-lime px-1 text-[10px] leading-none text-ink"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

const notificationTimeAgo = (iso) => {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
};

// Customer-facing counterpart to components/admin/NotificationsDropdown.jsx
// — same underlying endpoint (GET/PATCH /api/notifications), same
// interaction shape. Real-time delivery is useUserEventStream (mounted
// once in Header() above); this poll is just the fallback for a dropped
// SSE connection.
function NotificationBell() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const router = useRouter();

  const { data, isLoading, isError } = useGetNotificationsQuery(
    { page: 1, limit: 10 },
    { pollingInterval: 60000 },
  );
  const [markRead] = useMarkNotificationReadMutation();
  const [markAll, { isLoading: marking }] = useMarkAllNotificationsReadMutation();

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleClick = async (n) => {
    setOpen(false);
    if (!n.readAt) {
      try {
        await markRead(n._id).unwrap();
      } catch {
        /* non-fatal */
      }
    }
    if (n.url) router.push(n.url);
  };

  const handleMarkAll = async () => {
    if (unreadCount === 0) return;
    try {
      await markAll().unwrap();
    } catch {
      /* non-fatal */
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`${t("header.notifications")}${unreadCount ? ` (${unreadCount})` : ""}`}
        className="relative grid h-11 w-11 place-items-center rounded-lg border border-white/25 text-accent-foreground transition-colors hover:border-white/60 focus-ring"
      >
        <Bell className="h-[20px] w-[20px]" strokeWidth={1.6} />
        {unreadCount > 0 && <Badge count={unreadCount} />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-[110] mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-line bg-surface shadow-hover"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-sm font-bold">{t("header.notifications")}</p>
              <button
                onClick={handleMarkAll}
                disabled={unreadCount === 0 || marking}
                className="flex items-center gap-1 text-xs text-stone transition-colors hover:text-ink disabled:opacity-40"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {t("header.markAllRead")}
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {isLoading ? (
                <div className="space-y-3 p-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton h-12 w-full rounded-md" />
                  ))}
                </div>
              ) : isError ? (
                <p className="px-4 py-8 text-center text-sm text-stone">{t("header.notificationsLoadError")}</p>
              ) : notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-stone">
                  {t("header.notificationsEmpty")}
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {notifications.map((n) => (
                    <li key={n._id}>
                      <button
                        onClick={() => handleClick(n)}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-wash",
                          !n.readAt && "bg-accent/5",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1.5 h-2 w-2 flex-shrink-0 rounded-full",
                            n.readAt ? "bg-transparent" : "bg-verm",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className={cn("text-sm", n.readAt ? "text-stone" : "font-medium text-ink")}>
                            {n.message}
                          </p>
                          <p className="mt-0.5 text-xs text-stone">{notificationTimeAgo(n.createdAt)}</p>
                        </div>
                        {n.readAt && <Check className="h-3.5 w-3.5 flex-shrink-0 text-stone" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
