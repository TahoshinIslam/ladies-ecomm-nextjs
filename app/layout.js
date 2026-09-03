import { cookies } from "next/headers";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";

import AppProviders from "@/context/ThemeProvider.jsx";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isValidLocale } from "@/lib/i18n/config.js";
import { getT } from "@/lib/i18n/server.js";
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

export async function generateMetadata() {
  const t = await getT();
  return {
    title: {
      default: t("seo.defaultTitle"),
      template: "%s · TAHOS.",
    },
    description: t("seo.defaultDescription"),
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
