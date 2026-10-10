"use client";

// The shop's four promises as one strip — free delivery, easy returns, secure payment, customer support. Every figure is the shop's own
// setting (the free-delivery threshold, the exchange window); nothing here is invented. Used on the home page.
import Link from "next/link";
import { Headset, Lock, ShieldCheck, Truck } from "lucide-react";

import { useLocale } from "../../context/LocaleProvider.jsx";
import { useSettings } from "../../context/SettingsContext.jsx";
import { cn } from "../../lib/utils.js";

export default function ServiceStrip({ className }) {
  const { t } = useLocale();
  const settings = useSettings();
  const freeShipAmount = settings.freeShippingPitch();
  const exchangeDays = settings.exchangePolicy?.windowDays;

  return (
    <div className={cn("grid grid-cols-2 gap-y-5 rounded-2xl border border-line bg-surface px-4 py-5 shadow-card sm:px-6 lg:grid-cols-4 lg:divide-x lg:divide-line", className)}>
      <Item icon={Truck} title={t("product.freeDelivery")} desc={freeShipAmount ? t("product.freeShippingOver", { amount: freeShipAmount }) : t("product.onQualifyingOrders")} />
      <Item icon={ShieldCheck} title={t("product.easyReturns")} desc={exchangeDays ? t("product.exchangePolicyDays", { days: exchangeDays }) : t("product.exchanges14Day")} />
      <Item icon={Lock} title={t("product.securePayment")} desc={t("checkout.cashOnDelivery")} />
      <Item icon={Headset} title={t("product.customerSupport")} desc={t("product.supportDesc")} href="/contact" />
    </div>
  );
}

function Item({ icon: Icon, title, desc, href }) {
  const body = (
    <div className="flex items-center gap-3 lg:px-6 lg:first:pl-0">
      <Icon className="h-8 w-8 flex-none text-ink" strokeWidth={1.4} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[14px] font-bold text-ink">{title}</p>
        <p className="text-[12.5px] text-stone">{desc}</p>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block focus-ring">
      {body}
    </Link>
  ) : (
    body
  );
}
