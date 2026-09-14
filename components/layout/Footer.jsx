"use client";

import { useState } from "react";
import Link from "next/link";
import { Banknote, Gem, RefreshCw, Sparkles } from "lucide-react";

import Wordmark from "../brand/Wordmark.jsx";
import Button from "../ui/Button.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { departmentName } from "../../lib/i18n/catalog.js";
import { useGetCategoriesQuery } from "../../store/shopApi.js";
import { cn } from "../../lib/utils.js";

// Leo's footer sits under a white "service strip" of real differentiators
// (shipping/returns/security/support) — this app's equivalent content
// (COD, exchanges, fabric quality, modest coverage) previously lived only
// in a homepage-only, desktop-only "Trust" section. Moved here so it
// appears on every page, matching Leo's own composition, and so the
// homepage doesn't repeat it.
const SERVICE_STRIP = [
  { icon: Banknote, titleKey: "home.trustCod", bodyKey: "home.trustCodBody" },
  { icon: RefreshCw, titleKey: "home.trustExchange", bodyKey: "home.trustExchangeBody" },
  { icon: Gem, titleKey: "home.trustFabric", bodyKey: "home.trustFabricBody" },
  { icon: Sparkles, titleKey: "home.trustCoverage", bodyKey: "home.trustCoverageBody" },
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
];

/** Compact inline form — Leo's footer newsletter capture, not a full-page block. */
function FooterNewsletterForm() {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | invalid | loading | success

  const submit = (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setState("invalid");
      return;
    }
    setState("loading");
    setTimeout(() => setState("success"), 500);
  };

  const note = {
    idle: t("home.newsletterNoteIdle"),
    invalid: t("home.newsletterNoteInvalid"),
    loading: t("home.newsletterNoteLoading"),
    success: t("home.newsletterNoteSuccess"),
  }[state];

  return (
    <form onSubmit={submit}>
      <div className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "invalid") setState("idle");
          }}
          aria-label={t("home.emailAddress")}
          aria-invalid={state === "invalid"}
          placeholder={t("home.emailPlaceholder")}
          className={cn(
            "h-11 min-w-0 flex-1 rounded-lg border bg-[rgba(250,250,247,0.08)] px-3.5 text-[14px] text-accent-foreground placeholder:text-accent-foreground/50 focus-ring",
            state === "invalid" ? "border-danger" : "border-[rgba(250,250,247,0.25)]",
          )}
        />
        <Button type="submit" variant="promo" disabled={state === "loading"}>
          {state === "success" ? t("home.subscribed") : t("home.signUp")}
        </Button>
      </div>
      <p className="mt-2.5 text-[12.5px] leading-[1.5] text-accent-foreground/70">{note}</p>
    </form>
  );
}

export default function Footer({ initialDepartments = [] }) {
  const settings = useSettings();
  const { t, locale } = useLocale();
  const year = new Date().getFullYear();
  const { data: catsData } = useGetCategoriesQuery();
  const departments = (catsData?.categories ?? initialDepartments).filter((c) => !c.parent);

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
    <footer className="mt-32">
      {/* Service strip — white surface, above the dark footer block */}
      <div className="border-y border-line bg-surface">
        <div className="container-x grid gap-6 py-8 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICE_STRIP.map((item) => (
            <div key={item.titleKey} className="flex items-start gap-3">
              <item.icon className="h-[22px] w-[22px] flex-none text-verm" strokeWidth={1.6} aria-hidden="true" />
              <div>
                <div className="text-[14.5px] font-semibold">{t(item.titleKey)}</div>
                <div className="mt-0.5 text-[13px] text-stone">{t(item.bodyKey)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main footer — solid forest-green, matching Leo's leo-container
          block exactly (wordmark + tagline, Shop, Help, newsletter). */}
      <div className="bg-verm text-accent-foreground">
        <div className="container-x grid grid-cols-2 gap-x-6 gap-y-10 py-16 lg:grid-cols-[1.4fr_1fr_1fr_1.3fr] lg:gap-12">
          <div className="col-span-2 lg:col-span-1">
            <Link href="/" aria-label={settings?.store?.name || "TAHOS."}>
              <Wordmark
                name={settings?.store?.name || "TAHOS."}
                onAccent
                className="text-[22px]"
              />
            </Link>
            <p className="mt-3.5 max-w-[30ch] text-[14.5px] leading-relaxed text-accent-foreground/80">
              {t("footer.tagline")}
            </p>
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
              <FooterNewsletterForm />
            </div>
          </div>
        </div>

        <div className="border-t border-[rgba(250,250,247,0.15)]">
          <div className="container-x flex flex-wrap items-center gap-x-5 gap-y-2 py-5 text-[12.5px] text-accent-foreground/70">
            <span>{t("footer.copyright", { year, name: settings?.store?.name || "TAHOS." })}</span>
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
      </div>
    </footer>
  );
}
