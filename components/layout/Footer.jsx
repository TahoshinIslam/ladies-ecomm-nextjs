"use client";

import Link from "next/link";
import { Mail, Phone } from "lucide-react";

import Wordmark from "../brand/Wordmark.jsx";
import NewsletterForm from "./NewsletterForm.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { departmentName } from "../../lib/i18n/catalog.js";
import { useGetCategoriesQuery } from "../../store/shopApi.js";

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
];

/**
 * EShopper-structured footer: a brand blurb + real contact details, two
 * "Quick Links" columns (Shop/Help — same real routes the previous footer
 * used), a newsletter column (shared NewsletterForm), and a bottom bar. The
 * old white "service strip" (COD/exchange/fabric/coverage) now lives on the
 * home page itself (views/HomePage.jsx's features row) — EShopper's own
 * footer carries no such strip, and repeating it on every page added no
 * value beyond the home page.
 */
export default function Footer({ initialDepartments = [] }) {
  const settings = useSettings();
  const { t, locale } = useLocale();
  const year = new Date().getFullYear();
  const { data: catsData } = useGetCategoriesQuery();
  const departments = (catsData?.categories ?? initialDepartments).filter((c) => !c.parent);
  const shopName = settings?.store?.name || "TAHOS.";

  const shopColumn = {
    heading: t("footer.shop"),
    links: [
      { label: t("header.newArrivals"), href: "/shop?collection=new" },
      ...departments
        .slice(0, 5)
        .map((d) => ({ label: departmentName(locale, d.slug, d.name), href: `/shop?category=${d._id}` })),
    ],
  };
  const helpColumn = {
    heading: t(STATIC_COLUMN_KEYS[0].headingKey),
    links: STATIC_COLUMN_KEYS[0].links.map((l) => ({ label: t(l.labelKey), href: l.href })),
  };

  return (
    <footer className="mt-32 bg-verm text-accent-foreground">
      <div className="container-x grid grid-cols-2 gap-x-6 gap-y-10 py-16 lg:grid-cols-[1.4fr_1fr_1fr_1.3fr] lg:gap-12">
        <div className="col-span-2 lg:col-span-1">
          <Link href="/" aria-label={shopName}>
            <Wordmark name={shopName} onAccent className="text-[22px]" />
          </Link>
          <p className="mt-3.5 max-w-[30ch] text-[14.5px] leading-relaxed text-accent-foreground/80">
            {t("footer.tagline")}
          </p>
          {(settings?.store?.supportEmail || settings?.store?.supportPhone) && (
            <div className="mt-4 flex flex-col gap-2 text-[14px] text-accent-foreground/85">
              {settings.store.supportEmail && (
                <a
                  href={`mailto:${settings.store.supportEmail}`}
                  className="flex w-fit items-center gap-2 hover:text-accent-foreground"
                >
                  <Mail className="h-4 w-4 flex-none" strokeWidth={1.8} />
                  {settings.store.supportEmail}
                </a>
              )}
              {settings.store.supportPhone && (
                <a
                  href={`tel:${settings.store.supportPhone}`}
                  className="flex w-fit items-center gap-2 hover:text-accent-foreground"
                >
                  <Phone className="h-4 w-4 flex-none" strokeWidth={1.8} />
                  {settings.store.supportPhone}
                </a>
              )}
            </div>
          )}
        </div>

        <div>
          <h2 className="eyebrow text-accent-foreground/70">{shopColumn.heading}</h2>
          <div className="mt-4 flex flex-col gap-2.5 text-[14.5px]">
            {shopColumn.links.map((l) => (
              <Link key={l.label} href={l.href} className="w-fit text-accent-foreground/85 transition-colors hover:text-accent-foreground">
                {l.label}
              </Link>
            ))}
          </div>
        </div>

        <div>
          <h2 className="eyebrow text-accent-foreground/70">{helpColumn.heading}</h2>
          <div className="mt-4 flex flex-col gap-2.5 text-[14.5px]">
            {helpColumn.links.map((l) => (
              <Link key={l.label} href={l.href} className="w-fit text-accent-foreground/85 transition-colors hover:text-accent-foreground">
                {l.label}
              </Link>
            ))}
          </div>
        </div>

        <div>
          <h2 className="eyebrow text-accent-foreground/70">{t("footer.newsletterHeading")}</h2>
          <div className="mt-4">
            <NewsletterForm theme="dark" />
          </div>
        </div>
      </div>

      <div className="border-t border-[rgba(250,250,247,0.15)]">
        <div className="container-x flex flex-wrap items-center gap-x-5 gap-y-2 py-5 text-[12.5px] text-accent-foreground/70">
          <span>{t("footer.copyright", { year, name: shopName })}</span>
          <Link href="/privacy" className="hover:text-accent-foreground">
            {t("footer.privacy")}
          </Link>
          <Link href="/terms" className="hover:text-accent-foreground">
            {t("footer.terms")}
          </Link>
          <Link href="/accessibility" className="hover:text-accent-foreground">
            {t("footer.accessibility")}
          </Link>
          <div className="flex-1" />
          <span>{t("footer.priceNote")}</span>
        </div>
      </div>
    </footer>
  );
}
