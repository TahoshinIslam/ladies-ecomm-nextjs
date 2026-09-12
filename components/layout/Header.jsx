"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
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
import { useLocale } from "../../context/LocaleProvider.jsx";
import { departmentName } from "../../lib/i18n/catalog.js";
import LanguageSwitcher from "./LanguageSwitcher.jsx";
import {
  selectCurrentUser,
  selectCanAccessAdmin,
  clearCredentials,
} from "../../store/authSlice.js";
import { useLogoutMutation } from "../../store/userApi.js";
import { useGetCartQuery, useGetWishlistQuery, useGetCategoriesQuery } from "../../store/shopApi.js";
import {
  toggleCart,
  toggleMobileMenu,
  toggleSearch,
  setMobileMenuOpen,
} from "../../store/uiSlice.js";
import useDialogFocus from "../../hooks/useDialogFocus.js";

// Free-shipping amount comes from live settings (see ANNOUNCEMENTS below,
// built in the component body) so this copy can never drift from the real,
// admin-configured threshold the way a hardcoded "$200" would. Translation
// keys, not literal text — resolved via t() in the component so this stays
// language-reactive without becoming a hook itself.
const STATIC_ANNOUNCEMENT_KEYS = ["header.announcementExchange", "header.announcementSecureCheckout"];

// The "Shop" mega-menu's Collections and Fabric columns are static — these
// are stable attribute values from the AttributeDefinition seed data, not
// documents with their own Mongo ids, so there's nothing to fetch. The
// middle "Departments" column is built from real category data instead
// (see the useGetCategoriesQuery call in Header() below) — it can't be a
// static constant since department ids are real, database-generated
// ObjectIds. `href` query values are stable filter values (see
// filters.jsx-style consumers) and never translated — only `labelKey`
// (resolved via t()) is.
const OCCASION_LINKS = [
  { labelKey: "header.newArrivals", href: "/shop?sort=-createdAt" },
  { labelKey: "header.featured", href: "/shop?featured=true" },
  { labelKey: "catalog.occasionEveryday", href: "/shop?occasion=everyday" },
  { labelKey: "header.prayerWear", href: "/shop?occasion=prayer" },
  { labelKey: "header.eidCollection", href: "/shop?occasion=eid", accent: true },
  { labelKey: "header.formal", href: "/shop?occasion=formal" },
  { labelKey: "header.bridal", href: "/shop?occasion=bridal" },
];

const FABRIC_LINKS = [
  { labelKey: "catalog.fabricNida", href: "/shop?fabric=nida" },
  { labelKey: "catalog.fabricCrepe", href: "/shop?fabric=crepe" },
  { labelKey: "catalog.fabricChiffon", href: "/shop?fabric=chiffon" },
  { labelKey: "catalog.fabricJersey", href: "/shop?fabric=jersey" },
  { labelKey: "catalog.fabricGeorgette", href: "/shop?fabric=georgette" },
];

// Second mega-menu trigger — occasion tiles replace the old brand grid;
// brand is optional/de-emphasized in this catalog (see Phase 1 architecture),
// occasion is a real, working filter facet across every department.
const OCCASIONS = [
  { nameKey: "catalog.occasionEveryday", value: "everyday" },
  { nameKey: "catalog.occasionPrayer", value: "prayer" },
  { nameKey: "catalog.occasionEid", value: "eid" },
  { nameKey: "catalog.occasionFormal", value: "formal" },
  { nameKey: "catalog.occasionBridal", value: "bridal" },
];

export default function Header({ initialDepartments = [] }) {
  const { theme, isDark, toggleTheme } = useTheme();
  const { t, locale } = useLocale();
  const settings = useSettings();
  const user = useSelector(selectCurrentUser);
  const isAdmin = useSelector(selectCanAccessAdmin);
  const mobileMenuOpen = useSelector((s) => s.ui.mobileMenuOpen);
  const compareCount = useSelector((s) => s.ui.compareList.length);
  const dispatch = useDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [logout] = useLogoutMutation();

  const [menu, setMenu] = useState(null); // "shop" | "brands" | null
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const closeTimer = useRef(null);

  const shopName = settings?.store?.name || theme?.siteName || "TAHOS.";

  const freeShipAmount = settings.freeShippingPitch();
  const ANNOUNCEMENTS = [
    ...(freeShipAmount
      ? [{ text: t("header.announcementFreeShipping", { amount: freeShipAmount }), accent: true }]
      : []),
    ...STATIC_ANNOUNCEMENT_KEYS.map((key) => ({ text: t(key) })),
  ];

  const { data: cartData } = useGetCartQuery(undefined, { skip: !user });
  const { data: wlData } = useGetWishlistQuery(undefined, { skip: !user });
  const guestCount = useSelector((s) =>
    s.guestCart.items.reduce((n, i) => n + i.quantity, 0),
  );
  const cartCount = user
    ? cartData?.cart?.items?.reduce((s, i) => s + i.quantity, 0) || 0
    : guestCount;
  const wlCount = wlData?.wishlist?.products?.length || 0;

  // Real departments for the top nav + Shop mega-menu — same query
  // ShopPage.jsx's department chips already use, so this stays consistent
  // with the live taxonomy instead of a hardcoded, driftable list.
  //
  // `initialDepartments` (from app/(routes)/layout.jsx, a Server Component)
  // seeds the very first paint — this client query's `data` is undefined
  // during SSR and for a moment after hydration, and falling back to `[]`
  // in that window is what made the nav render without Burqa/Hijab/Niqab
  // and then pop them in once the fetch resolved. The live query still
  // takes over once it resolves, keeping this fresh across client
  // navigations; the prop only covers the initial gap.
  const { data: catsData } = useGetCategoriesQuery();
  const departments = (catsData?.categories ?? initialDepartments).filter((c) => !c.parent);

  // The board compacts the bar from 88px to 66px once scrolled — that
  // height change shifts everything below the header up by as much as
  // ~22px (88 - 66), which a single scroll(Y > 32) threshold turns into a
  // feedback loop: crossing 32 shrinks the header, the resulting layout
  // shift (plus the browser's own scroll-anchoring, which nudges scrollY
  // to keep the same content under the viewport after a shift above it)
  // pulls scrollY back under 32, which grows the header again, which
  // shifts things back down past 32 — repeating every scroll frame and
  // reading as the header rapidly blinking between its two sizes. Two
  // thresholds with a gap wider than that shift (enter compact past 48,
  // only leave it below 16) means neither direction's own layout shift can
  // cross back over the OTHER threshold, breaking the loop. rAF-throttling
  // the handler also keeps this to at most one evaluation per frame.
  useEffect(() => {
    const SCROLLED_ON = 48;
    const SCROLLED_OFF = 16;
    let ticking = false;
    const evaluate = () => {
      setScrolled((prev) => {
        const y = window.scrollY;
        if (!prev && y > SCROLLED_ON) return true;
        if (prev && y < SCROLLED_OFF) return false;
        return prev;
      });
      ticking = false;
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(evaluate);
    };
    evaluate();
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

  // The tablet-width hamburger drawer previously had no dialog semantics
  // at all (no role/aria-modal, no focus trap, no initial-focus-in, no
  // focus-restore-on-close) — Escape didn't even close it, unlike the
  // mega menu/account dropdown handled above. This gives it the same
  // dialog behavior every other overlay in the app has.
  const mobileNavPanelRef = useRef(null);
  useDialogFocus({
    open: mobileMenuOpen,
    panelRef: mobileNavPanelRef,
    onClose: () => dispatch(setMobileMenuOpen(false)),
  });

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
    toast.success(t("auth.signedOut"));
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
        aria-label={t("header.shipsWithinBangladesh")}
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
          <span className="hidden md:inline">{t("header.shipsWithinBangladesh")}</span>
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
            aria-label={isDark ? t("header.switchLightTheme") : t("header.switchDarkTheme")}
            className="grid h-11 w-11 place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring"
          >
            {isDark ? <Sun className="h-[20px] w-[20px]" /> : <Moon className="h-[20px] w-[20px]" />}
          </button>
          <button
            onClick={() => dispatch(toggleCart())}
            aria-label={cartCount ? t("header.cartLabel", { count: cartCount }) : t("header.cartEmpty")}
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
            aria-label={t("header.openMenu")}
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
            <HeaderNavLink
              href="/shop?sort=-createdAt"
              pathname={pathname}
              searchParams={searchParams}
              className="gap-1.5"
            >
              {t("navigation.new")}
              <span aria-hidden="true" className="h-[5px] w-[5px] rounded-full bg-lime" />
            </HeaderNavLink>

            <MegaTrigger
              label={t("navigation.shop")}
              open={menu === "shop"}
              onOpen={() => openMenu("shop")}
              onToggle={() => setMenu(menu === "shop" ? null : "shop")}
            />

            {departments.slice(0, 3).map((d) => (
              <HeaderNavLink
                key={d._id}
                href={`/shop?category=${d._id}`}
                pathname={pathname}
                searchParams={searchParams}
              >
                {departmentName(locale, d.slug, d.name)}
              </HeaderNavLink>
            ))}

            <MegaTrigger
              label={t("navigation.occasions")}
              open={menu === "occasions"}
              onOpen={() => openMenu("occasions")}
              onToggle={() => setMenu(menu === "occasions" ? null : "occasions")}
            />

            <HeaderNavLink
              href="/journal"
              pathname={pathname}
              searchParams={searchParams}
              className="hidden xl:flex"
            >
              {t("navigation.journal")}
            </HeaderNavLink>
          </nav>

          <div className="flex-1" />

          {/* Search */}
          <button
            onClick={() => dispatch(toggleSearch())}
            aria-label={t("header.searchPlaceholder")}
            title={t("header.searchShortcut")}
            className="flex h-11 items-center justify-center gap-2.5 rounded-lg border border-line px-3 text-stone transition-colors hover:border-ink hover:text-ink focus-ring md:w-[210px] md:justify-start"
          >
            <Search className="h-[18px] w-[18px] flex-none" />
            <span className="hidden text-[14px] md:inline">{t("navigation.search")}</span>
            <span className="ml-auto hidden font-mono text-[11px] text-stone lg:inline">
              ⌘K
            </span>
          </button>

          <div className="flex items-center gap-0.5">
            <LanguageSwitcher />

            <button
              onClick={toggleTheme}
              aria-label={isDark ? t("header.switchLightTheme") : t("header.switchDarkTheme")}
              title={isDark ? t("header.switchLightTheme") : t("header.switchDarkTheme")}
              className="grid h-11 w-11 place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring"
            >
              {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </button>

            {compareCount > 0 && (
              <Link
                href="/compare"
                aria-label={t("header.compareLabel", { count: compareCount })}
                className="relative hidden h-11 w-11 place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring sm:grid"
              >
                <Scale className="h-[18px] w-[18px]" />
                <Badge count={compareCount} />
              </Link>
            )}

            <Link
              href="/wishlist"
              aria-label={wlCount ? t("header.wishlistLabel", { count: wlCount }) : t("header.wishlistEmpty")}
              className="relative hidden h-11 w-11 place-items-center rounded-lg text-ink transition-colors hover:bg-wash focus-ring sm:grid"
            >
              <Heart className="h-[18px] w-[18px]" />
              {wlCount > 0 && <Badge count={wlCount} />}
            </Link>

            {/* Account */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-label={t("header.account")}
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
                        {/* An admin's real dashboard is /admin — showing the
                            customer /dashboard (shopping stats) here too was
                            confusing (0 orders, since admins don't shop) and
                            redundant alongside the Admin link. */}
                        {isAdmin ? (
                          <MenuLink href="/admin" icon={LayoutDashboard}>
                            {t("navigation.admin")}
                          </MenuLink>
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
                        <MenuLink href="/register" icon={UserIcon}>
                          {t("navigation.createAccount")}
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
              aria-label={cartCount ? t("header.cartLabel", { count: cartCount }) : t("header.cartEmpty")}
              className="relative ml-1 flex h-11 items-center gap-2.5 rounded-lg bg-ink px-4 text-canvas transition-colors hover:bg-verm-contrast hover:text-white focus-ring"
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
                <div>
                  <h3 className="mb-[18px] font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                    {t("header.collections")}
                  </h3>
                  <div className="flex flex-col gap-[11px] text-[15.5px]">
                    {OCCASION_LINKS.map((l) => (
                      <Link
                        key={l.labelKey}
                        href={l.href}
                        className={cn(
                          "w-fit transition-colors hover:text-verm focus-ring",
                          l.accent && "text-verm",
                        )}
                      >
                        {t(l.labelKey)}
                      </Link>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="mb-[18px] font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                    {t("header.departments")}
                  </h3>
                  <div className="flex flex-col gap-[11px] text-[15.5px]">
                    {departments.map((d) => (
                      <Link
                        key={d._id}
                        href={`/shop?category=${d._id}`}
                        className="w-fit transition-colors hover:text-verm focus-ring"
                      >
                        {departmentName(locale, d.slug, d.name)}
                      </Link>
                    ))}
                    <Link href="/size-guide" className="w-fit transition-colors hover:text-verm focus-ring">
                      {t("navigation.sizeGuide")}
                    </Link>
                  </div>
                </div>
                <div>
                  <h3 className="mb-[18px] font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
                    {t("header.fabric")}
                  </h3>
                  <div className="flex flex-col gap-[11px] text-[15.5px]">
                    {FABRIC_LINKS.map((l) => (
                      <Link
                        key={l.labelKey}
                        href={l.href}
                        className="w-fit transition-colors hover:text-verm focus-ring"
                      >
                        {t(l.labelKey)}
                      </Link>
                    ))}
                  </div>
                </div>
                <Link href="/journal" className="group block focus-ring">
                  <div className="relative aspect-16/10 overflow-hidden rounded-2xl bg-media">
                    <div aria-hidden="true" className="absolute inset-0 hatch" />
                    <div aria-hidden="true" className="absolute inset-0 glow" />
                  </div>
                  <div className="mt-3.5 flex items-baseline gap-2.5">
                    <span className="font-serif text-[25px] italic leading-tight">
                      {t("header.theModestEdit")}
                    </span>
                    <span className="font-mono text-[11px] text-verm">
                      {t("header.viewTheStory")}
                    </span>
                  </div>
                </Link>
              </div>
            </MegaPanel>
          )}

          {menu === "occasions" && (
            <MegaPanel key="occasions" onMouseEnter={() => openMenu("occasions")}>
              <div className="grid gap-14 lg:grid-cols-[2fr_1.1fr]">
                <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
                  {OCCASIONS.map((o) => (
                    <Link
                      key={o.value}
                      href={`/shop?occasion=${o.value}`}
                      className="flex items-center justify-between rounded-[10px] border border-line px-[18px] py-4 text-[15px] font-medium transition-colors hover:border-ink hover:bg-wash focus-ring"
                    >
                      <span>{t(o.nameKey)}</span>
                    </Link>
                  ))}
                </div>
                <div>
                  <div className="relative aspect-4/3 overflow-hidden rounded-2xl bg-media">
                    <div aria-hidden="true" className="absolute inset-0 hatch" />
                  </div>
                  <p className="mt-3.5 max-w-[34ch] text-[15px] leading-relaxed text-stone">
                    {t("header.occasionsBlurb")}
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
              aria-label={t("navigation.shop")}
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
                  aria-label={t("header.closeMenu")}
                  className="grid h-11 w-11 place-items-center rounded-lg transition-colors hover:bg-wash focus-ring"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex flex-col gap-1 p-4">
                <Link href="/shop?sort=-createdAt" className="rounded-lg px-3 py-3 text-[17px] font-medium hover:bg-wash focus-ring">
                  {t("header.newArrivals")}
                </Link>
                {departments.map((d) => (
                  <Link key={d._id} href={`/shop?category=${d._id}`} className="rounded-lg px-3 py-3 text-[17px] font-medium hover:bg-wash focus-ring">
                    {departmentName(locale, d.slug, d.name)}
                  </Link>
                ))}
                <Link href="/wishlist" className="rounded-lg px-3 py-3 text-[17px] font-medium hover:bg-wash focus-ring">
                  {t("navigation.wishlist")}
                  {wlCount ? ` (${wlCount})` : ""}
                </Link>
                {/* Same admin-vs-customer split as the desktop dropdown
                    above: an admin's real dashboard is /admin, not the
                    customer shopping dashboard. */}
                {user && (
                  isAdmin ? (
                    <Link href="/admin" className="rounded-lg px-3 py-3 text-[17px] font-medium hover:bg-wash focus-ring">
                      {t("navigation.admin")}
                    </Link>
                  ) : (
                    <Link href="/dashboard" className="rounded-lg px-3 py-3 text-[17px] font-medium hover:bg-wash focus-ring">
                      {t("navigation.dashboard")}
                    </Link>
                  )
                )}
                <Link href="/orders" className="rounded-lg px-3 py-3 text-[17px] font-medium hover:bg-wash focus-ring">
                  {t("navigation.orders")}
                </Link>
              </div>

              <div className="mt-auto border-t border-line p-4">
                {OCCASION_LINKS.slice(0, 4).map((l) => (
                  <Link
                    key={l.labelKey}
                    href={l.href}
                    className="block rounded-lg px-3 py-2 text-sm text-stone hover:bg-wash focus-ring"
                  >
                    {t(l.labelKey)}
                  </Link>
                ))}
                <div className="mt-3 border-t border-line pt-3">
                  <div className="mb-3 px-3">
                    <LanguageSwitcher className="w-full justify-start px-3" showLabel="always" />
                  </div>
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
 * value in the current URL — "New" (?sort=-createdAt) and "Burqa"
 * (?category=<id>) can then never both read as active, and switching
 * department correctly kills the previous one's highlight.
 */
function HeaderNavLink({ href, pathname, searchParams, className, children }) {
  const [linkPath, linkQuery] = href.split("?");
  const isActive =
    linkPath !== "/" &&
    pathname === linkPath &&
    (!linkQuery ||
      [...new URLSearchParams(linkQuery)].every(
        ([key, value]) => searchParams?.get(key) === value,
      ));
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
      className="absolute inset-x-0 top-full hidden border-t border-line bg-surface shadow-soft lg:block"
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
      className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-lg bg-verm-contrast px-1 font-mono text-[10px] leading-none text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
