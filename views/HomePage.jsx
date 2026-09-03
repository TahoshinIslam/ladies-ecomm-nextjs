"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDispatch } from "react-redux";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Banknote, RefreshCw, Sparkles, Gem, Percent, Shirt, AlertCircle } from "lucide-react";

import ProductCard from "../components/product/ProductCard.jsx";
import ProductCardSkeleton from "../components/product/ProductCardSkeleton.jsx";
import Button from "../components/ui/Button.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Skeleton from "../components/ui/Skeleton.jsx";
import { useGetProductsQuery } from "../store/productApi.js";
import { useGetCategoriesQuery } from "../store/shopApi.js";
import { setFinderOpen } from "../store/uiSlice.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { useLocale } from "../context/LocaleProvider.jsx";
import { departmentName } from "../lib/i18n/catalog.js";
import { cn, resolveImage } from "../lib/utils.js";

/**
 * Editorial content is authored here rather than fetched — it is the store's
 * voice, not catalogue data. Product rows come from the API only — no
 * fallback to placeholder items; a section with no real products yet simply
 * doesn't render, rather than showing something invented. `name` here is
 * the real department name from the DB (see departments.find below); the
 * body/tagline copy is a translation key, resolved via t() in the
 * component — everything in these arrays that isn't a stable value
 * (slug/href) is a *Key, never literal text.
 */
const DEPARTMENT_ROTATION_SLUGS = ["burqa", "abaya", "hijab"];

const TRUST = [
  { icon: Banknote, titleKey: "home.trustCod", bodyKey: "home.trustCodBody" },
  { icon: RefreshCw, titleKey: "home.trustExchange", bodyKey: "home.trustExchangeBody" },
  { icon: Gem, titleKey: "home.trustFabric", bodyKey: "home.trustFabricBody" },
  { icon: Sparkles, titleKey: "home.trustCoverage", bodyKey: "home.trustCoverageBody" },
];

const DEPARTMENT_COPY = {
  burqa: { num: "01", bodyKey: "catalog.deptBurqaBody", tone: "media", span: "tall" },
  abaya: { num: "02", bodyKey: "catalog.deptAbayaBody", tone: "media", span: "wide" },
  hijab: { num: "03", bodyKey: "catalog.deptHijabBody", tone: "coral" },
  niqab: { num: "04", bodyKey: "catalog.deptNiqabBody", tone: "night" },
  khimar: { num: "05", bodyKey: "catalog.deptKhimarBody", tone: "media" },
  "modest-sets": { num: "06", bodyKey: "catalog.deptModestSetsBody", tone: "coral" },
};

const FABRICS = [
  { nameKey: "catalog.fabricNida", value: "nida", bodyKey: "home.fabricNidaBody" },
  { nameKey: "catalog.fabricCrepe", value: "crepe", bodyKey: "home.fabricCrepeBody" },
  { nameKey: "catalog.fabricChiffon", value: "chiffon", bodyKey: "home.fabricChiffonBody" },
  { nameKey: "catalog.fabricJersey", value: "jersey", bodyKey: "home.fabricJerseyBody" },
  { nameKey: "catalog.fabricGeorgette", value: "georgette", bodyKey: "home.fabricGeorgetteBody" },
];

const OCCASIONS = [
  { nameKey: "catalog.occasionEid", value: "eid", bodyKey: "home.occasionEidBody" },
  { nameKey: "home.dailyWear", value: "everyday", bodyKey: "home.occasionEverydayBody" },
  { nameKey: "home.wedding", value: "bridal", bodyKey: "home.occasionBridalBody" },
  { nameKey: "catalog.occasionPrayer", value: "prayer", bodyKey: "home.occasionPrayerBody" },
];

export default function HomePage() {
  const settings = useSettings();
  const { t, locale } = useLocale();
  const dispatch = useDispatch();
  const [hero, setHero] = useState(0);

  const { data: catsData } = useGetCategoriesQuery();
  const departments = (catsData?.categories ?? []).filter((c) => !c.parent);

  const { data: arrivalsData, isLoading: arrivalsLoading } = useGetProductsQuery({
    limit: 8,
    sort: "-createdAt",
  });
  const arrivals = arrivalsData?.products ?? [];

  // One real product image per rotating hero department (burqa/abaya/hijab)
  // — fetched explicitly, not just hoped-for inside `arrivals`, so the hero
  // still has a real photo once the catalog outgrows arrivals' limit. Three
  // named calls, not a loop over DEPARTMENT_ROTATION_SLUGS: hooks can't be
  // called from inside a .map() callback (rules-of-hooks). All three fire
  // unconditionally on mount, same pattern as ProductTabsSection below, so
  // switching slides is instant instead of a fresh loading state per click.
  // Same map also backs the "Shop by Department" tiles below for burqa/
  // abaya/khimar (the three tiles whose editorial tone is "media", i.e.
  // meant to show a photo rather than a flat brand color — see
  // DEPARTMENT_COPY) — one shared source of truth instead of fetching the
  // same product twice.
  const burqaDeptId = departments.find((d) => d.slug === "burqa")?._id;
  const abayaDeptId = departments.find((d) => d.slug === "abaya")?._id;
  const hijabDeptId = departments.find((d) => d.slug === "hijab")?._id;
  const khimarDeptId = departments.find((d) => d.slug === "khimar")?._id;
  const heroBurqaQ = useGetProductsQuery({ limit: 1, category: burqaDeptId, sort: "-rating" }, { skip: !burqaDeptId });
  const heroAbayaQ = useGetProductsQuery({ limit: 1, category: abayaDeptId, sort: "-rating" }, { skip: !abayaDeptId });
  const heroHijabQ = useGetProductsQuery({ limit: 1, category: hijabDeptId, sort: "-rating" }, { skip: !hijabDeptId });
  const heroKhimarQ = useGetProductsQuery({ limit: 1, category: khimarDeptId, sort: "-rating" }, { skip: !khimarDeptId });
  const heroImageBySlug = {
    burqa: heroBurqaQ.data?.products?.[0]?.images?.[0],
    abaya: heroAbayaQ.data?.products?.[0]?.images?.[0],
    hijab: heroHijabQ.data?.products?.[0]?.images?.[0],
    khimar: heroKhimarQ.data?.products?.[0]?.images?.[0],
  };
  // Skipped while `departments` hasn't resolved yet (dept ids still
  // unknown), so `isLoading` alone would stay false through that window —
  // fold `!catsData` in too so the skeleton covers the whole gap between
  // "nothing fetched yet" and "this slug's photo actually arrived".
  const catsLoading = !catsData;
  const heroLoadingBySlug = {
    burqa: catsLoading || heroBurqaQ.isLoading,
    abaya: catsLoading || heroAbayaQ.isLoading,
    hijab: catsLoading || heroHijabQ.isLoading,
    khimar: catsLoading || heroKhimarQ.isLoading,
  };

  // Department name goes through departmentName() (lib/i18n/catalog.js) —
  // the DB only ever stores it in English, so this overlays the Bangla
  // translation for the six known departments and falls back to the DB's
  // own name (or the raw slug, in the impossible case categories haven't
  // loaded yet) — paired with this file's own editorial tagline copy,
  // translated via t().
  const heroSlug = DEPARTMENT_ROTATION_SLUGS[hero];
  const heroDept = departments.find((d) => d.slug === heroSlug);
  const heroImage = heroImageBySlug[heroSlug] || null;
  const slide = {
    name: departmentName(locale, heroSlug, heroDept?.name),
    tagline: t(DEPARTMENT_COPY[heroSlug]?.bodyKey || "common.loading"),
    image: heroImage,
    loading: heroLoadingBySlug[heroSlug],
  };

  // Auto-advance the hero, but never while the user prefers reduced motion.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(
      () => setHero((i) => (i + 1) % DEPARTMENT_ROTATION_SLUGS.length),
      6000,
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {/* ------------------------------------------------------ Mobile hero
          (<768px only — see MobileHero below). */}
      <MobileHero slide={slide} dispatch={dispatch} />

      {/* ----------------------------------------------------- Tablet hero
          (768–1023px only — see TabletHero below). Desktop hero (1024px+)
          is untouched below this. */}
      <TabletHero slide={slide} dispatch={dispatch} />

      {/* ------------------------------------------------------------ Hero */}
      <section
        aria-labelledby="hero-h"
        className="relative hidden overflow-hidden lg:block"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-[8%] right-[-4%] select-none text-[min(30vw,420px)] font-bold leading-[0.8] tracking-[-0.06em] text-ink opacity-[0.045]"
        >
          TAHOS
        </div>

        <div className="container-x grid min-h-[calc(86vh-130px)] items-center gap-8 pb-24 pt-16 lg:grid-cols-12">
          <div className="relative z-[2] lg:col-span-5">
            <div className="flex items-center gap-3 font-mono text-[11.5px] uppercase tracking-[0.16em] text-stone">
              <span className="h-px w-[22px] bg-verm" />
              {t("home.heroEyebrow")}
            </div>
            <h1
              id="hero-h"
              className="mt-5 text-[clamp(56px,6.4vw,98px)] font-semibold leading-[0.9] tracking-[-0.045em] text-balance"
            >
              {t("home.heroTitle")}{" "}
              <span className="font-serif font-normal italic tracking-[-0.01em]">
                {t("home.heroTitleAccent")}
              </span>
            </h1>
            <p className="mt-6 max-w-[42ch] text-xl leading-[1.5] text-stone text-pretty">
              {t("home.heroSubtitle")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/shop?sort=-createdAt">
                <Button variant="accent" size="xl">
                  {t("home.shopNewArrivals")}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Button
                variant="outline"
                size="xl"
                onClick={() => dispatch(setFinderOpen(true))}
              >
                {t("home.helpMeChoose")}
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-[18px] gap-y-2 font-mono text-[11.5px] uppercase tracking-[0.08em] text-stone">
              <span>{t("home.cashOnDelivery")}</span>
              <span className="opacity-40">·</span>
              <span>{t("home.easyExchanges")}</span>
              <span className="opacity-40">·</span>
              <span>{t("home.premiumFabrics")}</span>
            </div>
          </div>

          {/* Hero stage */}
          <div className="relative lg:col-span-7">
            <div className="absolute right-0 top-0 font-mono text-xs tracking-[0.14em] text-stone">
              0{hero + 1} / 0{DEPARTMENT_ROTATION_SLUGS.length}
            </div>
            <div className="relative ml-auto aspect-5/4 w-full max-w-[760px]">
              {/* Backdrop card peeking out behind the sharp foreground photo
                  — purely decorative depth, so instead of a loading state it
                  gets a frosted-glass treatment: the same photo, blurred and
                  scaled up, standing in for a real blurred-backdrop shot. */}
              <div
                aria-hidden="true"
                className="absolute inset-x-[4%] bottom-[8%] top-[6%] overflow-hidden rounded-3xl bg-media"
              >
                {slide.loading ? (
                  <Skeleton className="absolute inset-0 rounded-none" />
                ) : slide.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolveImage(slide.image, 700)}
                    alt=""
                    className="h-full w-full scale-125 object-cover opacity-90 blur-2xl"
                  />
                ) : (
                  <div className="absolute inset-0 hatch" />
                )}
                {!slide.loading && (
                  <>
                    <div className="absolute inset-0 glow" />
                    <div className="absolute inset-0 bg-elev/20" />
                  </>
                )}
              </div>

              <motion.div
                key={hero}
                initial={{ opacity: 0, x: 34 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-x-[12%] bottom-[14%] top-[16%]"
              >
                <div
                  aria-hidden="true"
                  className="absolute inset-x-[4%] -bottom-[2%] h-[22%] contact-shadow"
                />
                <div className="absolute inset-0 overflow-hidden rounded-2xl border border-hair bg-wash">
                  {slide.loading ? (
                    <Skeleton className="absolute inset-0 rounded-2xl" />
                  ) : slide.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolveImage(slide.image, 900)}
                      alt={slide.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center">
                      <span className="px-6 text-center font-mono text-xs uppercase leading-[1.7] tracking-[0.1em] text-stone">
                        {slide.name}
                      </span>
                    </div>
                  )}
                </div>
                <div className="absolute left-[26%] top-[30%] hidden items-center gap-2.5 lg:flex">
                  <span className="h-[11px] w-[11px] rounded-full bg-verm shadow-[0_0_0_5px_rgba(255,61,33,0.18)]" />
                  <span className="whitespace-nowrap rounded-lg border border-line bg-elev px-2.5 py-[7px] text-[12.5px] font-medium">
                    {slide.tagline}
                  </span>
                </div>
              </motion.div>
            </div>

            <div className="mt-2 flex flex-wrap items-end justify-between gap-6">
              <div>
                <div className="mt-1.5 text-[23px] font-semibold tracking-[-0.02em]">
                  {slide.name}
                </div>
                <div className="mt-1.5 text-[14.5px] text-stone">
                  {slide.tagline}
                </div>
              </div>
              <div role="group" aria-label={t("home.chooseDepartment")} className="flex gap-2">
                {DEPARTMENT_ROTATION_SLUGS.map((slug, i) => (
                  <button
                    key={slug}
                    onClick={() => setHero(i)}
                    aria-label={t("home.showDepartment", { name: departments.find((d) => d.slug === slug)?.name || slug })}
                    aria-pressed={i === hero}
                    className={cn(
                      "relative h-[66px] w-[66px] overflow-hidden rounded-[10px] border bg-media transition-colors focus-ring",
                      i === hero ? "border-ink" : "border-line hover:border-ink",
                    )}
                  >
                    {heroLoadingBySlug[slug] ? (
                      <Skeleton className="absolute inset-0 rounded-none" />
                    ) : heroImageBySlug[slug] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveImage(heroImageBySlug[slug], 132)}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <span aria-hidden="true" className="absolute inset-0 hatch" />
                    )}
                    <span className="absolute left-1.5 top-1 font-mono text-[9.5px] text-stone">
                      0{i + 1}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- Trust
          (desktop only — mobile has its own trust rail inside MobileHero;
          tablet drops it entirely per request, no replacement.) */}
      <section
        aria-label={t("home.serviceBenefits")}
        className="hidden border-y border-line bg-surface lg:block"
      >
        <div className="container-x grid sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((item, i) => (
            <div
              key={item.titleKey}
              className={cn(
                "flex items-start gap-3.5 py-[26px] pr-[30px]",
                i < TRUST.length - 1 && "lg:border-r lg:border-line",
              )}
            >
              <span
                aria-hidden="true"
                className="grid h-[34px] w-[34px] flex-none place-items-center rounded-lg border border-line text-verm"
              >
                <item.icon className="h-[17px] w-[17px]" strokeWidth={1.6} />
              </span>
              <div>
                <div className="text-[14.5px] font-semibold">{t(item.titleKey)}</div>
                <div className="mt-1 text-[13.5px] leading-[1.45] text-stone">
                  {t(item.bodyKey)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ Departments */}
      <section id="departments" aria-labelledby="dept-h" className="container-x pt-32">
        <SectionHead
          eyebrow={t("home.departmentsEyebrow")}
          title={t("home.shopByDepartment")}
          aside={t("home.departmentsSub")}
          id="dept-h"
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {departments.map((d) => {
            const copy = DEPARTMENT_COPY[d.slug] || { num: "•", bodyKey: null, tone: "media" };
            const body = copy.bodyKey ? t(copy.bodyKey) : d.description || "";
            const deptName = departmentName(locale, d.slug, d.name);
            return (
              <Link
                key={d._id}
                href={`/shop?category=${d._id}`}
                data-reveal
                className={cn(
                  "group relative flex flex-col justify-end overflow-hidden rounded-3xl p-8 focus-ring",
                  copy.span === "tall" && "lg:row-span-2 lg:min-h-[560px]",
                  copy.span === "wide" && "lg:col-span-2 lg:min-h-[265px]",
                  !copy.span && "min-h-[275px]",
                  copy.tone === "media" && "bg-media",
                  copy.tone === "coral" && "bg-coral",
                  copy.tone === "night" && "bg-[#101012]",
                )}
              >
                {copy.tone === "media" && (
                  <>
                    {heroImageBySlug[d.slug] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveImage(heroImageBySlug[d.slug], 700)}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <div aria-hidden="true" className="absolute inset-0 hatch" />
                    )}
                    <div aria-hidden="true" className="absolute inset-0 scrim" />
                  </>
                )}
                {copy.tone === "night" && (
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-[radial-gradient(90%_70%_at_70%_20%,rgba(212,255,69,0.14),transparent_60%)]"
                  />
                )}
                <div
                  className={cn(
                    "relative",
                    copy.tone === "coral" && "text-[#101012]",
                    copy.tone === "night" && "text-[#F5F2EA]",
                  )}
                >
                  <div
                    className={cn(
                      "font-mono text-[11px] uppercase tracking-[0.14em]",
                      copy.tone === "night" ? "text-lime" : "text-verm",
                      copy.tone === "coral" && "text-[#101012]",
                    )}
                  >
                    {copy.num}
                  </div>
                  <h3
                    className={cn(
                      "mt-2.5 font-semibold leading-none tracking-[-0.03em]",
                      copy.span === "tall" ? "text-[44px]" : copy.span === "wide" ? "text-[38px]" : "text-[34px]",
                    )}
                  >
                    {deptName}
                  </h3>
                  <p
                    className={cn(
                      "mt-2.5 max-w-[32ch] text-base leading-[1.45]",
                      copy.tone === "night"
                        ? "text-[rgba(245,242,234,0.66)]"
                        : copy.tone === "coral"
                          ? "opacity-70"
                          : "text-stone",
                    )}
                  >
                    {body}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-2 text-[14.5px] font-semibold">
                    {t("home.explore", { name: deptName })}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* --------------------------------------------------- New arrivals */}
      <section id="new-arrivals" aria-labelledby="new-h" className="container-x pt-32">
        <SectionHead
          eyebrow={t("home.newArrivalsEyebrow")}
          title={t("home.justLanded")}
          sub={t("home.justLandedSub")}
          id="new-h"
          bordered
          action={
            <Link href="/shop?sort=-createdAt">
              <Button variant="subtle" size="lg">
                {t("home.shopAllNewArrivals")}
                <ArrowRight className="h-[15px] w-[15px]" />
              </Button>
            </Link>
          }
        />
        <div className="mt-9 grid grid-cols-2 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {arrivalsLoading
            ? Array.from({ length: 8 }, (_, i) => <ProductCardSkeleton key={i} />)
            : arrivals.map((p, i) => <ProductCard key={p._id} product={p} index={i} />)}
        </div>
      </section>

      {/* --------------------------------------------------- Featured picks */}
      <FeaturedPicksSection departments={departments} />

      {/* ---------------------------------------- Featured / Discount / Dept */}
      <ProductTabsSection departments={departments} />

      {/* ------------------------------------------------------ Fabric story */}
      <section aria-labelledby="fabric-h" className="container-x pt-32">
        <SectionHead
          eyebrow={t("home.fabricStoryEyebrow")}
          title={t("home.fabricStoryTitle")}
          aside={t("home.fabricStoryAside")}
          id="fabric-h"
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {FABRICS.map((f) => (
            <Link
              key={f.value}
              href={`/shop?fabric=${f.value}`}
              data-reveal
              className="group relative flex min-h-[220px] flex-col justify-end overflow-hidden rounded-2xl bg-media p-6 focus-ring"
            >
              <div aria-hidden="true" className="absolute inset-0 hatch" />
              <div aria-hidden="true" className="absolute inset-0 scrim" />
              <div className="relative">
                <h3 className="text-[22px] font-semibold tracking-[-0.02em]">{t(f.nameKey)}</h3>
                <p className="mt-2 text-[13.5px] leading-[1.5] text-stone">{t(f.bodyKey)}</p>
                <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-verm">
                  {t("home.shopFabric", { name: t(f.nameKey) })}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------- Occasions */}
      <section aria-labelledby="occ-h" className="container-x pt-32">
        <SectionHead
          eyebrow={t("home.occasionsEyebrow")}
          title={t("home.dressedForMoment")}
          aside={t("home.occasionsAside")}
          id="occ-h"
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {OCCASIONS.map((o) => (
            <Link
              key={o.value}
              href={`/shop?occasion=${o.value}`}
              data-reveal
              className="group flex min-h-[200px] flex-col justify-end rounded-2xl border border-line p-6 transition-colors hover:border-ink focus-ring"
            >
              <h3 className="text-[22px] font-semibold tracking-[-0.02em]">{t(o.nameKey)}</h3>
              <p className="mt-2 text-[13.5px] leading-[1.5] text-stone">{t(o.bodyKey)}</p>
              <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-verm">
                {t("home.shopOccasion", { name: t(o.nameKey) })}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------- Guided finder */}
      <section aria-labelledby="finder-h" className="container-x pt-32">
        <div
          data-reveal
          className="relative grid overflow-hidden rounded-[26px] border border-line bg-surface lg:grid-cols-[1.1fr_1fr]"
        >
          <div className="p-8 sm:p-14">
            <div className="eyebrow">{t("home.guidedDiscoveryEyebrow")}</div>
            <h2
              id="finder-h"
              className="mt-4 text-[clamp(32px,3.2vw,46px)] font-semibold leading-[1.02] tracking-[-0.03em]"
            >
              {t("home.notSureTitle")}
            </h2>
            <p className="mt-3.5 max-w-[36ch] text-xl leading-[1.5] text-stone">
              {t("home.notSureBody")}
            </p>
            <Button
              variant="primary"
              size="xl"
              className="mt-7"
              onClick={() => dispatch(setFinderOpen(true))}
            >
              {t("home.helpMeChoose")}
              <ArrowRight className="h-4 w-4" />
            </Button>
            <div className="mt-[22px] font-mono text-[11px] uppercase tracking-[0.1em] text-stone">
              {t("home.threeQuestions")}
            </div>
          </div>
          <div className="relative hidden min-h-[340px] border-l border-line bg-media lg:grid lg:place-items-center">
            <div aria-hidden="true" className="absolute inset-0 hatch" />
            <div className="relative flex gap-3.5">
              <span className="rounded-lg border border-line bg-elev px-4 py-2.5 text-[14.5px] font-medium">
                {t("home.everyday")}
              </span>
              <span className="rounded-lg bg-verm px-4 py-2.5 text-[14.5px] font-medium text-white">
                {t("home.fullCoverage")}
              </span>
              <span className="rounded-lg border border-line bg-elev px-4 py-2.5 text-[14.5px] font-medium">
                {t("home.eid")}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- Campaign
          Bounded card (matches the Guided-finder/Newsletter siblings around
          it) instead of a full-viewport-bleed section — at ultra-wide
          widths the old version left the text pinned to the left edge with
          a large, unbounded dead zone of empty background to its right.
          Single column, not split — a second column here had nothing real
          to put in it and just left a big empty decorative panel. */}
      <section id="campaign" aria-labelledby="camp-h" className="container-x pt-32">
        <div className="relative overflow-hidden rounded-[26px] bg-[#101012] text-[#F5F2EA]">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[repeating-linear-gradient(115deg,rgba(245,242,234,0.05)_0_1px,transparent_1px_14px)]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(55%_90%_at_22%_35%,rgba(255,61,33,0.16),transparent_65%)]"
          />

          <div className="relative max-w-[640px] px-8 py-16 sm:px-14">
            <div className="flex items-center gap-3 font-mono text-[11.5px] uppercase tracking-[0.16em] text-[rgba(245,242,234,0.6)]">
              <span className="h-px w-[22px] bg-verm" />
              {t("home.ourApproach")}
            </div>
            <h2
              id="camp-h"
              className="mt-6 text-[clamp(36px,3.6vw,58px)] font-semibold leading-[0.98] tracking-[-0.03em] text-balance"
            >
              {t("home.campaignTitle")}{" "}
              <span className="font-serif font-normal italic">{t("home.campaignTitleAccent")}</span>
            </h2>
            <p className="mt-5 text-lg leading-[1.5] text-[rgba(245,242,234,0.7)] text-pretty">
              {t("home.campaignBody")}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3.5">
              <Link href="/shop">
                <span className="inline-flex h-[52px] items-center gap-2.5 rounded-[9px] bg-[#F5F2EA] px-6 text-[15.5px] font-semibold text-[#101012] transition-colors hover:bg-verm hover:text-white">
                  {t("home.shopTheCollection")}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ Newsletter */}
      <NewsletterPoster />
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The mobile app shell's hero: HeroProductStage + TrustRail.
 * <768px only — `<Header>`'s mobile bar and `<MobileNav>` are this page's
 * counterparts for the rest of the shell (both untouched here).
 */
function MobileHero({ slide, dispatch }) {
  const { t } = useLocale();
  const gutter = "clamp(20px,4vw,56px)";

  return (
    <section
      aria-labelledby="hero-h-mobile"
      className="relative overflow-hidden pb-2 pt-4 md:hidden"
      style={{ paddingInline: gutter }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[-8%] top-0 select-none text-[clamp(120px,48vw,200px)] font-bold leading-[0.8] tracking-[-0.06em] text-ink opacity-[0.04]"
      >
        TAH
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-stone"
      >
        <span className="h-px w-4 bg-verm" />
        {t("home.heroEyebrow")}
      </motion.div>

      <motion.h1
        id="hero-h-mobile"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        className="relative mt-2 text-[32px] font-semibold leading-[0.98] tracking-[-0.035em]"
      >
        {t("home.heroTitle")}{" "}
        <span className="font-serif font-normal italic">{t("home.heroTitleAccent")}</span>
      </motion.h1>

      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="relative mt-3 aspect-[2/1]"
        style={{ marginInline: `calc(-1 * ${gutter})` }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-2xl bg-media">
          {slide.loading ? (
            <Skeleton className="absolute inset-0 rounded-2xl" />
          ) : slide.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resolveImage(slide.image, 700)} alt={slide.name} className="h-full w-full object-cover" />
          ) : (
            <>
              <div aria-hidden="true" className="absolute inset-0 hatch" />
              <div aria-hidden="true" className="absolute inset-0 glow" />
              <div className="absolute inset-x-[10%] bottom-[14%] top-[12%] grid place-items-center">
                <div
                  aria-hidden="true"
                  className="absolute inset-x-[6%] -bottom-[4%] h-[18%] contact-shadow"
                />
                <span className="px-6 text-center font-mono text-[9.5px] uppercase leading-[1.7] tracking-[0.08em] text-stone">
                  {slide.name}
                </span>
              </div>
            </>
          )}
        </div>
      </motion.div>

      <div className="relative mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="mt-0.5 truncate text-[15px] font-semibold tracking-[-0.02em]">
            {slide.name}
          </div>
          <div className="text-[12.5px] text-stone">{slide.tagline}</div>
        </div>
      </div>

      {/* CTA row */}
      <div className="relative mt-3 flex gap-2">
        <Link href="/shop?sort=-createdAt" className="flex-1">
          <span className="flex h-12 items-center justify-center rounded-[10px] bg-verm text-sm font-semibold text-white transition-transform active:scale-[0.975]">
            {t("home.shopNewArrivals")}
          </span>
        </Link>
        <button
          onClick={() => dispatch(setFinderOpen(true))}
          className="flex h-12 items-center justify-center whitespace-nowrap rounded-[10px] border border-ink px-4 text-sm font-semibold transition-transform active:scale-[0.975]"
        >
          {t("home.helpMeChoose")}
        </button>
      </div>
    </section>
  );
}

/**
 * A dedicated hero for 768–1023px — a single-column shape sized for that
 * width rather than the desktop composition collapsed into one column.
 */
function TabletHero({ slide, dispatch }) {
  const { t } = useLocale();
  return (
    <section
      aria-labelledby="hero-h-tablet"
      className="relative hidden overflow-hidden md:block lg:hidden"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-[6%] right-[-3%] select-none text-[clamp(100px,18vw,170px)] font-bold leading-[0.8] tracking-[-0.06em] text-ink opacity-[0.045]"
      >
        TAHOS
      </div>

      <div className="container-x relative py-16">
        <div className="max-w-[520px]">
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-stone">
            <span className="h-px w-5 bg-verm" />
            {t("home.heroEyebrow")}
          </div>
          <h1
            id="hero-h-tablet"
            className="mt-4 text-[46px] font-semibold leading-[0.98] tracking-[-0.04em]"
          >
            {t("home.heroTitle")}{" "}
            <span className="font-serif font-normal italic tracking-[-0.01em]">
              {t("home.heroTitleAccent")}
            </span>
          </h1>
          <p className="mt-4 max-w-[46ch] text-lg leading-[1.5] text-stone">
            {t("home.heroSubtitleShort")}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/shop?sort=-createdAt">
              <Button variant="accent" size="lg">
                {t("home.shopNewArrivals")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Button
              variant="outline"
              size="lg"
              onClick={() => dispatch(setFinderOpen(true))}
            >
              {t("home.helpMeChoose")}
            </Button>
          </div>
        </div>

        <div className="relative mt-10 aspect-[2/1] w-full overflow-hidden rounded-3xl bg-media">
          {slide.loading ? (
            <Skeleton className="absolute inset-0 rounded-3xl" />
          ) : slide.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resolveImage(slide.image, 1200)} alt={slide.name} className="h-full w-full object-cover" />
          ) : (
            <>
              <div aria-hidden="true" className="absolute inset-0 hatch" />
              <div aria-hidden="true" className="absolute inset-0 glow" />
              <div className="absolute inset-x-[8%] bottom-[12%] top-[10%] grid place-items-center">
                <div
                  aria-hidden="true"
                  className="absolute inset-x-[6%] -bottom-[3%] h-[16%] contact-shadow"
                />
                <span className="px-6 text-center font-mono text-xs uppercase leading-[1.7] tracking-[0.1em] text-stone">
                  {slide.name}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mt-1 text-lg font-semibold tracking-[-0.02em]">
              {slide.name}
            </div>
            <div className="text-sm text-stone">{slide.tagline}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionHead({ eyebrow, title, sub, aside, id, action, bordered }) {
  return (
    <div
      data-reveal
      className={cn(
        "flex flex-wrap items-end justify-between gap-6",
        bordered && "border-b border-line pb-6",
      )}
    >
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h2
          id={id}
          className="mt-3.5 text-[clamp(34px,3.4vw,48px)] font-semibold leading-none tracking-[-0.03em]"
        >
          {title}
        </h2>
        {sub && <p className="mt-3 text-lg text-stone">{sub}</p>}
      </div>
      {aside && (
        <p className="max-w-[42ch] text-[15.5px] leading-[1.5] text-stone text-pretty">
          {aside}
        </p>
      )}
      {action}
    </div>
  );
}

/**
 * 04 — Featured picks. Real isFeatured products only (see
 * services/productService.js's buildFilter — `?featured=true` was already
 * a working filter, just nothing on the homepage used it) — scoped for
 * now to Burqa + Hijab, the only departments this phase covers. No
 * fallback content: a genuinely empty result renders EmptyState, never an
 * invented product.
 */
function FeaturedPicksSection({ departments }) {
  const { t } = useLocale();
  const burqa = departments.find((d) => d.slug === "burqa");
  const hijab = departments.find((d) => d.slug === "hijab");
  const categoryIds = [burqa?._id, hijab?._id].filter(Boolean).join(",");
  const ready = !!(burqa?._id && hijab?._id);

  const { data, isLoading, isError } = useGetProductsQuery(
    { limit: 8, featured: "true", category: categoryIds },
    { skip: !ready },
  );
  const products = data?.products ?? [];

  return (
    <section id="featured-picks" aria-labelledby="featured-h" className="container-x pt-32">
      <SectionHead
        eyebrow={t("home.featuredPicksEyebrow")}
        title={t("home.editorsPicks")}
        sub={t("home.featuredPicksSub")}
        id="featured-h"
        bordered
        action={
          <Link href="/shop?featured=true">
            <Button variant="subtle" size="lg">
              {t("home.shopAllFeatured")}
              <ArrowRight className="h-[15px] w-[15px]" />
            </Button>
          </Link>
        }
      />
      <div className="mt-9">
        {!ready || isLoading ? (
          <div className="grid grid-cols-2 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={AlertCircle}
            title={t("home.couldntLoadProducts")}
            message={t("home.pleaseTryAgain")}
          />
        ) : products.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={t("home.noFeaturedTitle")}
            message={t("home.noFeaturedMessage")}
          />
        ) : (
          <div className="grid grid-cols-2 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((p, i) => (
              <ProductCard key={p._id} product={p} index={i} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const HOME_TABS = [
  { key: "featured", labelKey: "home.tabFeatured", icon: Sparkles },
  { key: "discount", labelKey: "home.tabDiscount", icon: Percent },
  { key: "burqa", labelKey: "home.tabBurqa", icon: Shirt },
  { key: "hijab", labelKey: "home.tabHijab", icon: Shirt },
];

/**
 * 05 — the tabbed section. Each tab is its own live API query (Featured/
 * Discount reuse the same Burqa+Hijab scope as the Featured Picks section
 * above; Burqa/Hijab are single-department queries ShopPage already
 * supports unmodified) — all four fire in parallel on mount so switching
 * tabs after the first paint is instant, not a fresh loading state every
 * click. "View all" links point at the exact /shop query params ShopPage
 * and the API already understand.
 */
function ProductTabsSection({ departments }) {
  const { t } = useLocale();
  const burqa = departments.find((d) => d.slug === "burqa");
  const hijab = departments.find((d) => d.slug === "hijab");
  const bothIds = [burqa?._id, hijab?._id].filter(Boolean).join(",");
  const bothReady = !!(burqa?._id && hijab?._id);
  const shouldReduceMotion = useReducedMotion();
  const [active, setActive] = useState("featured");

  const featuredQ = useGetProductsQuery({ limit: 8, featured: "true", category: bothIds }, { skip: !bothReady });
  const discountQ = useGetProductsQuery({ limit: 8, discount: "true", category: bothIds }, { skip: !bothReady });
  const burqaQ = useGetProductsQuery({ limit: 8, category: burqa?._id }, { skip: !burqa?._id });
  const hijabQ = useGetProductsQuery({ limit: 8, category: hijab?._id }, { skip: !hijab?._id });

  const TAB_PANELS = {
    featured: { ...featuredQ, ready: bothReady, viewAllHref: "/shop?featured=true", emptyMessageKey: "home.noFeaturedBurqaHijab" },
    discount: { ...discountQ, ready: bothReady, viewAllHref: "/shop?discount=true", emptyMessageKey: "home.noDiscountItems" },
    burqa: { ...burqaQ, ready: !!burqa?._id, viewAllHref: burqa ? `/shop?category=${burqa._id}` : "/shop", emptyMessageKey: "home.noBurqaItems" },
    hijab: { ...hijabQ, ready: !!hijab?._id, viewAllHref: hijab ? `/shop?category=${hijab._id}` : "/shop", emptyMessageKey: "home.noHijabItems" },
  };

  const current = TAB_PANELS[active];
  const activeTabDef = HOME_TABS.find((tab) => tab.key === active);
  const products = current.data?.products ?? [];
  const showSkeleton = !current.ready || current.isLoading;

  const underlineTransition = shouldReduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 };

  return (
    <section id="shop-by-tab" aria-labelledby="tabs-h" className="container-x pt-32">
      <SectionHead
        eyebrow={t("home.findYourFitEyebrow")}
        title={t("home.findYourFit")}
        sub={t("home.findYourFitSub")}
        id="tabs-h"
        bordered
      />

      <div
        role="tablist"
        aria-label={t("home.productCategories")}
        className="mt-8 flex gap-7 overflow-x-auto border-b border-line no-scrollbar"
      >
        {HOME_TABS.map((tab) => {
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`home-tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`home-tabpanel-${tab.key}`}
              onClick={() => setActive(tab.key)}
              className={cn(
                "relative flex flex-none items-center gap-2 whitespace-nowrap pb-3.5 font-mono text-[12px] uppercase tracking-[0.12em] transition-colors focus-ring",
                isActive ? "text-ink" : "text-stone hover:text-ink",
              )}
            >
              <tab.icon className={cn("h-3.5 w-3.5 transition-transform duration-150", isActive && "scale-110")} />
              {t(tab.labelKey)}
              {isActive && (
                <motion.span
                  layoutId="home-tabs-underline"
                  transition={underlineTransition}
                  className="absolute inset-x-0 -bottom-px h-[2px] bg-verm"
                />
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`home-tabpanel-${active}`} aria-labelledby={`home-tab-${active}`} className="mt-9">
        {showSkeleton ? (
          <div className="grid grid-cols-2 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : current.isError ? (
          <EmptyState
            icon={AlertCircle}
            title={t("home.couldntLoadProducts")}
            message={t("home.pleaseTryAgain")}
          />
        ) : (
          // Plain key-remount fade, same pattern as the hero stage above
          // (motion.div key={hero}) and ProductDetailPage's gallery — not
          // AnimatePresence, which (with a single always-present child) left
          // the outgoing tab's content stuck on screen indefinitely instead
          // of unmounting once its exit finished; an enter-only fade has no
          // such handoff to get stuck on.
          <motion.div
            key={active}
            initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            {products.length === 0 ? (
              <EmptyState
                icon={activeTabDef?.icon || Sparkles}
                title={t("home.nothingHereYet")}
                message={t(current.emptyMessageKey)}
              />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {products.map((p, i) => (
                    <ProductCard key={p._id} product={p} index={i} />
                  ))}
                </div>
                <div className="mt-9 flex justify-center">
                  <Link href={current.viewAllHref}>
                    <Button variant="subtle" size="lg">
                      {t("home.viewAllLower", { label: t(activeTabDef?.labelKey) })}
                      <ArrowRight className="h-[15px] w-[15px]" />
                    </Button>
                  </Link>
                </div>
              </>
            )}
          </motion.div>
        )}
      </div>
    </section>
  );
}

function NewsletterPoster() {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | loading | invalid | success

  const submit = (e) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setState("invalid");
      return;
    }
    setState("loading");
    // Wired to the notifications service in the backend phase.
    setTimeout(() => setState("success"), 600);
  };

  const note = {
    idle: t("home.newsletterNoteIdle"),
    invalid: t("home.newsletterNoteInvalid"),
    loading: t("home.newsletterNoteLoading"),
    success: t("home.newsletterNoteSuccess"),
  }[state];

  return (
    <section aria-labelledby="news-h" className="container-x pt-32">
      {/* Single column, not split against an empty second column — see the
          Campaign card above for why. */}
      <div
        data-reveal
        className="relative overflow-hidden rounded-[26px] bg-ink text-canvas"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-8 right-[6%] text-[300px] font-bold leading-[0.8] tracking-[-0.06em] opacity-[0.06]"
        >
          02
        </div>
        <svg
          aria-hidden="true"
          viewBox="0 0 600 40"
          preserveAspectRatio="none"
          className="absolute inset-x-0 bottom-0 h-10 w-full opacity-50"
        >
          <path
            d="M0 30 C 100 4, 200 40, 300 22 S 500 4, 600 26"
            fill="none"
            stroke="#FF3D21"
            strokeWidth="2"
          />
        </svg>

        <div className="relative max-w-[760px] px-8 py-16 sm:px-14">
          <div className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-verm">
            {t("home.newsletterEyebrow")}
          </div>
          <h2
            id="news-h"
            className="mt-4 text-[clamp(38px,4.2vw,60px)] font-semibold leading-[0.98] tracking-[-0.035em]"
          >
            {t("home.newsletterTitle")}
            <br />
            {t("home.newsletterTitleLine2")}
          </h2>
          <p className="mt-4 max-w-[38ch] text-[19px] leading-[1.5] text-[rgba(245,242,234,0.66)]">
            {t("home.newsletterBody")}
          </p>

          <form onSubmit={submit} className="mt-8 max-w-[520px]">
            <label
              htmlFor="nl"
              className="block font-mono text-[11px] uppercase tracking-[0.12em] text-[rgba(245,242,234,0.6)]"
            >
              {t("home.emailAddress")}
            </label>
            <div className="mt-2.5 flex flex-col gap-2.5 sm:flex-row">
              <input
                id="nl"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (state === "invalid") setState("idle");
                }}
                placeholder={t("home.emailPlaceholder")}
                aria-describedby="nl-note"
                aria-invalid={state === "invalid"}
                className={cn(
                  "h-[54px] flex-1 rounded-[9px] border bg-[rgba(245,242,234,0.06)] px-4 text-base text-canvas placeholder:text-[rgba(245,242,234,0.45)] focus-ring",
                  state === "invalid"
                    ? "border-verm"
                    : "border-[rgba(245,242,234,0.22)]",
                )}
              />
              <button
                type="submit"
                disabled={state === "loading"}
                className="h-[54px] whitespace-nowrap rounded-[9px] bg-verm px-6 text-[15.5px] font-semibold text-white transition-colors hover:bg-[#F5F2EA] hover:text-[#101012] focus-ring active:scale-[0.98] disabled:opacity-60"
              >
                {state === "success" ? t("home.subscribed") : t("home.signUp")}
              </button>
            </div>
            <div
              id="nl-note"
              role="status"
              className={cn(
                "mt-3 text-[13.5px] leading-[1.5]",
                state === "invalid"
                  ? "text-verm"
                  : "text-[rgba(245,242,234,0.6)]",
              )}
            >
              {note}
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
