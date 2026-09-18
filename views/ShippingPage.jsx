import Link from "next/link";
import { Truck } from "lucide-react";

import { getT, getServerLocale } from "../lib/i18n/server.js";
import { getCachedPublicSettings } from "../lib/serverDataCache.js";
import { formatBdt } from "../lib/currency.js";

// Converted from a Client Component: this page's only client-side need
// was useLocale()'s t() and useSettings()'s already-BDT shippingZones/
// formatBdt() — both have direct server-side equivalents (getT(),
// getCachedPublicSettings(), lib/currency.js's pure formatBdt()), and this
// page has no interactivity (no client state, no event handlers), so
// there's no reason to ship its JS to the browser at all. Matches
// views/HomePage.jsx's existing server-side i18n pattern.
export default async function ShippingPage() {
  const [t, settings, locale] = await Promise.all([getT(), getCachedPublicSettings(), getServerLocale()]);

  // Storefront is BD-shipping-only (see SettingsContext.jsx's own
  // freeShippingThreshold() comment) — only the BDT/BD zone's tiers are
  // ever shown to a shopper, same assumption the checkout math already makes.
  const bdZone = (settings.shippingZones || []).find((z) => z.currency === "BDT");
  const tiers = bdZone?.tiers || [];

  return (
    <div className="container-x py-10">
      <div className="flex items-center gap-2.5">
        <Truck className="h-6 w-6 text-accent" />
        <h1 className="font-heading text-3xl font-black">{t("pages.shippingTitle")}</h1>
      </div>
      <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">{t("pages.shippingIntro")}</p>

      <section className="mt-8">
        <h2 className="font-heading text-xl font-bold">{t("pages.shippingDeliveryHeading")}</h2>
        <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">{t("pages.shippingDeliveryBody")}</p>
        {tiers.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">{t("pages.shippingZoneCol")}</th>
                  <th className="p-3 text-left">{t("pages.shippingCostCol")}</th>
                  <th className="p-3 text-left">{t("pages.shippingFreeAboveCol")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tiers.map((tier) => (
                  <tr key={tier.name}>
                    <td className="p-3 font-semibold">{tier.name}</td>
                    <td className="p-3 text-muted-foreground">{formatBdt(tier.baseCost, locale)}</td>
                    <td className="p-3 text-muted-foreground">
                      {tier.freeAbove > 0 ? formatBdt(tier.freeAbove, locale) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-heading text-xl font-bold">{t("pages.shippingTimeHeading")}</h2>
        <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
          {t("pages.shippingTimeBody")}{" "}
          <Link href="/orders" className="text-accent hover:underline">
            {t("pages.shippingTimeLink")}
          </Link>
          .
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-heading text-xl font-bold">{t("pages.shippingPaymentHeading")}</h2>
        <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">{t("pages.shippingPaymentBody")}</p>
      </section>

      <section className="mt-10">
        <h2 className="font-heading text-xl font-bold">{t("pages.shippingReturnsHeading")}</h2>
        <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">{t("pages.shippingReturnsBody")}</p>
        <p className="mt-3">
          <Link href="/contact" className="text-accent hover:underline">
            {t("pages.shippingReturnsCta")}
          </Link>
        </p>
        <p className="mt-3 max-w-[65ch] text-xs text-muted-foreground">{t("pages.shippingReturnsNote")}</p>
      </section>
    </div>
  );
}
