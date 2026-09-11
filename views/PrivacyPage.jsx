"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { useLocale } from "../context/LocaleProvider.jsx";

const SECTIONS = [
  ["privacyCollectHeading", "privacyCollectBody"],
  ["privacyUseHeading", "privacyUseBody"],
  ["privacyCookiesHeading", "privacyCookiesBody"],
  ["privacySharingHeading", "privacySharingBody"],
  ["privacySecurityHeading", "privacySecurityBody"],
  ["privacyRightsHeading", "privacyRightsBody"],
  ["privacyChangesHeading", "privacyChangesBody"],
];

export default function PrivacyPage() {
  const { t } = useLocale();

  return (
    <div className="container-x py-10">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="h-6 w-6 text-accent" />
        <h1 className="font-heading text-3xl font-black">{t("pages.privacyTitle")}</h1>
      </div>
      <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">{t("pages.privacyIntro")}</p>

      <div className="mt-8 space-y-8">
        {SECTIONS.map(([headingKey, bodyKey]) => (
          <section key={headingKey}>
            <h2 className="font-heading text-lg font-bold">{t(`pages.${headingKey}`)}</h2>
            <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">{t(`pages.${bodyKey}`)}</p>
          </section>
        ))}

        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.privacyContactHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">
            {t("pages.privacyContactBody")}{" "}
            <Link href="/contact" className="text-accent hover:underline">
              {t("pages.privacyContactLink")}
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
