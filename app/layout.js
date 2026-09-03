import { cookies } from "next/headers";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";

import AppProviders from "@/context/ThemeProvider.jsx";
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

export const metadata = {
  title: {
    default: "TAHOS. — Find the pair that moves like you",
    template: "%s · TAHOS.",
  },
  description:
    "Everyday icons, rare colorways, and all-day favorites—curated for wherever the day decides to go.",
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3F0E8" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0B0D" },
  ],
};

export default async function RootLayout({ children }) {
  // Read the persisted theme on the server so the first paint is already
  // correct — no flash of the wrong palette on load.
  const store = await cookies();
  const theme = store.get("tahos-theme")?.value === "dark" ? "dark" : "light";

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${instrumentSans.variable} ${instrumentSerif.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <a
          href="#main"
          className="absolute -left-[9999px] top-2 z-[999] rounded-lg bg-verm px-[18px] py-3 text-sm font-semibold text-white focus:left-4"
        >
          Skip to content
        </a>
        <AppProviders initialTheme={theme}>{children}</AppProviders>
      </body>
    </html>
  );
}
