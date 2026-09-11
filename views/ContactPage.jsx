"use client";

import Link from "next/link";
import { Mail, Phone } from "lucide-react";

import { useLocale } from "../context/LocaleProvider.jsx";
import { useSettings } from "../context/SettingsContext.jsx";

export default function ContactPage() {
  const { t } = useLocale();
  const settings = useSettings();
  const email = settings?.store?.supportEmail;
  const phone = settings?.store?.supportPhone;
  const hasChannel = Boolean(email || phone);

  return (
    <div className="container-x py-10">
      <div className="flex items-center gap-2.5">
        <Mail className="h-6 w-6 text-accent" />
        <h1 className="font-heading text-3xl font-black">{t("pages.contactTitle")}</h1>
      </div>
      <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">{t("pages.contactIntro")}</p>

      {hasChannel ? (
        <div className="mt-8 space-y-4">
          {email && (
            <div className="flex items-center gap-3 rounded-lg border border-border p-4">
              <Mail className="h-5 w-5 flex-none text-accent" />
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t("pages.contactEmailLabel")}
                </p>
                <a href={`mailto:${email}`} className="text-sm font-semibold hover:underline">
                  {email}
                </a>
              </div>
            </div>
          )}
          {phone && (
            <div className="flex items-center gap-3 rounded-lg border border-border p-4">
              <Phone className="h-5 w-5 flex-none text-accent" />
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t("pages.contactPhoneLabel")}
                </p>
                <a href={`tel:${phone}`} className="text-sm font-semibold hover:underline">
                  {phone}
                </a>
              </div>
            </div>
          )}
          <p className="text-sm text-muted-foreground">{t("pages.contactHours")}</p>
        </div>
      ) : (
        <p className="mt-8 max-w-[65ch] text-sm text-muted-foreground">
          {t("pages.contactNoChannelsYet")}{" "}
          <Link href="/orders" className="text-accent hover:underline">
            {t("pages.contactNoChannelsLink")}
          </Link>
          .
        </p>
      )}

      <p className="mt-8 text-sm text-muted-foreground">
        {t("pages.contactFaqPrompt")}{" "}
        <Link href="/faq" className="text-accent hover:underline">
          {t("pages.contactFaqLink")}
        </Link>
        .
      </p>
    </div>
  );
}
