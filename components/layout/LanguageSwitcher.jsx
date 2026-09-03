"use client";

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
 * Switching locale only writes the locale cookie (see LocaleProvider) and
 * re-renders text in place; it never touches the router, so cart, filters,
 * search and scroll position are all untouched by a language change.
 */
export default function LanguageSwitcher({ className, showLabel = "sm" }) {
  const { locale, setLocale, t } = useLocale();
  const nextLocale = OTHER_LOCALE[locale] ?? "en-BD";

  return (
    <button
      type="button"
      onClick={() => setLocale(nextLocale)}
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
