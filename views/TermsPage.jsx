"use client";

import Link from "next/link";
import { FileText } from "lucide-react";

import { useLocale } from "../context/LocaleProvider.jsx";

export default function TermsPage() {
  const { t } = useLocale();

  return (
    <div className="container-x py-10">
      <div className="flex items-center gap-2.5">
        <FileText className="h-6 w-6 text-accent" />
        <h1 className="font-heading text-3xl font-black">{t("pages.termsTitle")}</h1>
      </div>
      <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">{t("pages.termsIntro")}</p>

      <div className="mt-8 space-y-8">
        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.termsAcceptHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">{t("pages.termsAcceptBody")}</p>
        </section>
        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.termsOrdersHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">{t("pages.termsOrdersBody")}</p>
        </section>
        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.termsPaymentHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">{t("pages.termsPaymentBody")}</p>
        </section>
        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.termsShippingHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">
            {t("pages.termsShippingBody")}{" "}
            <Link href="/shipping" className="text-accent hover:underline">
              {t("pages.termsShippingLink")}
            </Link>
            .
          </p>
        </section>
        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.termsAccountHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">{t("pages.termsAccountBody")}</p>
        </section>
        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.termsIpHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">{t("pages.termsIpBody")}</p>
        </section>
        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.termsLiabilityHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">{t("pages.termsLiabilityBody")}</p>
        </section>
        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.termsLawHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">{t("pages.termsLawBody")}</p>
        </section>
        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.termsChangesHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">{t("pages.termsChangesBody")}</p>
        </section>
        <section>
          <h2 className="font-heading text-lg font-bold">{t("pages.termsContactHeading")}</h2>
          <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">
            {t("pages.termsContactBody")}{" "}
            <Link href="/contact" className="text-accent hover:underline">
              {t("pages.termsContactLink")}
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
