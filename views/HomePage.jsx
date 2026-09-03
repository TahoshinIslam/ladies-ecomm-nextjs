"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useDispatch } from "react-redux";
import { motion } from "framer-motion";
import { ArrowRight, Pause, Play, RefreshCw, Shield, Truck } from "lucide-react";

import ProductCard from "../components/product/ProductCard.jsx";
import ProductCardSkeleton from "../components/product/ProductCardSkeleton.jsx";
import Button from "../components/ui/Button.jsx";
import { useGetProductsQuery } from "../store/productApi.js";
import { setFinderOpen } from "../store/uiSlice.js";
import { useSettings } from "../context/SettingsContext.jsx";
import { cn } from "../lib/utils.js";

/**
 * Editorial content is authored here rather than fetched — it is the store's
 * voice, not catalogue data, and the board treats it as fixed copy.
 *
 * Product rows come from the API. Until the catalogue is populated these fall
 * back to the reference rotation so the page never renders as empty shelves.
 */
const HERO_SLIDES = [
  { brand: "New Balance", name: "2002R", colorway: "Rain Cloud", price: 155, colors: 4, annotation: "Suede & mesh upper" },
  { brand: "Salomon", name: "XT-6", colorway: "Black & Phantom", price: 210, colors: 2, annotation: "Quicklace + Contagrip" },
  { brand: "Nike", name: "Air Max 1", colorway: "Sail & Medium Grey", price: 145, colors: 3, annotation: "Visible Air unit" },
];

const TRUST = [
  { icon: Truck, title: "Complimentary delivery", body: "On every order over $200, shipped within two business days." },
  { icon: RefreshCw, title: "Easy 14-day exchanges", body: "Wrong size? Send it back and we'll swap it, no questions." },
  { icon: Shield, title: "Secure checkout", body: "Encrypted payments with every major card and wallet." },
  { icon: ArrowRight, title: "Curated, not everything", body: "We only stock pairs the floor team actually wears." },
];

const CATEGORIES = [
  { num: "01", title: "Everyday", body: "Low-profile pairs that survive a full day on foot.", href: "/shop?category=everyday", cta: "Explore everyday", tone: "media", span: "tall" },
  { num: "02", title: "Performance", body: "Trail, track, and technical builds made to be used.", href: "/shop?category=performance", tone: "media", span: "wide" },
  { num: "03", title: "Statement", body: "The pair that gets asked about.", href: "/shop?category=statement", tone: "coral" },
  { num: "04", title: "After dark", body: "Reflective hits and late-night blacks.", href: "/shop?category=after-dark", tone: "night" },
];

const STAFF_PICKS = [
  { quote: "Wore these through three cities in a week and never thought about my feet once.", who: "[Staff name]", product: "Salomon XT-6" },
  { quote: "The Samba does everything. It's the shoe I recommend when someone only wants one pair.", who: "[Staff name]", product: "Adidas Samba OG" },
];

const shape = (id, brand, name, colorway, price, colors, isNew = false) => ({
  _id: id,
  slug: id,
  name,
  brand: { name: brand },
  colorway,
  colors,
  basePrice: price,
  images: [],
  isNew,
});

const FALLBACK_ROTATION = [
  shape("r1", "New Balance", "2002R", "Rain Cloud", 155, 4),
  shape("r2", "Adidas", "Samba OG", "Cloud White & Core Black", 110, 6),
  shape("r3", "Nike", "Air Max 1", "Sail & Medium Grey", 145, 3, true),
  shape("r4", "Asics", "Gel-1130", "Cream & Steel Grey", 130, 5),
  shape("r5", "Salomon", "XT-6", "Black & Phantom", 210, 2),
  shape("r6", "Puma", "Speedcat OG", "Team Regal Red", 100, 4),
  shape("r7", "New Balance", "990v6", "Grey Day", 210, 3),
  shape("r8", "Nike", "P-6000", "Summit White", 130, 2, true),
];

const FALLBACK_LANDED = [
  { ...shape("l1", "Adidas", "Gazelle Indoor", "Green & Off White", 110, 4, true), num: "01", drop: "Drop 02 · Aug" },
  { ...shape("l2", "Onitsuka Tiger", "Mexico 66", "Cream & Peacoat", 115, 3, true), num: "02", drop: "Drop 02 · Aug" },
  { ...shape("l3", "Hoka", "Clifton 9", "Shifting Sand", 145, 2, true), num: "03", drop: "Drop 02 · Aug" },
  { ...shape("l4", "Reebok", "Club C 85", "Chalk & Green", 90, 5, true), num: "04", drop: "Drop 02 · Aug" },
];

export default function HomePage() {
  const settings = useSettings();
  const dispatch = useDispatch();
  const [hero, setHero] = useState(0);
  const [videoPlaying, setVideoPlaying] = useState(false);

  // "The Rotation" is merchandising-curated (isFeatured), not sorted by a
  // rating that doesn't exist yet — no reviews have been collected, so there
  // is nothing real to rank by.
  const { data: rotationData, isLoading: rotationLoading } = useGetProductsQuery({
    limit: 8,
    featured: true,
  });
  const { data: landedData } = useGetProductsQuery({
    limit: 4,
    sort: "-createdAt",
  });

  const rotation = rotationData?.products?.length
    ? rotationData.products
    : FALLBACK_ROTATION;
  const landed = landedData?.products?.length
    ? landedData.products
    : FALLBACK_LANDED;

  const slide = HERO_SLIDES[hero];

  // Auto-advance the hero, but never while the user prefers reduced motion.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setHero((i) => (i + 1) % HERO_SLIDES.length), 6000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      {/* ------------------------------------------------------ Mobile hero
          (<768px only — see MobileHero below). */}
      <MobileHero slide={slide} dispatch={dispatch} settings={settings} />

      {/* ----------------------------------------------------- Tablet hero
          (768–1023px only — see TabletHero below). Desktop hero (1024px+)
          is untouched below this. */}
      <TabletHero slide={slide} dispatch={dispatch} settings={settings} />

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
              Drop 02 / City in Motion
            </div>
            <h1
              id="hero-h"
              className="mt-5 text-[clamp(56px,6.4vw,98px)] font-semibold leading-[0.9] tracking-[-0.045em] text-balance"
            >
              Find the pair
              <br />
              that moves{" "}
              <span className="font-serif font-normal italic tracking-[-0.01em]">
                like you.
              </span>
            </h1>
            <p className="mt-6 max-w-[42ch] text-xl leading-[1.5] text-stone text-pretty">
              Everyday icons, rare colorways, and all-day favorites—curated for
              wherever the day decides to go.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/shop?sort=-createdAt">
                <Button variant="accent" size="xl">
                  Shop new arrivals
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Button
                variant="outline"
                size="xl"
                onClick={() => dispatch(setFinderOpen(true))}
              >
                Find my pair
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-[18px] gap-y-2 font-mono text-[11.5px] uppercase tracking-[0.08em] text-stone">
              <span>Curated selection</span>
              <span className="opacity-40">·</span>
              <span>Easy exchanges</span>
              <span className="opacity-40">·</span>
              <span>Secure checkout</span>
            </div>
          </div>

          {/* Hero stage */}
          <div className="relative lg:col-span-7">
            <div className="absolute right-0 top-0 font-mono text-xs tracking-[0.14em] text-stone">
              0{hero + 1} / 0{HERO_SLIDES.length}
            </div>
            <div className="relative ml-auto aspect-5/4 w-full max-w-[760px]">
              <div
                aria-hidden="true"
                className="absolute inset-x-[4%] bottom-[8%] top-[6%] overflow-hidden rounded-3xl bg-media"
              >
                <div className="absolute inset-0 glow" />
                <div className="absolute inset-0 hatch" />
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
                <div className="absolute inset-0 grid place-items-center rounded-2xl border border-hair bg-wash">
                  <span className="px-6 text-center font-mono text-xs uppercase leading-[1.7] tracking-[0.1em] text-stone">
                    {slide.brand} {slide.name}
                  </span>
                </div>
                <div className="absolute left-[26%] top-[30%] hidden items-center gap-2.5 lg:flex">
                  <span className="h-[11px] w-[11px] rounded-full bg-verm shadow-[0_0_0_5px_rgba(255,61,33,0.18)]" />
                  <span className="whitespace-nowrap rounded-lg border border-line bg-elev px-2.5 py-[7px] text-[12.5px] font-medium">
                    {slide.annotation}
                  </span>
                </div>
              </motion.div>
            </div>

            <div className="mt-2 flex flex-wrap items-end justify-between gap-6">
              <div>
                <div className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-stone">
                  {slide.brand}
                </div>
                <div className="mt-1.5 text-[23px] font-semibold tracking-[-0.02em]">
                  {slide.name}
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[14.5px] text-stone">
                  <span data-tabular className="font-semibold text-ink">
                    {settings.formatPrice(slide.price)}
                  </span>
                  <span className="opacity-40">·</span>
                  <span>{slide.colorway}</span>
                  <span className="opacity-40">·</span>
                  <span>{slide.colors} colors</span>
                </div>
              </div>
              <div role="group" aria-label="Choose hero product" className="flex gap-2">
                {HERO_SLIDES.map((s, i) => (
                  <button
                    key={s.name}
                    onClick={() => setHero(i)}
                    aria-label={`Show ${s.brand} ${s.name}`}
                    aria-pressed={i === hero}
                    className={cn(
                      "relative h-[66px] w-[66px] overflow-hidden rounded-[10px] border bg-media transition-colors focus-ring",
                      i === hero ? "border-ink" : "border-line hover:border-ink",
                    )}
                  >
                    <span aria-hidden="true" className="absolute inset-0 hatch" />
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
        aria-label="Service benefits"
        className="hidden border-y border-line bg-surface lg:block"
      >
        <div className="container-x grid sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((t, i) => (
            <div
              key={t.title}
              className={cn(
                "flex items-start gap-3.5 py-[26px] pr-[30px]",
                i < TRUST.length - 1 && "lg:border-r lg:border-line",
              )}
            >
              <span
                aria-hidden="true"
                className="grid h-[34px] w-[34px] flex-none place-items-center rounded-lg border border-line text-verm"
              >
                <t.icon className="h-[17px] w-[17px]" strokeWidth={1.6} />
              </span>
              <div>
                <div className="text-[14.5px] font-semibold">{t.title}</div>
                <div className="mt-1 text-[13.5px] leading-[1.45] text-stone">
                  {t.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ Categories */}
      <section id="categories" aria-labelledby="cat-h" className="container-x pt-32">
        <SectionHead
          eyebrow="02 — Categories"
          title="Shop your pace"
          aside="Built for commutes, weekends, late nights, and everything between."
          id="cat-h"
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {CATEGORIES.map((c) => (
            <Link
              key={c.title}
              href={c.href}
              data-reveal
              className={cn(
                "group relative flex flex-col justify-end overflow-hidden rounded-3xl p-8 focus-ring",
                c.span === "tall" && "lg:row-span-2 lg:min-h-[560px]",
                c.span === "wide" && "lg:col-span-2 lg:min-h-[265px]",
                !c.span && "min-h-[275px]",
                c.tone === "media" && "bg-media",
                c.tone === "coral" && "bg-coral",
                c.tone === "night" && "bg-[#101012]",
              )}
            >
              {c.tone === "media" && (
                <>
                  <div aria-hidden="true" className="absolute inset-0 hatch" />
                  <div aria-hidden="true" className="absolute inset-0 scrim" />
                </>
              )}
              {c.tone === "night" && (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-[radial-gradient(90%_70%_at_70%_20%,rgba(212,255,69,0.14),transparent_60%)]"
                />
              )}
              <div
                className={cn(
                  "relative",
                  c.tone === "coral" && "text-[#101012]",
                  c.tone === "night" && "text-[#F5F2EA]",
                )}
              >
                <div
                  className={cn(
                    "font-mono text-[11px] uppercase tracking-[0.14em]",
                    c.tone === "night" ? "text-lime" : "text-verm",
                    c.tone === "coral" && "text-[#101012]",
                  )}
                >
                  {c.num}
                </div>
                <h3
                  className={cn(
                    "mt-2.5 font-semibold leading-none tracking-[-0.03em]",
                    c.span === "tall" ? "text-[44px]" : c.span === "wide" ? "text-[38px]" : "text-[34px]",
                  )}
                >
                  {c.title}
                </h3>
                <p
                  className={cn(
                    "mt-2.5 max-w-[32ch] text-base leading-[1.45]",
                    c.tone === "night"
                      ? "text-[rgba(245,242,234,0.66)]"
                      : c.tone === "coral"
                        ? "opacity-70"
                        : "text-stone",
                  )}
                >
                  {c.body}
                </p>
                {c.cta && (
                  <span className="mt-4 inline-flex items-center gap-2 text-[14.5px] font-semibold">
                    {c.cta}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- Rotation */}
      <section id="rotation" aria-labelledby="rot-h" className="container-x pt-32">
        <SectionHead
          eyebrow="03 — Best sellers"
          title="The Rotation"
          sub="The pairs people keep reaching for."
          id="rot-h"
          bordered
          action={
            <Link href="/shop?featured=true">
              <Button variant="subtle" size="lg">
                See the rotation
                <ArrowRight className="h-[15px] w-[15px]" />
              </Button>
            </Link>
          }
        />
        <div className="mt-9 grid grid-cols-2 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rotationLoading
            ? Array.from({ length: 8 }, (_, i) => <ProductCardSkeleton key={i} />)
            : rotation.map((p, i) => (
                <ProductCard key={p._id} product={p} index={i} />
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
            <div className="eyebrow">04 — Guided discovery</div>
            <h2
              id="finder-h"
              className="mt-4 text-[clamp(32px,3.2vw,46px)] font-semibold leading-[1.02] tracking-[-0.03em]"
            >
              Not sure where to start?
            </h2>
            <p className="mt-3.5 max-w-[36ch] text-xl leading-[1.5] text-stone">
              Tell us how you move. We&rsquo;ll narrow the rotation.
            </p>
            <Button
              variant="primary"
              size="xl"
              className="mt-7"
              onClick={() => dispatch(setFinderOpen(true))}
            >
              Find my pair
              <ArrowRight className="h-4 w-4" />
            </Button>
            <div className="mt-[22px] font-mono text-[11px] uppercase tracking-[0.1em] text-stone">
              3 questions · no account needed
            </div>
          </div>
          <div className="relative hidden min-h-[340px] border-l border-line bg-media lg:grid lg:place-items-center">
            <div aria-hidden="true" className="absolute inset-0 hatch" />
            <div className="relative flex gap-3.5">
              <span className="rounded-lg border border-line bg-elev px-4 py-2.5 text-[14.5px] font-medium">
                Commute
              </span>
              <span className="rounded-lg bg-verm px-4 py-2.5 text-[14.5px] font-medium text-white">
                Miles
              </span>
              <span className="rounded-lg border border-line bg-elev px-4 py-2.5 text-[14.5px] font-medium">
                Nights out
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- Just landed */}
      <section id="just-landed" aria-labelledby="jl-h" className="pt-32">
        <div className="container-x">
          <SectionHead
            eyebrow="05 — New arrivals"
            title="Just landed"
            sub="New pairs, before everyone else finds them."
            id="jl-h"
          />
        </div>
        <div className="container-x mt-11 grid grid-cols-2 gap-5 lg:grid-cols-3 xl:grid-cols-4">
          {landed.map((p, i) => (
            <div key={p._id} className="flex flex-col">
              {p.num && (
                <div className="flex items-baseline gap-2.5 border-b border-line pb-3">
                  <span className="font-mono text-xs tracking-[0.1em] text-verm">
                    {p.num}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-stone">
                    {p.drop}
                  </span>
                </div>
              )}
              <div className={cn(p.num && "mt-4")}>
                <ProductCard product={p} index={i} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- Campaign */}
      <section
        id="campaign"
        aria-labelledby="camp-h"
        className="relative mt-32 overflow-hidden bg-[#101012] text-[#F5F2EA]"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[repeating-linear-gradient(115deg,rgba(245,242,234,0.05)_0_1px,transparent_1px_14px)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(80%_100%_at_78%_40%,rgba(255,61,33,0.16),transparent_62%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-0 hidden w-[58%] border-l border-[rgba(245,242,234,0.12)] lg:block"
        >
          <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(245,242,234,0.06)_0_1px,transparent_1px_12px)]" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,#101012_0%,rgba(16,16,18,0.55)_26%,rgba(16,16,18,0)_60%)]" />
        </div>

        <div className="container-x relative grid min-h-[640px] items-center lg:grid-cols-12">
          <div className="z-[2] py-24 lg:col-span-6">
            <div className="flex items-center gap-3 font-mono text-[11.5px] uppercase tracking-[0.16em] text-[rgba(245,242,234,0.6)]">
              <span className="h-px w-[22px] bg-verm" />
              06 — Journal
            </div>
            <h2
              id="camp-h"
              className="mt-6 text-[clamp(44px,5.2vw,78px)] font-semibold leading-[0.94] tracking-[-0.04em] text-balance"
            >
              Made for the miles{" "}
              <span className="font-serif font-normal italic">between plans.</span>
            </h2>
            <p className="mt-6 max-w-[40ch] text-xl leading-[1.5] text-[rgba(245,242,234,0.7)] text-pretty">
              From the first train to the last stop, find the pair that keeps up.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3.5">
              <Link href="/shop?category=everyday">
                <span className="inline-flex h-[52px] items-center gap-2.5 rounded-[9px] bg-[#F5F2EA] px-6 text-[15.5px] font-semibold text-[#101012] transition-colors hover:bg-verm hover:text-white">
                  Explore everyday sneakers
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
              <button
                onClick={() => setVideoPlaying((v) => !v)}
                aria-label={videoPlaying ? "Pause campaign film" : "Play campaign film"}
                className="inline-flex h-[52px] items-center gap-2.5 rounded-[9px] border border-[rgba(245,242,234,0.28)] px-5 text-[14.5px] font-medium text-[#F5F2EA] transition-colors hover:border-[#F5F2EA] focus-ring"
              >
                {videoPlaying ? (
                  <Pause className="h-[15px] w-[15px]" fill="currentColor" />
                ) : (
                  <Play className="h-[15px] w-[15px]" fill="currentColor" />
                )}
                {videoPlaying ? "Pause film" : "Play film"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- Staff picks */}
      <section aria-labelledby="staff-h" className="container-x pt-32">
        <SectionHead
          eyebrow="07 — From the floor"
          title="Staff picks"
          id="staff-h"
          bordered
          aside="What the people who sell them actually reach for."
        />
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <blockquote
            data-reveal
            className="flex flex-col justify-between gap-10 rounded-3xl border border-line bg-surface p-12"
          >
            <p className="font-serif text-[clamp(28px,2.8vw,42px)] leading-[1.15] tracking-[-0.02em]">
              &ldquo;The 2002R is the one I hand to people who say they
              can&rsquo;t wear <span className="italic">chunky</span> shoes. It
              disappears on the foot after a block.&rdquo;
            </p>
            <footer className="flex items-center gap-4">
              <span className="h-[52px] w-[52px] rounded-full border border-line bg-media" />
              <div>
                <div className="text-[15px] font-semibold">[Staff name]</div>
                <div className="mt-0.5 font-mono text-[11.5px] uppercase tracking-[0.08em] text-stone">
                  [Role] · Tahos floor team
                </div>
              </div>
            </footer>
          </blockquote>
          <div className="grid gap-5">
            {STAFF_PICKS.map((s) => (
              <div
                key={s.product}
                data-reveal
                className="flex items-center gap-5 rounded-[20px] border border-line p-7"
              >
                <div className="relative aspect-square w-24 flex-none overflow-hidden rounded-xl bg-media">
                  <div aria-hidden="true" className="absolute inset-0 hatch" />
                </div>
                <div>
                  <p className="text-base leading-[1.45]">{s.quote}</p>
                  <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-stone">
                    {s.who} · {s.product}
                  </div>
                </div>
              </div>
            ))}
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
 *
 * Sized so the whole stack — drop label through trust cards — fits the
 * first viewport above the fixed bottom nav on a real phone, not just the
 * reference's single 390×844 frame: the stage is a flatter 2:1 plate rather
 * than the reference's taller 390:268 crop, and every gap between blocks is
 * pulled in to match, so nothing (CTAs, trust cards) gets pushed below the
 * fold on shorter devices.
 *
 * The stage bleeds to the true viewport edge via a negative margin that
 * exactly cancels this section's own horizontal padding — both expressed as
 * the same clamp(), so the bleed stays exact at any width in the mobile range.
 */
function MobileHero({ slide, dispatch, settings }) {
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
        Drop 02 / City in Motion
      </motion.div>

      <motion.h1
        id="hero-h-mobile"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        className="relative mt-2 text-[32px] font-semibold leading-[0.98] tracking-[-0.035em]"
      >
        Find the pair that moves{" "}
        <span className="font-serif font-normal italic">like you.</span>
      </motion.h1>

      {/* HeroProductStage — flatter than the reference's 390:268 crop so it
          stops dominating the viewport; still full-bleed with pagination. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="relative mt-3 aspect-[2/1]"
        style={{ marginInline: `calc(-1 * ${gutter})` }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-2xl bg-media">
          <div aria-hidden="true" className="absolute inset-0 hatch" />
          <div aria-hidden="true" className="absolute inset-0 glow" />
          <div className="absolute inset-x-[10%] bottom-[14%] top-[12%] grid place-items-center">
            <div
              aria-hidden="true"
              className="absolute inset-x-[6%] -bottom-[4%] h-[18%] contact-shadow"
            />
            <span className="px-6 text-center font-mono text-[9.5px] uppercase leading-[1.7] tracking-[0.08em] text-stone">
              {slide.brand} {slide.name}
            </span>
          </div>
          <div className="absolute bottom-[10px] left-3.5 font-mono text-[9.5px] tracking-[0.1em] text-stone">
            0{HERO_SLIDES.indexOf(slide) + 1} / 0{HERO_SLIDES.length}
          </div>
        </div>
      </motion.div>

      <div className="relative mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-stone">
            {slide.brand}
          </div>
          <div className="mt-0.5 truncate text-[15px] font-semibold tracking-[-0.02em]">
            {slide.name} · {slide.colorway}
          </div>
        </div>
        <div data-tabular className="flex-none text-[15px] font-semibold">
          {settings.formatPrice(slide.price)}
        </div>
      </div>

      {/* CTA row */}
      <div className="relative mt-3 flex gap-2">
        <Link href="/shop?sort=-createdAt" className="flex-1">
          <span className="flex h-12 items-center justify-center rounded-[10px] bg-verm text-sm font-semibold text-white transition-transform active:scale-[0.975]">
            Shop new arrivals
          </span>
        </Link>
        <button
          onClick={() => dispatch(setFinderOpen(true))}
          className="flex h-12 items-center justify-center whitespace-nowrap rounded-[10px] border border-ink px-4 text-sm font-semibold transition-transform active:scale-[0.975]"
        >
          Find my pair
        </button>
      </div>

    </section>
  );
}

/**
 * A dedicated hero for 768–1023px — previously this band just got the
 * desktop hero's 12-column grid collapsed to one column (`lg:grid-cols-12`
 * has no columns below `lg`), which stacked the full desktop composition
 * (98px-capable heading, 5:4 stage) into something far taller than the
 * viewport with none of the intentionality of either the phone or desktop
 * treatment.
 *
 * This keeps the single-column shape — a true two-column split gets tight
 * fast in a ~700px content width — but sizes every piece for it: a fixed
 * heading size instead of desktop's clamp up to 98px, and a flatter 2:1
 * stage instead of 5:4, so the whole hero settles into a sane height rather
 * than the previous stack.
 */
function TabletHero({ slide, dispatch, settings }) {
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
            Drop 02 / City in Motion
          </div>
          <h1
            id="hero-h-tablet"
            className="mt-4 text-[46px] font-semibold leading-[0.98] tracking-[-0.04em]"
          >
            Find the pair that moves{" "}
            <span className="font-serif font-normal italic tracking-[-0.01em]">
              like you.
            </span>
          </h1>
          <p className="mt-4 max-w-[46ch] text-lg leading-[1.5] text-stone">
            Everyday icons, rare colorways, and all-day favorites—curated for
            wherever the day decides to go.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/shop?sort=-createdAt">
              <Button variant="accent" size="lg">
                Shop new arrivals
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Button
              variant="outline"
              size="lg"
              onClick={() => dispatch(setFinderOpen(true))}
            >
              Find my pair
            </Button>
          </div>
        </div>

        {/* HeroProductStage — flatter than desktop's 5:4 so a full-width
            plate at this content width doesn't run tall. */}
        <div className="relative mt-10 aspect-[2/1] w-full overflow-hidden rounded-3xl bg-media">
          <div aria-hidden="true" className="absolute inset-0 hatch" />
          <div aria-hidden="true" className="absolute inset-0 glow" />
          <div className="absolute inset-x-[8%] bottom-[12%] top-[10%] grid place-items-center">
            <div
              aria-hidden="true"
              className="absolute inset-x-[6%] -bottom-[3%] h-[16%] contact-shadow"
            />
            <span className="px-6 text-center font-mono text-xs uppercase leading-[1.7] tracking-[0.1em] text-stone">
              {slide.brand} {slide.name}
            </span>
          </div>
          <div className="absolute bottom-4 left-5 font-mono text-xs tracking-[0.14em] text-stone">
            0{HERO_SLIDES.indexOf(slide) + 1} / 0{HERO_SLIDES.length}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-stone">
              {slide.brand}
            </div>
            <div className="mt-1 text-lg font-semibold tracking-[-0.02em]">
              {slide.name} · {slide.colorway}
            </div>
          </div>
          <div data-tabular className="text-lg font-semibold">
            {settings.formatPrice(slide.price)}
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

function NewsletterPoster() {
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
    idle: "One or two a month. Unsubscribe in a click.",
    invalid: "That email doesn't look right — check for a typo.",
    loading: "Signing you up…",
    success: "You're in. Watch for Drop 03.",
  }[state];

  return (
    <section aria-labelledby="news-h" className="container-x pt-32">
      <div
        data-reveal
        className="relative grid overflow-hidden rounded-[26px] bg-ink text-canvas lg:grid-cols-[1.35fr_1fr]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-8 right-[38%] text-[300px] font-bold leading-[0.8] tracking-[-0.06em] opacity-[0.06]"
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

        <div className="relative px-8 py-16 sm:px-14">
          <div className="font-mono text-[11.5px] uppercase tracking-[0.18em] text-verm">
            Tahos Notes
          </div>
          <h2
            id="news-h"
            className="mt-4 text-[clamp(38px,4.2vw,60px)] font-semibold leading-[0.98] tracking-[-0.035em]"
          >
            Good shoes.
            <br />
            Better inbox.
          </h2>
          <p className="mt-4 max-w-[38ch] text-[19px] leading-[1.5] text-[rgba(245,242,234,0.66)]">
            New drops, restocks, and edits worth opening. No daily noise.
          </p>

          <form onSubmit={submit} className="mt-8 max-w-[520px]">
            <label
              htmlFor="nl"
              className="block font-mono text-[11px] uppercase tracking-[0.12em] text-[rgba(245,242,234,0.6)]"
            >
              Email address
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
                placeholder="Email address"
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
                {state === "success" ? "Subscribed" : "Sign up"}
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

        <div className="relative hidden min-h-[380px] border-l border-[rgba(245,242,234,0.14)] bg-[#17171A] lg:block">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(245,242,234,0.06)_0_1px,transparent_1px_12px)]"
          />
        </div>
      </div>
    </section>
  );
}
