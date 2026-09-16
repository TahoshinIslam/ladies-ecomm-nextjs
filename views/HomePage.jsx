import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Banknote, Gem, RefreshCw, Sparkles } from "lucide-react";

import Button from "../components/ui/Button.jsx";
import NewsletterForm from "../components/layout/NewsletterForm.jsx";
import CategorySidebar from "../components/layout/CategorySidebar.jsx";
import CategoryCard from "../components/product/CategoryCard.jsx";
import HeroCarousel from "./home/HeroCarousel.jsx";
import ProductShowcaseSection from "./home/ProductShowcaseSection.jsx";
import GuidedFinderSection from "./home/GuidedFinderSection.jsx";
import SectionHead from "./home/SectionHead.jsx";

import connectDB from "../config/db.js";
import { getServerPageUser } from "../lib/serverPageAuth.js";
import { filterByAudience } from "../services/promotionService.js";
import {
  getCachedCategories,
  getCachedProductList,
  getCachedPublicSettings,
  getCachedEligiblePromotions,
} from "../lib/serverDataCache.js";
import { getShopCacheKey } from "../lib/shopCacheEligibility.js";
import { listProducts } from "../services/productService.js";
import { serializeForClient } from "../lib/serialize.js";
import { getT, getServerLocale } from "../lib/i18n/server.js";
import { localizeProductList, localizeCategoryList } from "../lib/i18n/localize.js";
import { departmentName } from "../lib/i18n/catalog.js";
import { resolveImage } from "../lib/utils.js";
import { sortDepartmentsForFavourites } from "../lib/storefrontDepartments.js";

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

// EShopper's top-of-page features/trust strip. Previously lived in
// components/layout/Footer.jsx (a white "service strip" shown on every
// page) — moved here to match EShopper's own composition (a features row
// directly under the hero, home page only) instead of repeating it in the
// footer on every page.
const FEATURES = [
  { icon: Banknote, titleKey: "home.trustCod", bodyKey: "home.trustCodBody" },
  { icon: RefreshCw, titleKey: "home.trustExchange", bodyKey: "home.trustExchangeBody" },
  { icon: Gem, titleKey: "home.trustFabric", bodyKey: "home.trustFabricBody" },
  { icon: Sparkles, titleKey: "home.trustCoverage", bodyKey: "home.trustCoverageBody" },
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
  const [t, locale, rawCategories, publicSettings, user, carouselPromotionsBase] = await Promise.all([
    getT(),
    getServerLocale(),
    getCachedCategories(),
    getCachedPublicSettings(),
    // Audience filtering must NOT be part of the shared cached read (see
    // services/promotionService.js's own comment) — this session lookup
    // and the filterByAudience() call below both run fresh on every
    // request, never inside getCachedEligiblePromotions()'s cache.
    getServerPageUser(),
    getCachedEligiblePromotions("carousel", "home_hero", "home"),
  ]);
  const carouselPromotions = filterByAudience(carouselPromotionsBase, Boolean(user));
  const homepageSettings = publicSettings?.homepage || {};
  const categories = localizeCategoryList(rawCategories, locale);
  const departments = sortDepartmentsForFavourites(categories);

  const burqa = departments.find((d) => d.slug === "burqa");
  const abaya = departments.find((d) => d.slug === "abaya");
  const hijab = departments.find((d) => d.slug === "hijab");
  const khimar = departments.find((d) => d.slug === "khimar");

  // Marketplace-expansion showcases — Cosmetics (under Beauty & Health),
  // Jewelry (its own division), and Home Decor (under Home & Kitchen).
  // `categories` (not `departments`) since Cosmetics/Home Decor are
  // mid-tier, not top-level; `category=<id>` (aliased to topCategory by
  // buildFilter) is scoped exactly to that category — a product only ever
  // shows up here because an admin genuinely filed it under Cosmetics/
  // Jewelry/Home Decor in the product form, never because of a hardcoded
  // product list.
  const cosmetics = categories.find((c) => c.slug === "cosmetics");
  const jewelry = categories.find((c) => c.slug === "jewelry");
  const homeDecor = categories.find((c) => c.slug === "home-decor");

  // Phase 8 — every one of this page's product queries below is a fixed,
  // low-cardinality shape (limit + sort, or limit + category + collection)
  // that always passes lib/shopCacheEligibility.js's policy — cached
  // accordingly, same as the shop page.
  // The home page never reads `result.facets` (no sidebar filters here) —
  // includeFacets: false skips listProducts()'s four extra facet-count
  // aggregates on every one of the dozen product-list calls this page
  // makes, cutting concurrent DB load on render significantly.
  const fetchProductList = async (query) => {
    const cacheKey = getShopCacheKey(query, { isAdmin: false });
    return cacheKey
      ? await getCachedProductList(query, cacheKey, { includeFacets: false })
      : serializeForClient(await listProducts(query, { isAdmin: false, includeFacets: false }));
  };
  const fetchProducts = async (query) => localizeProductList((await fetchProductList(query)).products, locale);

  // Two standalone shop-wide showcases — New Arrivals and Featured, each
  // its own section (see ProductShowcaseSection.jsx) rather than tabs
  // sharing one section. This is a clothing-only shop with no single "all
  // clothes" department id to scope by (every department is its own root
  // now), so both are unscoped across the whole catalog, using the shop's
  // own canonical `collection=` values.
  const [
    heroBurqa,
    heroAbaya,
    heroHijab,
    heroKhimar,
    shopNew,
    shopFeatured,
    departmentCountLists,
    shopCosmetics,
    shopJewelry,
    shopHomeDecor,
  ] = await Promise.all([
    burqa ? fetchProducts({ limit: 1, category: burqa._id, sort: "-rating" }) : Promise.resolve([]),
    abaya ? fetchProducts({ limit: 1, category: abaya._id, sort: "-rating" }) : Promise.resolve([]),
    hijab ? fetchProducts({ limit: 1, category: hijab._id, sort: "-rating" }) : Promise.resolve([]),
    khimar ? fetchProducts({ limit: 1, category: khimar._id, sort: "-rating" }) : Promise.resolve([]),
    fetchProducts({ limit: 8, collection: "new" }),
    // Wider limit than the other showcases: this list is filtered client-
    // side by the "Trending now" category tabs (ProductShowcaseSection),
    // so it needs enough spread across departments for each tab to show a
    // real grid rather than one or two items.
    fetchProducts({ limit: 24, collection: "featured" }),
    // EShopper's own categories section shows a real "N Products" count per
    // card (its own template hardcodes "15 Products" everywhere — this is
    // the actual per-department count). `limit: 1` keeps each of these
    // cheap: only `.total` (a real count aggregate) is read, never
    // `.products`.
    Promise.all(departments.map((d) => fetchProductList({ limit: 1, category: d._id }))),
    cosmetics ? fetchProducts({ limit: 8, category: cosmetics._id, sort: "-createdAt" }) : Promise.resolve([]),
    jewelry ? fetchProducts({ limit: 8, category: jewelry._id, sort: "-createdAt" }) : Promise.resolve([]),
    homeDecor ? fetchProducts({ limit: 8, category: homeDecor._id, sort: "-createdAt" }) : Promise.resolve([]),
  ]);
  const departmentCounts = Object.fromEntries(
    departments.map((d, i) => [d._id, departmentCountLists[i].total]),
  );

  // An admin-set carousel image (Shop Config → Carousel) overrides the
  // auto-derived top-rated product photo for that department; unset (the
  // default) keeps the existing product-driven behavior exactly as before.
  const heroImageBySlug = {
    burqa: homepageSettings.carouselImages?.burqa || heroBurqa[0]?.images?.[0] || null,
    abaya: homepageSettings.carouselImages?.abaya || heroAbaya[0]?.images?.[0] || null,
    hijab: homepageSettings.carouselImages?.hijab || heroHijab[0]?.images?.[0] || null,
    khimar: heroKhimar[0]?.images?.[0] || null,
  };
  // Admin-set images (Shop Config → Departments/Fabric Story/Occasions/
  // Guided Discovery) — every key defaults to "" server-side, so a plain
  // object read is always safe without per-field optional chaining below.
  const departmentImages = homepageSettings.departmentImages || {};
  const fabricImages = homepageSettings.fabricImages || {};
  const occasionImages = homepageSettings.occasionImages || {};
  const guidedFinderImage = homepageSettings.guidedFinderImage || null;

  return (
    <>
      {/* Hero row — an always-expanded category sidebar (desktop only; no
          click needed to see every department) beside the hero panel,
          matching the reference layout's persistent left-hand category
          list instead of a collapsed dropdown. */}
      <section aria-label={t("home.heroLabel")} className="container-x pt-6 sm:pt-10">
        <div className="mx-auto flex max-w-[1620px] items-stretch gap-6 lg:h-[460px]">
          <CategorySidebar categories={categories} />
          <div className="min-w-0 flex-1">
            <HeroCarousel departments={departments} heroImageBySlug={heroImageBySlug} promotions={carouselPromotions} />
          </div>
        </div>
      </section>

      {/* Compact category discovery — a real subset (up to 8) of the same
          department data the full mega menu and nav already use, shown as
          small consistent tiles right below the hero instead of the old
          full-width 3-column department grid. Every remaining department
          stays one click away via the header's mega menu, nav row, and the
          "Browse all departments" link below. */}
      <section aria-labelledby="favourites-h" className="container-x pt-14">
        <h2 id="favourites-h" className="text-[19px] font-semibold tracking-[-0.01em]">
          {t("home.favouritesEyebrow")}
        </h2>
        <div className="-mx-5 mt-6 flex gap-4 overflow-x-auto px-5 pb-1 no-scrollbar sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-8">
          {departments.slice(0, 8).map((d) => (
            <CategoryCard
              key={d._id}
              as="link"
              href={`/shop?category=${d._id}`}
              label={departmentName(locale, d.slug, d.name)}
              image={departmentImages[d.slug] || heroImageBySlug[d.slug] || null}
            />
          ))}
        </div>
        <Link
          href="/shop"
          className="mt-6 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-verm hover:underline focus-ring"
        >
          {t("home.browseAllDepartments")}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

      {/* Features/trust row — a slim, low-shadow strip of real, configured
          policies (no invented delivery windows or thresholds). */}
      <section aria-label={t("home.serviceBenefits")} className="container-x pt-14">
        <div className="grid gap-x-6 gap-y-6 rounded-2xl border border-line bg-media px-6 py-7 sm:grid-cols-2 sm:divide-x sm:divide-line lg:grid-cols-4">
          {FEATURES.map((item) => (
            <div key={item.titleKey} className="flex items-start gap-3 sm:pl-6 first:sm:pl-0">
              <item.icon className="h-[20px] w-[20px] flex-none text-verm" strokeWidth={1.6} aria-hidden="true" />
              <div>
                <div className="text-[14px] font-semibold">{t(item.titleKey)}</div>
                <div className="mt-0.5 text-[12.5px] text-stone">{t(item.bodyKey)}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Departments — the full, every-department browser (kept, further
          down the page) for shoppers who want the whole catalog laid out
          rather than the curated favourites strip above. */}
      <section id="departments" aria-labelledby="dept-h" className="container-x pt-32">
        <SectionHead
          eyebrow={t("home.departmentsEyebrow")}
          title={t("home.shopByDepartment")}
          aside={t("home.departmentsSub")}
          id="dept-h"
        />
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((d) => {
            const deptName = departmentName(locale, d.slug, d.name);
            const deptImage = departmentImages[d.slug] || heroImageBySlug[d.slug] || null;
            return (
              <Link
                key={d._id}
                href={`/shop?category=${d._id}`}
                data-reveal
                className="group flex flex-col border border-line p-7 transition-colors hover:border-ink focus-ring"
              >
                <p className="text-right text-[12.5px] text-stone">
                  {t("home.productCount", { count: departmentCounts[d._id] ?? 0 })}
                </p>
                <div className="relative mt-3 aspect-4/3 overflow-hidden bg-media">
                  {deptImage ? (
                    <Image
                      src={resolveImage(deptImage, 500)}
                      alt=""
                      fill
                      sizes="(max-width: 1024px) 100vw, 33vw"
                      className="object-cover object-top transition-transform duration-300 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div aria-hidden="true" className="absolute inset-0 hatch" />
                  )}
                </div>
                <h3 className="mt-4 text-[17px] font-semibold">{deptName}</h3>
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

      {/* Featured / "Trending now" — a real, standalone section with
          Leo's functional category-tab pattern layered on top (filters
          the already-fetched grid client-side, no extra request per tab). */}
      <ProductShowcaseSection
        sectionId="featured"
        headingId="featured-h"
        eyebrow={t("home.featuredEyebrow")}
        title={t("home.featuredTitle")}
        sub={t("home.featuredSub")}
        icon="featured"
        products={shopFeatured}
        departments={departments}
        viewAllHref="/shop?collection=featured"
        viewAllLabel={t("home.viewAllLower", { label: t("home.tabFeatured") })}
      />

      {/* Stay updated — EShopper's own newsletter band between its Trending
          and Just Arrived sections. Same real, shared form as the footer's
          newsletter column (components/layout/NewsletterForm.jsx). */}
      <section aria-labelledby="newsletter-h" className="container-x pt-32">
        <div className="flex flex-col items-center gap-5 rounded-3xl border border-line bg-media px-6 py-14 text-center sm:px-14">
          <h2 id="newsletter-h" className="text-[clamp(26px,2.6vw,34px)] font-semibold tracking-[-0.02em]">
            {t("footer.newsletterHeading")}
          </h2>
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-stone">
            {t("home.newsletterBandBody")}
          </p>
          <NewsletterForm theme="light" className="w-full max-w-[420px]" />
        </div>
      </section>

      {/* Just arrived — unscoped across the whole (clothing-only) catalog. */}
      <ProductShowcaseSection
        sectionId="new-arrivals"
        headingId="new-arrivals-h"
        eyebrow={t("home.newArrivalsEyebrow")}
        title={t("home.justLanded")}
        sub={t("home.justLandedSub")}
        icon="new"
        products={shopNew}
        viewAllHref="/shop?collection=new"
        viewAllLabel={t("home.viewAllLower", { label: t("home.tabNewArrival") })}
      />

      {/* Cosmetics / Jewelry / Home Decor — marketplace-expansion showcases.
          Each pulls real products filed under that exact category by an
          admin (services/productService.js scopes `category=<id>` to
          topCategory, matching only products genuinely assigned there in
          the product form) — nothing hardcoded, nothing sample-only. Only
          rendered when the category itself exists (it does in every seeded
          environment, but this stays defensive rather than assuming it). */}
      {cosmetics && (
        <ProductShowcaseSection
          sectionId="cosmetics"
          headingId="cosmetics-h"
          eyebrow={t("home.cosmeticsEyebrow")}
          title={t("home.cosmeticsTitle")}
          sub={t("home.cosmeticsSub")}
          icon="cosmetics"
          products={shopCosmetics}
          viewAllHref={`/shop?category=${cosmetics._id}`}
          viewAllLabel={t("home.viewAllLower", { label: t("home.tabCosmetics") })}
        />
      )}

      {jewelry && (
        <ProductShowcaseSection
          sectionId="jewelry"
          headingId="jewelry-h"
          eyebrow={t("home.jewelryEyebrow")}
          title={t("home.jewelryTitle")}
          sub={t("home.jewelrySub")}
          icon="jewelry"
          products={shopJewelry}
          viewAllHref={`/shop?category=${jewelry._id}`}
          viewAllLabel={t("home.viewAllLower", { label: t("home.tabJewelry") })}
        />
      )}

      {homeDecor && (
        <ProductShowcaseSection
          sectionId="home-decor"
          headingId="home-decor-h"
          eyebrow={t("home.homeDecorEyebrow")}
          title={t("home.homeDecorTitle")}
          sub={t("home.homeDecorSub")}
          icon="homeDecor"
          products={shopHomeDecor}
          viewAllHref={`/shop?category=${homeDecor._id}`}
          viewAllLabel={t("home.viewAllLower", { label: t("home.tabHomeDecor") })}
        />
      )}

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
              {fabricImages[f.value] ? (
                <Image
                  src={resolveImage(fabricImages[f.value], 500)}
                  alt=""
                  fill
                  sizes="(max-width: 1024px) 50vw, 20vw"
                  // object-top — see the department card's own comment
                  // above (same fixed-min-height-vs-arbitrary-upload issue).
                  className="object-cover object-top"
                />
              ) : (
                <div aria-hidden="true" className="absolute inset-0 hatch" />
              )}
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
              className="group relative flex min-h-[200px] flex-col justify-end overflow-hidden rounded-2xl border border-line p-6 transition-colors hover:border-ink focus-ring"
            >
              {occasionImages[o.value] && (
                <>
                  <Image
                    src={resolveImage(occasionImages[o.value], 500)}
                    alt=""
                    fill
                    sizes="(max-width: 1024px) 50vw, 25vw"
                    // object-top — see the department card's own comment
                    // above (same fixed-min-height-vs-arbitrary-upload issue).
                    className="object-cover object-top"
                  />
                  <div aria-hidden="true" className="absolute inset-0 scrim" />
                </>
              )}
              <div className="relative">
                <h3 className="text-[22px] font-semibold tracking-[-0.02em]">{t(o.nameKey)}</h3>
                <p className="mt-2 text-[13.5px] leading-[1.5] text-stone">{t(o.bodyKey)}</p>
                <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-verm">
                  {t("home.shopOccasion", { name: t(o.nameKey) })}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <GuidedFinderSection image={guidedFinderImage} />

      {/* Campaign — real, admin-configurable content (Shop Config →
          Campaign), kept; restyled from the old dark diagonal-line/italic-
          serif treatment to Leo's plain, restrained panel language (solid
          ink surface, no decorative texture) since Leo has no equivalent
          section of its own to copy directly. */}
      <section id="campaign" aria-labelledby="camp-h" className="container-x pt-32">
        <div className="rounded-3xl bg-ink px-8 py-14 text-canvas sm:px-14">
          <div className="max-w-[640px]">
            <div className="eyebrow text-canvas/60">{t("home.ourApproach")}</div>
            <h2 className="font-heading mt-4 text-[clamp(30px,3vw,44px)] font-extrabold leading-[1.05] tracking-[-0.02em] text-balance">
              {homepageSettings.campaign?.enabled && homepageSettings.campaign?.title
                ? homepageSettings.campaign.title
                : `${t("home.campaignTitle")} ${t("home.campaignTitleAccent")}`}
            </h2>
            <p className="mt-4 text-lg leading-[1.5] text-canvas/75 text-pretty">
              {homepageSettings.campaign?.enabled && homepageSettings.campaign?.message
                ? homepageSettings.campaign.message
                : t("home.campaignBody")}
            </p>
            <Link href={
              homepageSettings.campaign?.enabled && homepageSettings.campaign?.ctaHref
                ? homepageSettings.campaign.ctaHref
                : "/shop"
            } className="mt-7 inline-block">
              <Button variant="promo">
                {homepageSettings.campaign?.enabled && homepageSettings.campaign?.ctaLabel
                  ? homepageSettings.campaign.ctaLabel
                  : t("home.shopTheCollection")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
