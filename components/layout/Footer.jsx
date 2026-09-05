"use client";

import Link from "next/link";

import { useSettings } from "../../context/SettingsContext.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { departmentName } from "../../lib/i18n/catalog.js";
import { useGetCategoriesQuery } from "../../store/shopApi.js";

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
    labelKey: "footer.newsletterArchive",
    href: "/#newsletter",
    path: (
      <>
        <rect x="3.5" y="6" width="17" height="12" rx="2" />
        <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
      </>
    ),
  },
];

const STATIC_COLUMN_KEYS = [
  {
    headingKey: "footer.help",
    links: [
      { labelKey: "footer.shippingReturns", href: "/shipping" },
      { labelKey: "footer.sizeGuide", href: "/size-guide" },
      { labelKey: "footer.trackOrder", href: "/orders" },
      { labelKey: "footer.contact", href: "/contact" },
      { labelKey: "footer.faq", href: "/faq" },
    ],
  },
  {
    headingKey: "footer.account",
    links: [
      { labelKey: "footer.signIn", href: "/login" },
      { labelKey: "footer.createAccount", href: "/register" },
      { labelKey: "footer.orders", href: "/orders" },
      { labelKey: "footer.wishlist", href: "/wishlist" },
      { labelKey: "footer.preferences", href: "/profile" },
    ],
  },
];

export default function Footer() {
  const settings = useSettings();
  const { t, locale } = useLocale();
  const year = new Date().getFullYear();
  const { data: catsData } = useGetCategoriesQuery();
  const departments = (catsData?.categories ?? []).filter((c) => !c.parent);

  const columns = [
    {
      heading: t("footer.shop"),
      links: [
        { label: t("header.newArrivals"), href: "/shop?sort=-createdAt" },
        ...departments
          .slice(0, 4)
          .map((d) => ({ label: departmentName(locale, d.slug, d.name), href: `/shop?category=${d._id}` })),
      ],
    },
    ...STATIC_COLUMN_KEYS.map((col) => ({
      heading: t(col.headingKey),
      links: col.links.map((l) => ({ label: t(l.labelKey), href: l.href })),
    })),
  ];

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
            {settings?.store?.name || "TAHOS."}
          </Link>
          <p className="mt-4 max-w-[26ch] text-base leading-relaxed text-stone">
            {t("footer.tagline")}
          </p>
          {(settings?.store?.supportEmail || settings?.store?.supportPhone) && (
            <div className="mt-4 space-y-1 text-[13.5px] text-stone">
              {settings.store.supportEmail && (
                <a href={`mailto:${settings.store.supportEmail}`} className="block hover:text-ink">
                  {settings.store.supportEmail}
                </a>
              )}
              {settings.store.supportPhone && (
                <a href={`tel:${settings.store.supportPhone}`} className="block hover:text-ink">
                  {settings.store.supportPhone}
                </a>
              )}
            </div>
          )}
          <div className="mt-6 flex gap-2">
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                aria-label={s.labelKey ? t(s.labelKey) : s.label}
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

        {columns.map((col) => (
          <div key={col.heading}>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
              {col.heading}
            </h2>
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
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-stone">
            {t("footer.region")}
          </h2>
          <div className="mt-[18px] flex flex-col gap-3">
            <span className="text-[13px] text-stone">{t("footer.shipsTo")}</span>
            <span className="text-[14.5px] font-medium text-ink">{t("footer.shipsToValue")}</span>
            <p className="text-[13px] leading-relaxed text-stone">{t("footer.deliveryNote")}</p>
          </div>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-[22px] gap-y-2 px-5 py-5 text-[12.5px] text-stone sm:px-8 lg:px-14">
          <span>{t("footer.copyright", { year, name: settings?.store?.name || "TAHOS." })}</span>
          <Link href="/privacy" className="hover:text-ink focus-ring">
            {t("footer.privacy")}
          </Link>
          <Link href="/terms" className="hover:text-ink focus-ring">
            {t("footer.terms")}
          </Link>
          <Link href="/accessibility" className="hover:text-ink focus-ring">
            {t("footer.accessibility")}
          </Link>
          <div className="flex-1" />
          <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
            {t("footer.priceNote")}
          </span>
        </div>
      </div>
    </footer>
  );
}
