"use client";

import Link from "next/link";
import { BookOpen } from "lucide-react";

import { useLocale } from "../context/LocaleProvider.jsx";
import Button from "../components/ui/Button.jsx";

export default function JournalPage() {
  const { t } = useLocale();

  return (
    <div className="container-x py-16 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-border">
        <BookOpen className="h-6 w-6 text-accent" />
      </div>
      <p className="mt-5 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {t("pages.journalSubtitle")}
      </p>
      <h1 className="mt-2 font-serif text-4xl italic">{t("pages.journalTitle")}</h1>
      <p className="mt-3 font-mono text-xs uppercase tracking-[0.1em] text-accent">
        {t("pages.journalComingSoon")}
      </p>
      <p className="mx-auto mt-5 max-w-[55ch] text-sm text-muted-foreground">{t("pages.journalBody")}</p>
      <div className="mt-7">
        <Link href="/shop">
          <Button variant="outline">{t("pages.journalCta")}</Button>
        </Link>
      </div>
    </div>
  );
}
