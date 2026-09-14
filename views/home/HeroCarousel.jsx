"use client";

// Phase 7 — the home page's only genuinely stateful visual piece: the
// rotating hero (auto-advance timer + click-to-select) across its three
// responsive variants (mobile/tablet/desktop). `departments` and
// `heroImageBySlug` arrive as plain, already-serialized props from the
// Server Component (views/HomePage.jsx) — no client fetch is needed to
// see the real department names/photos.
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useDispatch } from "react-redux";
import { motion } from "framer-motion";
import { ArrowRight, Pause, Play } from "lucide-react";

import Button from "../../components/ui/Button.jsx";
import { setFinderOpen } from "../../store/uiSlice.js";
import { useLocale } from "../../context/LocaleProvider.jsx";
import { departmentName } from "../../lib/i18n/catalog.js";
import { cn, resolveImage } from "../../lib/utils.js";

const DEPARTMENT_ROTATION_SLUGS = ["burqa", "abaya", "hijab"];

const DEPARTMENT_COPY = {
  burqa: { bodyKey: "catalog.deptBurqaBody" },
  abaya: { bodyKey: "catalog.deptAbayaBody" },
  hijab: { bodyKey: "catalog.deptHijabBody" },
};

export default function HeroCarousel({ departments, heroImageBySlug }) {
  const { t, locale } = useLocale();
  const dispatch = useDispatch();
  const [hero, setHero] = useState(0);
  // Three independent reasons the auto-advance can be paused — a manual
  // user toggle (persists until toggled back), pointer hover, and
  // keyboard focus landing anywhere in the hero (WCAG 2.2.2 Pause, Stop,
  // Hide requires BOTH an on-page control and pausing on hover/focus).
  const [userPaused, setUserPaused] = useState(false);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );
  const paused = userPaused || interactionPaused || reducedMotion;

  const heroSlug = DEPARTMENT_ROTATION_SLUGS[hero];
  const heroDept = departments.find((d) => d.slug === heroSlug);
  const heroImage = heroImageBySlug[heroSlug] || null;
  const slide = {
    name: departmentName(locale, heroSlug, heroDept?.name),
    tagline: t(DEPARTMENT_COPY[heroSlug]?.bodyKey || "common.loading"),
    image: heroImage,
    loading: false,
  };

  // Live-tracks prefers-reduced-motion (a one-time check at mount would
  // miss the user toggling it mid-session, e.g. via OS settings while the
  // tab stays open).
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(
      () => setHero((i) => (i + 1) % DEPARTMENT_ROTATION_SLUGS.length),
      6000,
    );
    return () => clearInterval(timer);
  }, [paused]);

  const pauseProps = {
    paused: userPaused,
    onTogglePause: () => setUserPaused((p) => !p),
    onInteractionPause: () => setInteractionPaused(true),
    onInteractionResume: () => setInteractionPaused(false),
  };

  return (
    <>
      <MobileHero slide={slide} dispatch={dispatch} {...pauseProps} />
      <TabletHero slide={slide} dispatch={dispatch} {...pauseProps} />

      {/* ------------------------------------------------------------ Hero */}
      <section
        aria-labelledby="hero-h"
        className="relative hidden overflow-hidden lg:block"
        onMouseEnter={() => setInteractionPaused(true)}
        onMouseLeave={() => setInteractionPaused(false)}
        onFocus={() => setInteractionPaused(true)}
        onBlur={() => setInteractionPaused(false)}
      >
        <div className="container-x grid min-h-0 items-center gap-12 py-20 lg:grid-cols-2">
          <div className="relative z-[2]">
            <div className="eyebrow">{t("home.heroEyebrow")}</div>
            <h1
              id="hero-h"
              className="font-heading mt-4 text-[clamp(44px,4.6vw,64px)] font-extrabold leading-[0.98] tracking-[-0.02em] text-balance"
            >
              {t("home.heroTitle")} {t("home.heroTitleAccent")}
            </h1>
            <p className="mt-5 max-w-[42ch] text-lg leading-[1.5] text-stone text-pretty">
              {t("home.heroSubtitle")}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/shop?collection=new">
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

          {/* Hero stage — a single, near-full-bleed rounded image per slide
              (Leo's leo-hero-media: aspect 4:3, radius-xl) with a solid
              white floating badge card in the bottom-left corner,
              replacing the old blurred-backdrop-plus-inset-floating-card
              treatment. The underlying department rotation is a real
              feature (Leo's own hero is a single static banner) — only its
              presentation changed. */}
          <div className="relative">
            <motion.div
              key={hero}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
              className="relative aspect-4/3 w-full overflow-hidden rounded-3xl bg-media"
            >
              {slide.image ? (
                <Image
                  src={resolveImage(slide.image, 900)}
                  alt={slide.name}
                  fill
                  sizes="50vw"
                  fetchPriority="high"
                  className="object-cover object-center"
                />
              ) : (
                <>
                  <div aria-hidden="true" className="absolute inset-0 hatch" />
                  <span className="absolute inset-0 grid place-items-center px-6 text-center text-sm uppercase tracking-[0.1em] text-stone">
                    {slide.name}
                  </span>
                </>
              )}
              <div className="absolute bottom-4 left-4 rounded-lg bg-surface px-4 py-3 shadow-md">
                <div className="text-[15px] font-semibold">{slide.name}</div>
                <div className="text-[13px] text-stone">{slide.tagline}</div>
              </div>
            </motion.div>

            <div className="mt-4 flex items-center justify-between gap-4">
              <div role="group" aria-label={t("home.chooseDepartment")} className="flex gap-2">
                {DEPARTMENT_ROTATION_SLUGS.map((slug, i) => (
                  <button
                    key={slug}
                    onClick={() => setHero(i)}
                    aria-label={t("home.showDepartment", { name: departments.find((d) => d.slug === slug)?.name || slug })}
                    aria-pressed={i === hero}
                    className={cn(
                      "h-2 rounded-full transition-[width,background-color] focus-ring",
                      i === hero ? "w-6 bg-verm" : "w-2 bg-line hover:bg-stone",
                    )}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setUserPaused((p) => !p)}
                aria-pressed={userPaused}
                aria-label={userPaused ? t("home.resumeRotation") : t("home.pauseRotation")}
                className="grid h-9 w-9 flex-none place-items-center rounded-full border border-line text-ink transition-colors hover:border-ink focus-ring"
              >
                {userPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * The mobile app shell's hero: HeroProductStage + TrustRail.
 * <768px only — `<Header>`'s mobile bar and `<MobileNav>` are this page's
 * counterparts for the rest of the shell (both untouched here).
 */
function MobileHero({ slide, dispatch, paused, onTogglePause, onInteractionPause, onInteractionResume }) {
  const { t } = useLocale();
  const gutter = "clamp(20px,4vw,56px)";

  return (
    <section
      aria-labelledby="hero-h-mobile"
      className="relative overflow-hidden pb-2 pt-4 md:hidden"
      style={{ paddingInline: gutter }}
      onMouseEnter={onInteractionPause}
      onMouseLeave={onInteractionResume}
      onFocus={onInteractionPause}
      onBlur={onInteractionResume}
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
        className="eyebrow relative flex items-center gap-2"
      >
        <span className="h-px w-4 bg-verm" />
        {t("home.heroEyebrow")}
      </motion.div>

      <motion.h1
        id="hero-h-mobile"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        className="font-heading relative mt-2 text-[32px] font-extrabold leading-[0.98] tracking-[-0.02em]"
      >
        {t("home.heroTitle")} {t("home.heroTitleAccent")}
      </motion.h1>

      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        // aspect-5/4 (same ratio as the desktop hero's own stage above),
        // not the old full-bleed aspect-[2/1] this replaced, nor the
        // portrait aspect-4/5 that briefly replaced THAT: this box holds a
        // multi-model group photo (several people standing side by side),
        // not a single product/PDP-style portrait shot — a tall 4/5 box
        // forced object-cover to zoom in until the box's height was
        // filled, cropping the two outer models down to a sliver on
        // narrow phones (the actual reported bug). 5/4 keeps the same
        // side gutter as the eyebrow/heading/buttons above and below it
        // (no edge-to-edge bleed) while giving the photo enough width that
        // cover only needs a modest crop to fill it.
        className="relative mt-3 aspect-5/4 max-h-[420px]"
      >
        <div className="absolute inset-0 overflow-hidden rounded-2xl bg-media">
          {slide.image ? (
            // See the desktop hero's own comment above: plain
            // `loading="lazy"` (default) + `fetchPriority="high"`, never
            // "eager" — this section is `md:hidden`, so lazy is what
            // actually stops this variant from being fetched once the
            // viewport is >=768px.
            <Image
              src={resolveImage(slide.image, 700)}
              alt={slide.name}
              fill
              sizes="100vw"
              fetchPriority="high"
              // See the desktop hero's own comment above: object-cover +
              // object-center fills the box (no more left/right gaps),
              // cropped to the rounded wrapper's existing overflow-hidden;
              // scale-[1.02] only to erase a subpixel edge sliver.
              className="scale-[1.02] object-cover object-center"
            />
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
        <button
          type="button"
          onClick={onTogglePause}
          aria-pressed={paused}
          aria-label={paused ? t("home.resumeRotation") : t("home.pauseRotation")}
          className="grid h-9 w-9 flex-none place-items-center rounded-full border border-line text-ink transition-colors hover:border-ink focus-ring"
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="relative mt-3 flex gap-2">
        <Link href="/shop?collection=new" className="flex-1">
          <span className="flex h-12 items-center justify-center rounded-[10px] bg-verm-contrast text-sm font-semibold text-white transition-transform active:scale-[0.975]">
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
function TabletHero({ slide, dispatch, paused, onTogglePause, onInteractionPause, onInteractionResume }) {
  const { t } = useLocale();
  return (
    <section
      aria-labelledby="hero-h-tablet"
      className="relative hidden overflow-hidden md:block lg:hidden"
      onMouseEnter={onInteractionPause}
      onMouseLeave={onInteractionResume}
      onFocus={onInteractionPause}
      onBlur={onInteractionResume}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-[6%] right-[-3%] select-none text-[clamp(100px,18vw,170px)] font-bold leading-[0.8] tracking-[-0.06em] text-ink opacity-[0.045]"
      >
        TAHOS
      </div>

      <div className="container-x relative py-16">
        <div className="max-w-[520px]">
          <div className="eyebrow flex items-center gap-3">
            <span className="h-px w-5 bg-verm" />
            {t("home.heroEyebrow")}
          </div>
          <h1
            id="hero-h-tablet"
            className="font-heading mt-4 text-[46px] font-extrabold leading-[0.98] tracking-[-0.02em]"
          >
            {t("home.heroTitle")} {t("home.heroTitleAccent")}
          </h1>
          <p className="mt-4 max-w-[46ch] text-lg leading-[1.5] text-stone">
            {t("home.heroSubtitleShort")}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/shop?collection=new">
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

        <div className="relative mt-10 aspect-5/4 w-full overflow-hidden rounded-3xl bg-media">
          {slide.image ? (
            // Same reasoning as the desktop/mobile hero variants above:
            // plain `loading="lazy"` (default) + `fetchPriority="high"`,
            // never "eager" — this section is `hidden md:block lg:hidden`,
            // so lazy is what stops this variant from fetching outside
            // the 768–1023px range.
            <Image
              src={resolveImage(slide.image, 1200)}
              alt={slide.name}
              fill
              sizes="100vw"
              fetchPriority="high"
              // See the desktop hero's own comment above: object-cover +
              // object-center fills the box (no more left/right gaps),
              // cropped to the rounded wrapper's existing overflow-hidden;
              // scale-[1.02] only to erase a subpixel edge sliver. The box
              // itself was aspect-[2/1] (much wider/shorter than the
              // mobile/desktop stage) — same root problem as the mobile
              // fix above, but the opposite crop direction: a box this
              // much wider than the group photo forces cover to crop
              // top/bottom instead of left/right, at risk of the models'
              // heads or shoes. aspect-5/4 matches the mobile hero (and is
              // close to the desktop stage's own effective ~1.36 ratio),
              // so all three breakpoints crop this photo consistently and
              // mildly instead of tablet cropping it far more aggressively
              // than the other two.
              className="scale-[1.02] object-cover object-center"
            />
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
          <button
            type="button"
            onClick={onTogglePause}
            aria-pressed={paused}
            aria-label={paused ? t("home.resumeRotation") : t("home.pauseRotation")}
            className="grid h-9 w-9 flex-none place-items-center rounded-full border border-line text-ink transition-colors hover:border-ink focus-ring"
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </section>
  );
}
