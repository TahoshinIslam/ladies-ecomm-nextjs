"use client";

import Link from "next/link";
import { Accessibility } from "lucide-react";

import { useLocale } from "../context/LocaleProvider.jsx";

export default function AccessibilityPage() {
  const { t } = useLocale();

  return (
    <div className="container-x py-10">
      <div className="flex items-center gap-2.5">
        <Accessibility className="h-6 w-6 text-accent" />
        <h1 className="font-heading text-3xl font-black">{t("pages.accessibilityTitle")}</h1>
      </div>
      <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">{t("pages.accessibilityIntro")}</p>

      <div className="mt-8 space-y-8">
        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.accessibilityEffortsHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">
            {t("pages.accessibilityEffortsBody")}
          </p>
        </section>
        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.accessibilityOngoingHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">
            {t("pages.accessibilityOngoingBody")}
          </p>
        </section>
        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.accessibilityFeedbackHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">
            {t("pages.accessibilityFeedbackBody")}
          </p>
          <p className="mt-3">
            <Link href="/contact" className="text-accent hover:underline">
              {t("pages.accessibilityFeedbackLink")}
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
