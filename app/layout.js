import { cookies } from "next/headers";
import { Inter, Manrope } from "next/font/google";

import AppProviders from "@/context/ThemeProvider.jsx";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isValidLocale } from "@/lib/i18n/config.js";
import { getT } from "@/lib/i18n/server.js";
import { getSiteOrigin } from "@/lib/seo.js";
import { getStoreName } from "@/lib/storeName.js";
import "./globals.css";

// Leo Store design system: Inter for body/UI/forms, Manrope for headings +
// the wordmark (see app/globals.css --font-sans/--font-serif).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

// Phase 10 — `metadataBase` is only set when a real origin is configured
// (see lib/seo.js's getSiteOrigin() — never throws, unlike
// lib/appUrl.js's resolveAppOrigin()); every page's `alternates.canonical`
// and `openGraph.url` resolve against it automatically when present, and
// simply stay relative (still valid, just not cross-site-canonical) when
// it isn't.
//
// The site name is this store's own (lib/storeName.js): what the owner typed, else the organization's name. It is read
// with a plain query kept for a minute — NOT through the settings/theme caches. generateMetadata runs on every page
// request, so touching those cache tags here would change their timing (it made the settings-invalidation HTTP test
// flaky when tried), and a rename shows up within the minute anyway.

export async function generateMetadata() {
  const t = await getT();
  const origin = getSiteOrigin();
  const siteName = (await getStoreName()) || "Store";
  const defaultTitle = `${siteName} — ${t("seo.defaultTitle")}`;

  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: {
      default: defaultTitle,
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
      title: defaultTitle,
      description: t("seo.defaultDescription"),
    },
    twitter: {
      card: "summary",
      title: defaultTitle,
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
    { media: "(prefers-color-scheme: light)", color: "#FAFAF7" },
    { media: "(prefers-color-scheme: dark)", color: "#14150F" },
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
      className={`${inter.variable} ${manrope.variable} h-full`}
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
