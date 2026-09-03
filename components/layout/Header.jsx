"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useDispatch, useSelector } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import {
  Heart,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Moon,
  Package,
  Scale,
  Search,
  ShoppingBag,
  Sun,
  User as UserIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "../../lib/utils.js";
import { useTheme } from "../../context/ThemeProvider.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import {
  selectCurrentUser,
  selectCanAccessAdmin,
  clearCredentials,
} from "../../store/authSlice.js";
import { useLogoutMutation } from "../../store/userApi.js";
import { useGetCartQuery, useGetWishlistQuery } from "../../store/shopApi.js";
import {
  toggleCart,
  toggleMobileMenu,
  toggleSearch,
  setMobileMenuOpen,
} from "../../store/uiSlice.js";

const ANNOUNCEMENTS = [
  { text: "Complimentary delivery over $200", accent: true },
  { text: "Easy 14-day exchanges" },
  { text: "Secure checkout" },
];

const SHOP_MENU = [
  {
    heading: "Collections",
    links: [
      { label: "New arrivals", href: "/shop?sort=-createdAt" },
      { label: "Best sellers", href: "/shop?featured=true" },
      { label: "Everyday sneakers", href: "/shop?category=everyday" },
      { label: "Performance", href: "/shop?category=performance" },
      { label: "Statement pairs", href: "/shop?category=statement" },
      { label: "Under $120", href: "/shop?priceMax=120" },
      { label: "Sale", href: "/shop?sale=true", accent: true },
    ],
  },
  {
    heading: "Shop by",
    links: [
      { label: "Men", href: "/shop?gender=men" },
      { label: "Women", href: "/shop?gender=women" },
      { label: "Kids", href: "/shop?gender=kids" },
      { label: "Unisex", href: "/shop?gender=unisex" },
      { label: "Size guide", href: "/size-guide" },
    ],
  },
  {
    heading: "Silhouette",
    links: [
      { label: "Retro runners", href: "/shop?silhouette=retro-runner" },
      { label: "Low-profile terrace", href: "/shop?silhouette=terrace" },
      { label: "Trail & technical", href: "/shop?silhouette=trail" },
      { label: "Court classics", href: "/shop?silhouette=court" },
      { label: "Chunky & dad", href: "/shop?silhouette=chunky" },
    ],
  },
];

const FEATURED_BRANDS = [
  { name: "New Balance", count: "48" },
  { name: "Adidas", count: "62" },
  { name: "Nike", count: "57" },
  { name: "Asics", count: "31" },
  { name: "Salomon", count: "18" },
  { name: "Puma", count: "24" },
  { name: "Hoka", count: "16" },
  { name: "Reebok", count: "21" },
];

const GENDER_LINKS = [
  { label: "Men", href: "/shop?gender=men" },
  { label: "Women", href: "/shop?gender=women" },
  { label: "Kids", href: "/shop?gender=kids" },
];

export default function Header() {
  const { theme, isDark, toggleTheme } = useTheme();
  const settings = useSettings();
  const user = useSelector(selectCurrentUser);
  const isAdmin = useSelector(selectCanAccessAdmin);
  const mobileMenuOpen = useSelector((s) => s.ui.mobileMenuOpen);
  const compareCount = useSelector((s) => s.ui.compareList.length);
  const dispatch = useDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const [logout] = useLogoutMutation();

  const [menu, setMenu] = useState(null); // "shop" | "brands" | null
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const closeTimer = useRef(null);

  const shopName = settings?.store?.name || theme?.siteName || "TAHOS.";

  const { data: cartData } = useGetCartQuery(undefined, { skip: !user });
  const { data: wlData } = useGetWishlistQuery(undefined, { skip: !user });
  const guestCount = useSelector((s) =>
    s.guestCart.items.reduce((n, i) => n + i.quantity, 0),
  );
  const cartCount = user
    ? cartData?.cart?.items?.reduce((s, i) => s + i.quantity, 0) || 0
    : guestCount;
  const wlCount = wlData?.wishlist?.products?.length || 0;

  // The board compacts the bar from 88px to 66px past 32px of scroll.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 32);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Escape closes any open mega menu; ⌘K / Ctrl+K opens search.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setMenu(null);
        setUserMenuOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        dispatch(toggleSearch());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  // Route change closes every transient surface. Local panels reset during
  // render (React's "adjust state when a prop changes" pattern) so the new
  // page never paints with a stale menu open; the Redux drawer follows in an
  // effect, since dispatching during render is not allowed.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenu(null);
    setUserMenuOpen(false);
  }

  useEffect(() => {
    dispatch(setMobileMenuOpen(false));
  }, [pathname, dispatch]);

  // Small grace period so a diagonal mouse path between trigger and panel
  // doesn't dismiss the menu mid-travel.
  const openMenu = useCallback((next) => {
    clearTimeout(closeTimer.current);
    setMenu(next);
  }, []);
  const scheduleClose = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMenu(null), 120);
  }, []);

  const handleLogout = async () => {
    try {
      await logout().unwrap();
    } catch {
      // Server-side session may already be gone; clear locally regardless.
    }
    dispatch(clearCredentials());
    setUserMenuOpen(false);
    toast.success("Signed out");
    router.push("/");
  };

  return (
    <>
      {/* Announcement rail — desktop/tablet only. On a narrow phone screen
          three items plus "Ships within..." force a horizontal scroll just
          to read the strip; dropped entirely below md rather than trying to
          make a horizontally-scrolling marquee work on a small screen. */}
      <div
        role="region"
        aria-label="Store announcements"
        className="sticky top-0 z-[120] hidden overflow-x-auto border-b border-line bg-surface no-scrollbar md:block"
      >
        <div className="mx-auto flex max-w-[1480px] items-center gap-[22px] whitespace-nowrap px-5 py-[9px] font-mono text-[11.5px] uppercase tracking-[0.09em] text-stone sm:px-8 lg:px-14">
          {theme?.features?.announcementBar ? (
            <span className="text-verm">{theme.features.announcementBar}</span>
          ) : (
            ANNOUNCEMENTS.map((a, i) => (
              <span key={a.text} className="flex items-center gap-[22px]">
                <span className={a.accent ? "text-verm" : undefined}>{a.text}</span>
                {i < ANNOUNCEMENTS.length - 1 && (
                  <span className="opacity-40">·</span>
                )}
              </span>
            ))
          )}
          <div className="flex-1" />
          <span className="hidden md:inline">
            Ships within the United States · USD
          </span>
        </div>
      </div>

      <header
        onMouseLeave={scheduleClose}
        className={cn(
          // No announcement rail above it on mobile, so it sticks flush to
          // the very top there; tablet/desktop still offset by the rail's height.
          "sticky top-0 z-[90] border-b transition-[background-color,border-color] duration-[240ms] md:top-[41px]",
          scrolled
            ? "border-line bg-surface/85 backdrop-blur-lg"
            : "border-transparent bg-canvas",
        )}
      >
        {/* True mobile app-shell bar (<768px): logo, theme toggle, cart —
            no hamburger, no search box. Search/Saved/Profile/Shop all live
            in MobileNav's bottom tabs instead, matching the board's phone
            shell exactly. Tablet and up keep the bar below, unchanged. */}
        <div className="flex h-[58px] items-center gap-3 px-5 md:hidden">
          <Link
            href="/"
            className="flex-none text-[20px] font-semibold tracking-[-0.045em] text-ink focus-ring"
          >
            {shopName}
          </Link>
          <div className="flex-1" />
          <button
            onClick={toggleTheme}
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            className="grid h-11 w-11 place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring"
          >
            {isDark ? <Sun className="h-[20px] w-[20px]" /> : <Moon className="h-[20px] w-[20px]" />}
          </button>
          <button
            onClick={() => dispatch(toggleCart())}
            aria-label={cartCount ? `Cart, ${cartCount} items` : "Cart"}
            className="relative grid h-11 w-11 place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring"
          >
            <ShoppingBag className="h-[21px] w-[21px]" strokeWidth={1.6} />
            {cartCount > 0 && <Badge count={cartCount} />}
          </button>
        </div>

        <div
          className={cn(
            "mx-auto hidden max-w-[1480px] items-center gap-4 px-5 transition-[height] duration-[240ms] md:flex sm:px-8 lg:gap-6 lg:px-14 xl:gap-10",
            scrolled ? "h-[66px]" : "h-[70px] lg:h-[88px]",
          )}
        >
          {/* Mobile menu (tablet only — true mobile has no hamburger) */}
          <button
            onClick={() => dispatch(toggleMobileMenu())}
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
            className="-ml-2 grid h-11 w-11 flex-none place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <Link
            href="/"
            className="flex-none text-[23px] font-semibold tracking-[-0.045em] text-ink focus-ring"
          >
            {shopName}
          </Link>

          {/* Primary nav */}
          <nav
            aria-label="Primary"
            className="hidden items-center gap-[14px] text-[14.5px] font-medium lg:flex xl:gap-[26px]"
          >
            <HeaderNavLink href="/shop?sort=-createdAt" pathname={pathname} className="gap-1.5">
              New
              <span aria-hidden="true" className="h-[5px] w-[5px] rounded-full bg-lime" />
            </HeaderNavLink>

            <MegaTrigger
              label="Shop"
              open={menu === "shop"}
              onOpen={() => openMenu("shop")}
              onToggle={() => setMenu(menu === "shop" ? null : "shop")}
            />

            {GENDER_LINKS.map((l) => (
              <HeaderNavLink key={l.label} href={l.href} pathname={pathname}>
                {l.label}
              </HeaderNavLink>
            ))}

            <MegaTrigger
              label="Brands"
              open={menu === "brands"}
              onOpen={() => openMenu("brands")}
              onToggle={() => setMenu(menu === "brands" ? null : "brands")}
            />

            <HeaderNavLink
              href="/journal"
              pathname={pathname}
              className="hidden xl:flex"
            >
              Journal
            </HeaderNavLink>
          </nav>

          <div className="flex-1" />

          {/* Search */}
          <button
            onClick={() => dispatch(toggleSearch())}
            aria-label="Search products"
            title="Search (⌘K)"
            className="flex h-11 items-center justify-center gap-2.5 rounded-lg border border-line px-3 text-stone transition-colors hover:border-ink hover:text-ink focus-ring md:w-[210px] md:justify-start"
          >
            <Search className="h-[18px] w-[18px] flex-none" />
            <span className="hidden text-[14px] md:inline">Search</span>
            <span className="ml-auto hidden font-mono text-[11px] text-stone lg:inline">
              ⌘K
            </span>
          </button>

          <div className="flex items-center gap-0.5">
            <button
              onClick={toggleTheme}
              aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
              title={isDark ? "Light theme" : "Dark theme"}
              className="grid h-11 w-11 place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring"
            >
              {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </button>

            {compareCount > 0 && (
              <Link
                href="/compare"
                aria-label={`Compare ${compareCount} products`}
                className="relative hidden h-11 w-11 place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring sm:grid"
              >
                <Scale className="h-[18px] w-[18px]" />
                <Badge count={compareCount} />
              </Link>
            )}

            <Link
              href="/wishlist"
              aria-label={wlCount ? `Wishlist, ${wlCount} saved` : "Wishlist"}
              className="relative hidden h-11 w-11 place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring sm:grid"
            >
              <Heart className="h-[18px] w-[18px]" />
              {wlCount > 0 && <Badge count={wlCount} />}
            </Link>

            {/* Account */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-label="Account"
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                className="grid h-11 w-11 place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring"
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
                    className="absolute right-0 top-[52px] w-56 overflow-hidden rounded-xl border border-line bg-elev p-1.5 shadow-soft"
                  >
                    {user ? (
                      <>
                        <div className="border-b border-line px-3 pb-2.5 pt-2">
                          <div className="truncate text-sm font-semibold">
                            {user.name}
                          </div>
                          <div className="truncate text-xs text-stone">
                            {user.email}
                          </div>
                        </div>
                        <MenuLink href="/profile" icon={UserIcon}>Profile</MenuLink>
                        <MenuLink href="/orders" icon={Package}>Orders</MenuLink>
                        {isAdmin && (
                          <MenuLink href="/admin" icon={LayoutDashboard}>
                            Admin
                          </MenuLink>
                        )}
                        <button
                          role="menuitem"
                          onClick={handleLogout}
                          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink transition-colors hover:bg-wash focus-ring"
                        >
                          <LogOut className="h-4 w-4 text-stone" />
                          Sign out
                        </button>
                      </>
                    ) : (
                      <>
                        <MenuLink href="/login" icon={LogIn}>Sign in</MenuLink>
                        <MenuLink href="/register" icon={UserIcon}>
                          Create account
                        </MenuLink>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Cart */}
            <button
              onClick={() => dispatch(toggleCart())}
              aria-label={cartCount ? `Cart, ${cartCount} items` : "Cart"}
              className="relative ml-1 flex h-11 items-center gap-2.5 rounded-lg bg-ink px-4 text-canvas transition-colors hover:bg-verm hover:text-white focus-ring"
            >
              <ShoppingBag className="h-[18px] w-[18px]" />
              <span data-tabular className="font-mono text-[13px]">
                {cartCount}
              </span>
            </button>
          </div>
        </div>

        {/* Mega menus */}
        <AnimatePresence>
          {menu === "shop" && (
            <MegaPanel key="shop" onMouseEnter={() => openMenu("shop")}>
              <div className="grid gap-12 lg:grid-cols-[1fr_1fr_1fr_1.25fr]">
                {SHOP_MENU.map((col) => (
                  <div key={col.heading}>
                    <div className="mb-[18px] font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                      {col.heading}
                    </div>
                    <div className="flex flex-col gap-[11px] text-[15.5px]">
                      {col.links.map((l) => (
                        <Link
                          key={l.label}
                          href={l.href}
                          className={cn(
                            "w-fit transition-colors hover:text-verm focus-ring",
                            l.accent && "text-verm",
                          )}
                        >
                          {l.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
                <Link href="/journal" className="group block focus-ring">
                  <div className="relative aspect-16/10 overflow-hidden rounded-2xl bg-media">
                    <div aria-hidden="true" className="absolute inset-0 hatch" />
                    <div aria-hidden="true" className="absolute inset-0 glow" />
                  </div>
                  <div className="mt-3.5 flex items-baseline gap-2.5">
                    <span className="font-serif text-[25px] italic leading-tight">
                      Drop 02 — City in Motion
                    </span>
                    <span className="font-mono text-[11px] text-verm">
                      View the story →
                    </span>
                  </div>
                </Link>
              </div>
            </MegaPanel>
          )}

          {menu === "brands" && (
            <MegaPanel key="brands" onMouseEnter={() => openMenu("brands")}>
              <div className="grid gap-14 lg:grid-cols-[2fr_1.1fr]">
                <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
                  {FEATURED_BRANDS.map((b) => (
                    <Link
                      key={b.name}
                      href={`/shop?brand=${encodeURIComponent(b.name)}`}
                      className="flex items-center justify-between rounded-[10px] border border-line px-[18px] py-4 text-[15px] font-medium transition-colors hover:border-ink hover:bg-wash focus-ring"
                    >
                      <span>{b.name}</span>
                      <span className="font-mono text-[11px] text-stone">
                        {b.count}
                      </span>
                    </Link>
                  ))}
                </div>
                <div>
                  <div className="relative aspect-4/3 overflow-hidden rounded-2xl bg-media">
                    <div aria-hidden="true" className="absolute inset-0 hatch" />
                  </div>
                  <p className="mt-3.5 max-w-[34ch] text-[15px] leading-relaxed text-stone">
                    Brand stories, archive notes, and what we actually keep in
                    stock.
                  </p>
                </div>
              </div>
            </MegaPanel>
          )}
        </AnimatePresence>
      </header>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-[3px] lg:hidden"
            onClick={() => dispatch(setMobileMenuOpen(false))}
          >
            <motion.nav
              aria-label="Mobile"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="flex h-full w-[min(340px,86%)] flex-col overflow-y-auto bg-surface"
            >
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <span className="text-[21px] font-semibold tracking-[-0.045em]">
                  {shopName}
                </span>
                <button
                  onClick={() => dispatch(setMobileMenuOpen(false))}
                  aria-label="Close menu"
                  className="grid h-11 w-11 place-items-center rounded-lg transition-colors hover:bg-wash focus-ring"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex flex-col gap-1 p-4">
                <Link href="/shop?sort=-createdAt" className="rounded-lg px-3 py-3 text-[17px] font-medium hover:bg-wash focus-ring">
                  New arrivals
                </Link>
                {GENDER_LINKS.map((l) => (
                  <Link key={l.label} href={l.href} className="rounded-lg px-3 py-3 text-[17px] font-medium hover:bg-wash focus-ring">
                    {l.label}
                  </Link>
                ))}
                <Link href="/wishlist" className="rounded-lg px-3 py-3 text-[17px] font-medium hover:bg-wash focus-ring">
                  Wishlist{wlCount ? ` (${wlCount})` : ""}
                </Link>
                <Link href="/orders" className="rounded-lg px-3 py-3 text-[17px] font-medium hover:bg-wash focus-ring">
                  Orders
                </Link>
              </div>

              <div className="mt-auto border-t border-line p-4">
                {SHOP_MENU[0].links.slice(0, 4).map((l) => (
                  <Link
                    key={l.label}
                    href={l.href}
                    className="block rounded-lg px-3 py-2 text-sm text-stone hover:bg-wash focus-ring"
                  >
                    {l.label}
                  </Link>
                ))}
                <div className="mt-3 border-t border-line pt-3">
                  {user ? (
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm hover:bg-wash focus-ring"
                    >
                      <LogOut className="h-4 w-4 text-stone" /> Sign out
                    </button>
                  ) : (
                    <Link
                      href="/login"
                      className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm hover:bg-wash focus-ring"
                    >
                      <LogIn className="h-4 w-4 text-stone" /> Sign in
                    </Link>
                  )}
                </div>
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
 * A plain nav link that knows whether it's the current page. Matches on the
 * pathname only (not query string) — the gender links share /shop as their
 * path, so this marks Shop-family links as current together rather than
 * inventing a query-aware "active" state the design doesn't define.
 */
function HeaderNavLink({ href, pathname, className, children }) {
  const linkPath = href.split("?")[0];
  const isActive = linkPath !== "/" && pathname === linkPath;
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "relative flex items-center py-1.5 transition-colors hover:text-verm focus-ring",
        isActive && "text-verm",
        className,
      )}
    >
      {children}
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 h-0.5 bg-verm transition-[width] duration-200"
        style={{ width: isActive ? "100%" : "0%" }}
      />
    </Link>
  );
}

function MegaTrigger({ label, open, onOpen, onToggle }) {
  return (
    <button
      onMouseEnter={onOpen}
      onFocus={onOpen}
      onClick={onToggle}
      aria-expanded={open}
      aria-haspopup="true"
      className={cn(
        "relative py-1.5 text-[14.5px] font-medium transition-colors focus-ring",
        open ? "text-verm" : "text-ink",
      )}
    >
      {label}
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 h-0.5 bg-verm transition-[width] duration-200"
        style={{ width: open ? "100%" : "0%" }}
      />
    </button>
  );
}

function MegaPanel({ children, onMouseEnter }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onMouseEnter={onMouseEnter}
      className="hidden border-t border-line bg-surface shadow-soft lg:block"
    >
      <div className="mx-auto max-w-[1480px] px-5 pb-11 pt-10 sm:px-8 lg:px-14">
        {children}
      </div>
    </motion.div>
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
      className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-lg bg-verm px-1 font-mono text-[10px] leading-none text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
