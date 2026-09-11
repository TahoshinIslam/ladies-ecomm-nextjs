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
              <div
                aria-hidden="true"
                className="absolute inset-x-[4%] bottom-[8%] top-[6%] overflow-hidden rounded-3xl bg-media"
              >
                {slide.image ? (
                  // Deliberately plain `loading="lazy"` (the next/image
                  // default), never "eager": this decorative desktop-only
                  // backdrop sits inside a `hidden lg:block` section, and
                  // per Next's own docs (the CSS-toggled light/dark-image
                  // pattern), lazy + a hidden ancestor is what actually
                  // stops the browser from fetching it at all on
                  // mobile/tablet — "eager" would force the fetch
                  // unconditionally regardless of which breakpoint is
                  // active. See the crisp foreground image below for the
                  // full reasoning; this backdrop carries no
                  // fetchPriority since it's decorative, not this route's
                  // LCP candidate.
                  <Image
                    src={resolveImage(slide.image, 700)}
                    alt=""
                    fill
                    sizes="50vw"
                    className="scale-125 object-cover opacity-90 blur-2xl"
                  />
                ) : (
                  <div className="absolute inset-0 hatch" />
                )}
                <div className="absolute inset-0 glow" />
                <div className="absolute inset-0 bg-elev/20" />
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
                  {slide.image ? (
                    // This file renders THREE breakpoint variants of the
                    // same hero photo (desktop here, plus MobileHero/
                    // TabletHero below) inside CSS-media-query-toggled
                    // sections (`hidden lg:block` / `md:hidden` / `hidden
                    // md:block lg:hidden`) — never more than one is
                    // actually visible at once, but a naive `loading=
                    // "eager"` on all three would force the browser to
                    // fetch all three regardless of which is visible.
                    // Per Next's own docs (the CSS-toggled light/dark-
                    // image guidance: "You cannot use ... loading='eager'
                    // because that would cause both images to load.
                    // Instead, you can use fetchPriority='high'"), the
                    // fix is the default `loading="lazy"` on every
                    // variant — a lazy image inside a `display:none`
                    // ancestor is never fetched at all, while the one
                    // variant whose section is actually visible is
                    // "near-viewport" from the very first paint and loads
                    // immediately regardless of the lazy attribute. All
                    // three variants below independently carry
                    // `fetchPriority="high"`, since each is the genuine
                    // LCP candidate for ITS OWN breakpoint, and marking
                    // all three high causes no real contention — only the
                    // one that's actually visible ever fetches.
                    <Image
                      src={resolveImage(slide.image, 900)}
                      alt={slide.name}
                      fill
                      sizes="50vw"
                      fetchPriority="high"
                      className="object-contain"
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
              <button
                type="button"
                onClick={() => setUserPaused((p) => !p)}
                aria-pressed={userPaused}
                aria-label={userPaused ? t("home.resumeRotation") : t("home.pauseRotation")}
                className="grid h-9 w-9 flex-none place-items-center rounded-full border border-line text-ink transition-colors hover:border-ink focus-ring"
              >
                {userPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              </button>
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
                    {heroImageBySlug[slug] ? (
                      <Image
                        src={resolveImage(heroImageBySlug[slug], 132)}
                        alt=""
                        fill
                        sizes="66px"
                        loading="lazy"
                        className="object-contain"
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
        // aspect-4/5, not the old full-bleed aspect-[2/1]: this box now
        // matches ProductCard/PDP's own image plate exactly (one
        // consistent aspect ratio site-wide), and it keeps the same side
        // gutter as the eyebrow/heading/buttons above and below it instead
        // of bleeding edge-to-edge — the old negative-margin bleed, on a
        // short 2:1 box, also squeezed every real (portrait) product photo
        // into a narrow letterboxed strip in the middle.
        className="relative mt-3 aspect-4/5 max-h-[420px]"
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
              className="object-contain"
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
        <Link href="/shop?sort=-createdAt" className="flex-1">
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
              className="object-contain"
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
