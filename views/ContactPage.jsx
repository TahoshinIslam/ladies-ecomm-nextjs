"use client";

import Link from "next/link";
import { HelpCircle, Mail, MessageCircleQuestion, Package, Phone } from "lucide-react";

import { useLocale } from "../context/LocaleProvider.jsx";
import { useSettings } from "../context/SettingsContext.jsx";

// EShopper's contact page pairs a large "get in touch" panel with a
// secondary column of quick links. This storefront has no backend to
// receive a contact-form submission (no ticket/message model or API
// route), so rather than wiring up a form that goes nowhere, the primary
// column is real: mailto/tel channels the admin has actually configured
// (Shop Config → Settings), each a real, clickable action. The secondary
// column links to the two real self-serve paths (FAQ, Orders) instead of
// a second copy of the same channels.
export default function ContactPage() {
  const { t } = useLocale();
  const settings = useSettings();
  const email = settings?.store?.supportEmail;
  const phone = settings?.store?.supportPhone;
  const hasChannel = Boolean(email || phone);

  return (
    <div className="container-x py-14">
      <div className="border-b border-line pb-8 text-center">
        <div className="eyebrow justify-center">{t("pages.contactTitle")}</div>
        <h1 className="mt-3.5 font-heading text-[clamp(32px,3.4vw,44px)] font-bold tracking-[-0.02em]">
          {t("pages.contactTitle")}
        </h1>
        <p className="mx-auto mt-3 max-w-[60ch] text-[15.5px] leading-relaxed text-stone">
          {t("pages.contactIntro")}
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-line p-8">
          <h2 className="text-lg font-semibold">{t("pages.contactGetInTouch")}</h2>

          {hasChannel ? (
            <div className="mt-6 space-y-4">
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="flex items-center gap-4 rounded-xl border border-line p-4 transition-colors hover:border-ink focus-ring"
                >
                  <span className="grid h-11 w-11 flex-none place-items-center rounded-lg bg-media text-verm">
                    <Mail className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="eyebrow">{t("pages.contactEmailLabel")}</p>
                    <p className="mt-0.5 text-[15px] font-semibold">{email}</p>
                  </div>
                </a>
              )}
              {phone && (
                <a
                  href={`tel:${phone}`}
                  className="flex items-center gap-4 rounded-xl border border-line p-4 transition-colors hover:border-ink focus-ring"
                >
                  <span className="grid h-11 w-11 flex-none place-items-center rounded-lg bg-media text-verm">
                    <Phone className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="eyebrow">{t("pages.contactPhoneLabel")}</p>
                    <p className="mt-0.5 text-[15px] font-semibold">{phone}</p>
                  </div>
                </a>
              )}
              <p className="text-[13.5px] text-stone">{t("pages.contactHours")}</p>
            </div>
          ) : (
            <p className="mt-6 max-w-[60ch] text-[14.5px] leading-relaxed text-stone">
              {t("pages.contactNoChannelsYet")}{" "}
              <Link href="/orders" className="font-semibold text-verm hover:underline">
                {t("pages.contactNoChannelsLink")}
              </Link>
              .
            </p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Link
            href="/faq"
            className="flex items-center gap-4 rounded-xl border border-line p-5 transition-colors hover:border-ink focus-ring"
          >
            <MessageCircleQuestion className="h-5 w-5 flex-none text-verm" />
            <div>
              <p className="text-[15px] font-semibold">{t("pages.contactFaqLink")}</p>
              <p className="mt-0.5 text-[13px] text-stone">{t("pages.contactFaqPrompt")}</p>
            </div>
          </Link>
          <Link
            href="/orders"
            className="flex items-center gap-4 rounded-xl border border-line p-5 transition-colors hover:border-ink focus-ring"
          >
            <Package className="h-5 w-5 flex-none text-verm" />
            <div>
              <p className="text-[15px] font-semibold">{t("pages.contactOrdersTitle")}</p>
              <p className="mt-0.5 text-[13px] text-stone">{t("pages.contactOrdersHint")}</p>
            </div>
          </Link>
          <div className="flex items-start gap-4 rounded-xl bg-media p-5">
            <HelpCircle className="h-5 w-5 flex-none text-stone" />
            <p className="text-[13.5px] leading-relaxed text-stone">{t("pages.contactHours")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
