import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import Button from "../components/ui/Button.jsx";
import ProductCard from "../components/product/ProductCard.jsx";
import HeroCarousel from "./home/HeroCarousel.jsx";
import ProductShowcaseSection from "./home/ProductShowcaseSection.jsx";
import GuidedFinderSection from "./home/GuidedFinderSection.jsx";
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

const DEPARTMENT_COPY = {
  burqa: { num: "01", bodyKey: "catalog.deptBurqaBody", tone: "media" },
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
  // Sorted into the deliberate 01-06 hero-grid order DEPARTMENT_COPY
  // encodes (Burqa tall, Abaya wide, then the four plain default cards) —
  // NOT the incidental order getCachedCategories() happens to return.
  // Category.find() there sorts by sortOrder then name (services/
  // categoryService.js), and every seeded department ties on sortOrder=0,
  // so without this the grid below falls back to alphabetical order
  // (Abaya, Burqa, Hijab, Khimar, Modest Sets, Niqab) — CSS grid
  // auto-placement assigns the tall/wide spans to whichever items land
  // first, so Abaya (not Burqa) would get the (row1,col1) hero slot,
  // Burqa's tall span would land wherever auto-placement finds room next
  // (typically the far column), and Hijab would end up squeezed into
  // whatever default-sized cell is left over next to it — exactly the
  // "doesn't fit / stuck at a fixed size next to a huge neighbor" layout
  // a shopper would see, even though each card's OWN min-height math is
  // correct in isolation. A department with no entry in DEPARTMENT_COPY
  // (none expected today, but not fatal if the catalog grows) sorts after
  // all six known ones, in whatever relative order it already had.
  const departments = categories
    .filter((c) => !c.parent)
    .sort((a, b) => (Number(DEPARTMENT_COPY[a.slug]?.num) || 99) - (Number(DEPARTMENT_COPY[b.slug]?.num) || 99));

  // The tall/wide hero spans below only tessellate cleanly across the
  // full curated 6-department set (see the grid's own className comment).
  // A store still filling out its catalog (e.g. only Burqa + Hijab so
  // far) gets a plain, gapless auto-fit grid instead.
  const hasFullMosaic = departments.length >= Object.keys(DEPARTMENT_COPY).length;

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

  // Two standalone shop-wide showcases — New Arrivals and Featured, each
  // its own section (see ProductShowcaseSection.jsx) rather than tabs
  // sharing one section. This is a clothing-only shop with no single "all
  // clothes" department id to scope by (every department is its own root
  // now), so both are unscoped across the whole catalog, using the shop's
  // own canonical `collection=` values.
  const [heroBurqa, heroAbaya, heroHijab, heroKhimar, shopNew, shopFeatured, collectionItems] = await Promise.all([
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
    // Feeds the Collection feature panel below — a real 3-product spotlight
    // for the Abaya department, not placeholder cards.
    abaya ? fetchProducts({ limit: 3, category: abaya._id, sort: "-rating" }) : Promise.resolve([]),
  ]);

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
      <HeroCarousel departments={departments} heroImageBySlug={heroImageBySlug} />

      {/* Departments */}
      <section id="departments" aria-labelledby="dept-h" className="container-x pt-32">
        <SectionHead
          eyebrow={t("home.departmentsEyebrow")}
          title={t("home.shopByDepartment")}
          aside={t("home.departmentsSub")}
          id="dept-h"
        />
        <div
          className={cn(
            "mt-12 grid grid-cols-2 gap-4",
            // Leo's category grid: 6 equal-height columns, first tile wide
            // (span 2) — a single uniform row, not a tall/wide mosaic. Below
            // the full curated set (a store still filling out its catalog),
            // fall back to auto-fit tracks so 1-5 departments still fill the
            // row completely instead of leaving empty grid cells.
            hasFullMosaic
              ? "lg:grid-cols-6 lg:auto-rows-[220px]"
              : "sm:grid-cols-3 lg:[grid-template-columns:repeat(auto-fit,minmax(220px,1fr))] lg:auto-rows-[220px]",
          )}
        >
          {departments.map((d) => {
            const copy = DEPARTMENT_COPY[d.slug] || { num: "•", bodyKey: null, tone: "media" };
            const span = hasFullMosaic ? copy.span : undefined;
            const deptName = departmentName(locale, d.slug, d.name);
            // Admin-set department-card photo (Shop Config → Departments)
            // takes priority; "media"-tone departments fall back to their
            // existing top-rated-product/carousel photo when unset. A
            // coral/night-tone department (hijab, modest-sets, niqab) has
            // no such fallback — it stays a plain solid-color card until
            // an admin sets one here.
            const deptImage = departmentImages[d.slug] || (copy.tone === "media" ? heroImageBySlug[d.slug] : null);
            return (
              <Link
                key={d._id}
                href={`/shop?category=${d._id}`}
                data-reveal
                className={cn(
                  "group relative flex min-h-[190px] flex-col justify-end overflow-hidden rounded-xl p-4 focus-ring",
                  span === "wide" && "col-span-2",
                  copy.tone === "media" && "bg-media",
                  copy.tone === "coral" && "bg-coral",
                  // Fixed hex, not the `ink` token: this "night" tile is
                  // deliberately always-dark regardless of site theme —
                  // `ink` itself flips to near-white in dark mode.
                  copy.tone === "night" && "bg-[#181a18]",
                )}
              >
                {deptImage ? (
                  <Image
                    src={resolveImage(deptImage, 700)}
                    alt=""
                    fill
                    sizes="(max-width: 1024px) 100vw, 33vw"
                    className="object-cover object-top transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                ) : copy.tone === "media" ? (
                  <div aria-hidden="true" className="absolute inset-0 hatch" />
                ) : null}
                {/* Leo's category tile: one bold white label over a bottom
                    gradient scrim — no eyebrow number, no body copy, no
                    "explore" link. The department name and photo carry it. */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-ink/65 via-ink/0 to-transparent"
                />
                <h3 className="relative font-heading text-[19px] font-bold leading-none text-[#fafaf7]">
                  {deptName}
                </h3>
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

      {/* New Arrivals — its own section now, not a tab sharing space with
          Featured/Bestseller/Discount. Unscoped across the whole
          (clothing-only) catalog. */}
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

      {/* Collection feature panel — Leo's split composition: a solid
          accent-green panel (copy + CTA) beside a real 3-product spotlight,
          in one bordered block. Only renders when the Abaya department has
          products to show — no placeholder cards. */}
      {abaya && collectionItems.length > 0 && (
        <section aria-labelledby="collection-h" className="container-x pt-32">
          <div className="grid overflow-hidden rounded-3xl border border-line lg:grid-cols-[minmax(280px,340px)_1fr]">
            <div className="flex flex-col justify-center bg-verm px-8 py-12 sm:px-10">
              <div className="eyebrow text-lime">{t("home.collectionEyebrow")}</div>
              <h2 id="collection-h" className="mt-3 text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-accent-foreground">
                {t("home.collectionTitle", { name: departmentName(locale, abaya.slug, abaya.name) })}
              </h2>
              <p className="mt-3 max-w-[32ch] text-[14.5px] leading-relaxed text-accent-foreground/85">
                {t("home.collectionBody", { name: departmentName(locale, abaya.slug, abaya.name) })}
              </p>
              <Link href={`/shop?category=${abaya._id}`} className="mt-6">
                <Button variant="promo">{t("home.collectionCta")}</Button>
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-3 sm:p-8">
              {collectionItems.map((p, i) => (
                <ProductCard key={p._id} product={p} index={i} />
              ))}
            </div>
          </div>
        </section>
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
