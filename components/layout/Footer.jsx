"use client";

import Link from "next/link";

import CurrencySwitcher from "./CurrencySwitcher.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";

/**
 * lucide-react v1 dropped its brand glyphs, and the board draws these as
 * 1.6-weight line icons on the same 24 grid as the rest of the set — so they
 * live here inline rather than as a dependency.
 */
const SOCIALS = [
  {
    label: "Instagram",
    href: "https://instagram.com",
    path: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="4.5" />
        <circle cx="12" cy="12" r="3.6" />
        <circle cx="17" cy="7" r=".9" fill="currentColor" />
      </>
    ),
  },
  {
    label: "TikTok",
    href: "https://tiktok.com",
    path: (
      <>
        <path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5" />
        <path d="M14 6.5c1 1.6 2.4 2.4 4.2 2.5" />
      </>
    ),
  },
  {
    label: "Newsletter archive",
    href: "/#newsletter",
    path: (
      <>
        <rect x="3.5" y="6" width="17" height="12" rx="2" />
        <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
      </>
    ),
  },
];

const COLUMNS = [
  {
    heading: "Shop",
    links: [
      { label: "New arrivals", href: "/shop?sort=-createdAt" },
      { label: "The Rotation", href: "/shop?featured=true" },
      { label: "Everyday", href: "/shop?category=everyday" },
      { label: "Performance", href: "/shop?category=performance" },
      { label: "Sale", href: "/shop?sale=true" },
    ],
  },
  {
    heading: "Help",
    links: [
      { label: "Shipping & returns", href: "/shipping" },
      { label: "Size guide", href: "/size-guide" },
      { label: "Track an order", href: "/orders" },
      { label: "Contact", href: "/contact" },
      { label: "FAQ", href: "/faq" },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Create account", href: "/register" },
      { label: "Orders", href: "/orders" },
      { label: "Wishlist", href: "/wishlist" },
      { label: "Preferences", href: "/profile" },
    ],
  },
];

export default function Footer() {
  const settings = useSettings();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-32 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[1480px] grid-cols-2 gap-x-6 gap-y-10 px-5 pb-10 pt-[72px] sm:px-8 lg:grid-cols-[1.4fr_repeat(3,1fr)_1.1fr] lg:gap-12 lg:px-14">
        {/* Brand block spans both mobile columns — its social-icon row needs
            the full width; Shop/Help/Account/Region then pair up 2-per-row
            below it instead of stacking one-by-one down the page. */}
        <div className="col-span-2 lg:col-span-1">
          <Link
            href="/"
            className="text-[23px] font-semibold tracking-[-0.045em] text-ink"
          >
            TAHOS.
          </Link>
          <p className="mt-4 max-w-[26ch] text-base leading-relaxed text-stone">
            Footwear for wherever the day goes next.
          </p>
          <div className="mt-6 flex gap-2">
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                aria-label={s.label}
                target={s.href.startsWith("http") ? "_blank" : undefined}
                rel={s.href.startsWith("http") ? "noreferrer noopener" : undefined}
                className="grid h-11 w-11 place-items-center rounded-lg border border-line text-ink transition-colors hover:border-ink focus-ring"
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  {s.path}
                </svg>
              </a>
            ))}
          </div>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.heading}>
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
              {col.heading}
            </div>
            <div className="mt-[18px] flex flex-col gap-[11px] text-[15px]">
              {col.links.map((l) => (
                <Link
                  key={l.label}
                  href={l.href}
                  className="w-fit text-ink transition-colors hover:text-verm focus-ring"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
        ))}

        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
            Region
          </div>
          <div className="mt-[18px] flex flex-col gap-3">
            <span className="text-[13px] text-stone">Ship to</span>
            <CurrencySwitcher />
            <p className="text-[13px] leading-relaxed text-stone">
              Duties and taxes are calculated at checkout.
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-[22px] gap-y-2 px-5 py-5 text-[12.5px] text-stone sm:px-8 lg:px-14">
          <span>
            © {year} {settings?.siteName || "Tahos Store"}
          </span>
          <Link href="/privacy" className="hover:text-ink focus-ring">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink focus-ring">
            Terms
          </Link>
          <Link href="/accessibility" className="hover:text-ink focus-ring">
            Accessibility
          </Link>
          <div className="flex-1" />
          <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
            Prices in USD · Ships from the United States
          </span>
        </div>
      </div>
    </footer>
  );
}
