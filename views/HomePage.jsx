import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Banknote, RefreshCw, Sparkles, Gem } from "lucide-react";

import Button from "../components/ui/Button.jsx";
import HeroCarousel from "./home/HeroCarousel.jsx";
import ProductTabsSection from "./home/ProductTabsSection.jsx";
import GuidedFinderSection from "./home/GuidedFinderSection.jsx";
import NewsletterPoster from "./home/NewsletterPoster.jsx";
import SectionHead from "./home/SectionHead.jsx";

import connectDB from "../config/db.js";
import { getCachedCategories, getCachedProductList, getCachedPublicSettings } from "../lib/serverDataCache.js";
import { getShopCacheKey } from "../lib/shopCacheEligibility.js";
import { listProducts } from "../services/productService.js";
import { serializeForClient } from "../lib/serialize.js";
import { getT, getServerLocale } from "../lib/i18n/server.js";
import { localizeProductList, localizeCategoryList } from "../lib/i18n/localize.js";
import { departmentName } from "../lib/i18n/catalog.js";
import { cn, resolveImage } from "../lib/utils.js";

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

// Phase 7 — real Server Component: every product/category read below goes
// straight through services/productService.js and services/categoryService.js
// (no fetch to this app's own /api), fetched in parallel via Promise.all.
// Bangla localization is applied server-side (lib/i18n/localize.js) before
// serialization, exactly like every API route already does. Only the
// genuinely stateful pieces (hero rotation, product tabs, the newsletter
// form, the guided-finder button) are Client Components, each receiving
// plain, pre-fetched props — none of them re-fetches this page's initial
// data itself.
export default async function HomePage() {
  // Realtime-durability-class fix: this page's cached reads each now
  // guarantee their own DB readiness (lib/serverDataCache.js's withDb()),
  // but the uncached listProducts() fallback below (when the shop-cache-
  // eligibility check excludes this page's query) does not go through
  // that wrapper at all — establish readiness once, up front, for the
  // whole render rather than relying on Promise.all ordering or a sibling
  // call having already connected.
  await connectDB();
  const [t, locale, rawCategories, publicSettings] = await Promise.all([
    getT(),
    getServerLocale(),
    getCachedCategories(),
    getCachedPublicSettings(),
  ]);
  const homepageSettings = publicSettings?.homepage || {};
  const categories = localizeCategoryList(rawCategories, locale);
  const departments = categories.filter((c) => !c.parent);

  const burqa = departments.find((d) => d.slug === "burqa");
  const abaya = departments.find((d) => d.slug === "abaya");
  const hijab = departments.find((d) => d.slug === "hijab");
  const khimar = departments.find((d) => d.slug === "khimar");

  // Phase 8 — every one of this page's product queries below is a fixed,
  // low-cardinality shape (limit + sort, or limit + category + collection)
  // that always passes lib/shopCacheEligibility.js's policy — cached
  // accordingly, same as the shop page.
  // The home page never reads `result.facets` (no sidebar filters here) —
  // includeFacets: false skips listProducts()'s four extra facet-count
  // aggregates on every one of the dozen product-list calls this page
  // makes, cutting concurrent DB load on render significantly.
  const fetchProducts = async (query) => {
    const cacheKey = getShopCacheKey(query, { isAdmin: false });
    const result = cacheKey
      ? await getCachedProductList(query, cacheKey, { includeFacets: false })
      : serializeForClient(await listProducts(query, { isAdmin: false, includeFacets: false }));
    return localizeProductList(result.products, locale);
  };

  // Single shop-wide showcase (New Arrival/Featured/Bestseller/Discount) —
  // this is a clothing-only shop with no single "all clothes" department
  // id to scope by (every department is its own root now), so these are
  // unscoped across the whole catalog. New/Featured/Discount use the
  // shop's own canonical `collection=` values; "Bestseller" has no such
  // canonical value (it isn't one of the shop's New/Featured/Discount
  // tabs), so it's defined by sort=-rating instead — the same real,
  // honest "best" signal already used below to pick each department's
  // hero image, not a fabricated sales-count field this schema doesn't
  // have.
  const [heroBurqa, heroAbaya, heroHijab, heroKhimar, shopNew, shopFeatured, shopBestseller, shopDiscount] =
    await Promise.all([
      burqa ? fetchProducts({ limit: 1, category: burqa._id, sort: "-rating" }) : Promise.resolve([]),
      abaya ? fetchProducts({ limit: 1, category: abaya._id, sort: "-rating" }) : Promise.resolve([]),
      hijab ? fetchProducts({ limit: 1, category: hijab._id, sort: "-rating" }) : Promise.resolve([]),
      khimar ? fetchProducts({ limit: 1, category: khimar._id, sort: "-rating" }) : Promise.resolve([]),
      fetchProducts({ limit: 8, collection: "new" }),
      fetchProducts({ limit: 8, collection: "featured" }),
      fetchProducts({ limit: 8, sort: "-rating" }),
      fetchProducts({ limit: 8, collection: "discount" }),
    ]);
  const shopTabProducts = { new: shopNew, featured: shopFeatured, bestseller: shopBestseller, discount: shopDiscount };

  // An admin-set carousel image (Shop Config → Carousel) overrides the
  // auto-derived top-rated product photo for that department; unset (the
  // default) keeps the existing product-driven behavior exactly as before.
  const heroImageBySlug = {
    burqa: homepageSettings.carouselImages?.burqa || heroBurqa[0]?.images?.[0] || null,
    abaya: homepageSettings.carouselImages?.abaya || heroAbaya[0]?.images?.[0] || null,
    hijab: homepageSettings.carouselImages?.hijab || heroHijab[0]?.images?.[0] || null,
    khimar: heroKhimar[0]?.images?.[0] || null,
  };

  return (
    <>
      <HeroCarousel departments={departments} heroImageBySlug={heroImageBySlug} />

      {/* Trust (desktop only) */}
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

      {/* Departments */}
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
                      <Image
                        src={resolveImage(heroImageBySlug[d.slug], 700)}
                        alt=""
                        fill
                        sizes="(max-width: 1024px) 100vw, 33vw"
                        className="object-cover"
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

      {/* Promotional banner — Shop Config → Banner. Admin-set image only;
          renders nothing when disabled or no image is set. */}
      {homepageSettings.banner?.enabled && homepageSettings.banner?.imageUrl && (
        <section aria-label={t("home.bannerLabel")} className="container-x pt-32">
          {homepageSettings.banner.href ? (
            <Link href={homepageSettings.banner.href} className="block overflow-hidden rounded-2xl focus-ring">
              <Image
                src={resolveImage(homepageSettings.banner.imageUrl, 1400)}
                alt=""
                width={1400}
                height={420}
                sizes="100vw"
                className="h-auto w-full object-cover"
              />
            </Link>
          ) : (
            <div className="overflow-hidden rounded-2xl">
              <Image
                src={resolveImage(homepageSettings.banner.imageUrl, 1400)}
                alt=""
                width={1400}
                height={420}
                sizes="100vw"
                className="h-auto w-full object-cover"
              />
            </div>
          )}
        </section>
      )}

      {/* Shop showcase — New Arrival / Featured / Bestseller / Discount,
          unscoped across the whole (clothing-only) catalog. */}
      <ProductTabsSection
        sectionId="shop-showcase"
        headingId="shop-showcase-h"
        eyebrow={t("home.newArrivalsEyebrow")}
        title={t("home.justLanded")}
        sub={t("home.justLandedSub")}
        products={shopTabProducts}
      />

      {/* Fabric story */}
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

      {/* Occasions */}
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

      <GuidedFinderSection />

      {/* Campaign */}
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
            {homepageSettings.campaign?.enabled && homepageSettings.campaign?.title ? (
              <h2
                id="camp-h"
                className="mt-6 text-[clamp(36px,3.6vw,58px)] font-semibold leading-[0.98] tracking-[-0.03em] text-balance"
              >
                {homepageSettings.campaign.title}
              </h2>
            ) : (
              <h2
                id="camp-h"
                className="mt-6 text-[clamp(36px,3.6vw,58px)] font-semibold leading-[0.98] tracking-[-0.03em] text-balance"
              >
                {t("home.campaignTitle")}{" "}
                <span className="font-serif font-normal italic">{t("home.campaignTitleAccent")}</span>
              </h2>
            )}
            <p className="mt-5 text-lg leading-[1.5] text-[rgba(245,242,234,0.7)] text-pretty">
              {homepageSettings.campaign?.enabled && homepageSettings.campaign?.message
                ? homepageSettings.campaign.message
                : t("home.campaignBody")}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3.5">
              <Link
                href={
                  homepageSettings.campaign?.enabled && homepageSettings.campaign?.ctaHref
                    ? homepageSettings.campaign.ctaHref
                    : "/shop"
                }
              >
                <span className="inline-flex h-[52px] items-center gap-2.5 rounded-[9px] bg-[#F5F2EA] px-6 text-[15.5px] font-semibold text-[#101012] transition-colors hover:bg-verm-contrast hover:text-white">
                  {homepageSettings.campaign?.enabled && homepageSettings.campaign?.ctaLabel
                    ? homepageSettings.campaign.ctaLabel
                    : t("home.shopTheCollection")}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <NewsletterPoster />
    </>
  );
}
