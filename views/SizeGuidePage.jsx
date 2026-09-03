"use client";

import Link from "next/link";
import { Ruler } from "lucide-react";

import { useLocale } from "../context/LocaleProvider.jsx";

const GARMENT_SIZES = [
  { sizeKey: "catalog.sizeS", bust: "34–36 in", waist: "27–29 in" },
  { sizeKey: "catalog.sizeM", bust: "37–39 in", waist: "30–32 in" },
  { sizeKey: "catalog.sizeL", bust: "40–42 in", waist: "33–35 in" },
  { sizeKey: "catalog.sizeXl", bust: "43–45 in", waist: "36–38 in" },
  { sizeKey: "catalog.sizeXxl", bust: "46–48 in", waist: "39–41 in" },
  { sizeKey: "catalog.size3xl", bust: "49–51 in", waist: "42–44 in" },
];

const LENGTH_GUIDE = [
  { labelKey: "catalog.sizeShort", height: "Under 5'2\"" },
  { labelKey: "catalog.sizeRegular", height: "5'2\" – 5'6\"" },
  { labelKey: "catalog.sizeLong", height: "5'6\" – 5'10\"" },
  { labelKey: "catalog.sizeMaxi", height: "5'10\" and above" },
];

export default function SizeGuidePage() {
  const { t } = useLocale();
  return (
    <div className="container-x py-10">
      <div className="flex items-center gap-2.5">
        <Ruler className="h-6 w-6 text-accent" />
        <h1 className="font-heading text-3xl font-black">{t("sizeGuide.title")}</h1>
      </div>
      <p className="mt-2 max-w-[60ch] text-sm text-muted-foreground">
        {t("sizeGuide.intro")}
      </p>

      <section className="mt-8">
        <h2 className="font-heading text-xl font-bold">{t("sizeGuide.garmentSizesTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("sizeGuide.garmentSizesSub")}
        </p>
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-3 text-left">{t("sizeGuide.colSize")}</th>
                <th className="p-3 text-left">{t("sizeGuide.colBust")}</th>
                <th className="p-3 text-left">{t("sizeGuide.colWaist")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {GARMENT_SIZES.map((row) => (
                <tr key={row.sizeKey}>
                  <td className="p-3 font-semibold">{t(row.sizeKey)}</td>
                  <td className="p-3 text-muted-foreground">{row.bust}</td>
                  <td className="p-3 text-muted-foreground">{row.waist}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-heading text-xl font-bold">{t("sizeGuide.lengthGuideTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("sizeGuide.lengthGuideSub")}
        </p>
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[360px] text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-3 text-left">{t("sizeGuide.colLength")}</th>
                <th className="p-3 text-left">{t("sizeGuide.colHeight")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {LENGTH_GUIDE.map((row) => (
                <tr key={row.labelKey}>
                  <td className="p-3 font-semibold">{t(row.labelKey)}</td>
                  <td className="p-3 text-muted-foreground">{row.height}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-heading text-xl font-bold">{t("sizeGuide.freeSizeTitle")}</h2>
        <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">
          {t("sizeGuide.freeSizeBody")}
        </p>
      </section>

      <p className="mt-10 text-sm text-muted-foreground">
        {t("sizeGuide.stillUnsure")}{" "}
        <Link href="/shop" className="text-accent hover:underline">
          {t("sizeGuide.browseShop")}
        </Link>
        {t("sizeGuide.browseShopSuffix")}
      </p>
    </div>
  );
}
