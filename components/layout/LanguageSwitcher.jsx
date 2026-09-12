"use client";

import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";

import { useLocale } from "../../context/LocaleProvider.jsx";
import { cn } from "../../lib/utils.js";

const OTHER_LOCALE = { "bn-BD": "en-BD", "en-BD": "bn-BD" };
const LABEL_KEY = { "bn-BD": "language.bn", "en-BD": "language.en" };

/**
 * A straight two-way toggle, same shape as ThemeProvider's dark/light
 * button (see toggleTheme in Header.jsx and AdminTopbar.jsx): one click
 * flips directly to the other language, no menu to open first. Shared by
 * the storefront header, its mobile drawer, and the admin topbar — no
 * separate variants to keep in sync. `className` overrides the storefront
 * default sizing/tokens (via tailwind-merge) for callers like the admin
 * topbar that use a different, icon-only square-button style.
 * `showLabel`: "sm" (label from the sm breakpoint up — default), "always",
 * or "never" (icon-only, matching an icon-only toolbar).
 *
 * Switching locale writes the cookie (LocaleProvider) — that alone only
 * re-renders CLIENT Component text in place (t() calls in "use client"
 * files). Every Server Component page in this app (HomePage, ShopPage,
 * ProductDetailPage, OrdersPage, DashboardPage, the admin Overview, ...)
 * resolves its own text server-side via getT()/getServerLocale() at
 * request time and bakes it into the HTML it already sent — that text
 * doesn't change just because the client-side cookie did, which is
 * exactly the "still shows Bangla after switching to English" bug this
 * used to have. router.refresh() re-requests the current route's Server
 * Component payload (picking up the just-written cookie) without a full
 * page reload, so it updates that server-rendered text too — it does NOT
 * reset any client-side state (cart, filters, search, scroll position),
 * since only the server-rendered parts of the tree are re-fetched.
 */
export default function LanguageSwitcher({ className, showLabel = "sm" }) {
  const { locale, setLocale, t } = useLocale();
  const router = useRouter();
  const nextLocale = OTHER_LOCALE[locale] ?? "en-BD";

  const handleSwitch = () => {
    setLocale(nextLocale);
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={handleSwitch}
      aria-label={t("language.switchTo", { lang: t(LABEL_KEY[nextLocale]) })}
      title={t("language.switchTo", { lang: t(LABEL_KEY[nextLocale]) })}
      className={cn(
        "flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-[13.5px] font-medium text-ink transition-colors hover:bg-wash focus-ring",
        className,
      )}
    >
      <Languages className="h-[18px] w-[18px]" />
      {showLabel !== "never" && (
        <span className={showLabel === "sm" ? "hidden sm:inline" : undefined}>{t(LABEL_KEY[locale])}</span>
      )}
    </button>
  );
}
