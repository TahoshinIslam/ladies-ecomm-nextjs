"use client";

import Link from "next/link";
import { HelpCircle } from "lucide-react";

import { useLocale } from "../context/LocaleProvider.jsx";

const QA_KEYS = [1, 2, 3, 4, 5, 6, 7];

export default function FaqPage() {
  const { t } = useLocale();

  return (
    <div className="container-x py-10">
      <div className="flex items-center gap-2.5">
        <HelpCircle className="h-6 w-6 text-accent" />
        <h1 className="font-heading text-3xl font-black">{t("pages.faqTitle")}</h1>
      </div>
      <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">{t("pages.faqIntro")}</p>

      <div className="mt-8 divide-y divide-border rounded-lg border border-border">
        {QA_KEYS.map((n) => (
          <details key={n} className="group p-4">
            <summary className="cursor-pointer list-none font-heading text-base font-semibold marker:content-none">
              <span className="flex items-center justify-between gap-3">
                {t(`pages.faqQ${n}`)}
                <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-45">
                  +
                </span>
              </span>
            </summary>
            <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">{t(`pages.faqA${n}`)}</p>
          </details>
        ))}
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        {t("pages.faqStillHaveQuestions")}{" "}
        <Link href="/contact" className="text-accent hover:underline">
          {t("pages.faqContactLink")}
        </Link>
      </p>
    </div>
  );
}
