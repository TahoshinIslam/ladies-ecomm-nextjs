import { cookies } from "next/headers";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";

import AppProviders from "@/context/ThemeProvider.jsx";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isValidLocale } from "@/lib/i18n/config.js";
import { getT } from "@/lib/i18n/server.js";
import { getSiteOrigin } from "@/lib/seo.js";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
});

// Phase 10 — `metadataBase` is only set when a real origin is configured
// (see lib/seo.js's getSiteOrigin() — never throws, unlike
// lib/appUrl.js's resolveAppOrigin()); every page's `alternates.canonical`
// and `openGraph.url` resolve against it automatically when present, and
// simply stay relative (still valid, just not cross-site-canonical) when
// it isn't.
//
// Deliberately NOT reading live settings/theme here for the site name
// (tried it, reverted it): generateMetadata runs on every single page
// request, so a getCachedPublicSettings()/getCachedActiveTheme() call
// here would warm/read those cache tags far more often than before Phase
// 10 (previously only /api/settings/public and /api/theme/active ever
// touched them from a real request) — this changed cache-timing enough
// to make Phase 8's own settings-mutation-invalidation HTTP test flaky
// against the rest of the suite. The literal "TAHOS." fallback below
// matches the same last-resort default already hardcoded in
// components/layout/Header.jsx/Footer.jsx; only the live-settings-first
// resolution (a nice-to-have, not required by this phase) was dropped.
const siteName = "TAHOS.";

export async function generateMetadata() {
  const t = await getT();
  const origin = getSiteOrigin();

  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: {
      default: t("seo.defaultTitle"),
      template: `%s · ${siteName}`,
    },
    description: t("seo.defaultDescription"),
    applicationName: siteName,
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      type: "website",
      siteName,
      title: t("seo.defaultTitle"),
      description: t("seo.defaultDescription"),
    },
    twitter: {
      card: "summary",
      title: t("seo.defaultTitle"),
      description: t("seo.defaultDescription"),
    },
    // No explicit `icons` field: app/favicon.ico is already picked up
    // automatically by Next's file-convention icon handling — the only
    // real icon asset that exists in this repo (confirmed: no
    // icon.png/apple-icon.png/manifest.json). Declaring it again here
    // would just duplicate the same <link rel="icon"> Next already emits.
  };
}

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3F0E8" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0B0D" },
  ],
};

export default async function RootLayout({ children }) {
  // Read the persisted theme and language on the server so the first paint
  // is already correct — no flash of the wrong palette or language on load.
  const store = await cookies();
  const theme = store.get("tahos-theme")?.value === "dark" ? "dark" : "light";
  const localeCookie = store.get(LOCALE_COOKIE)?.value;
  const locale = isValidLocale(localeCookie) ? localeCookie : DEFAULT_LOCALE;
  const t = await getT();

  return (
    <html
      lang={locale}
      data-theme={theme}
      className={`${instrumentSans.variable} ${instrumentSerif.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <a
          href="#main"
          className="absolute -left-[9999px] top-2 z-[999] rounded-lg bg-verm px-[18px] py-3 text-sm font-semibold text-white focus:left-4"
        >
          {t("a11y.skipToContent")}
        </a>
        <AppProviders initialTheme={theme} initialLocale={locale}>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
