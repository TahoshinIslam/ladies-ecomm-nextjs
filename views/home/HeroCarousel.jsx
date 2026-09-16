"use client";

// Full-width rotating carousel — no text/heading overlay (removed per
// feedback), just real department photography sliding with left/right
// arrow controls and dot indicators, closer to the reference layout's own
// banner carousel. A bare panel (no outer <section>/container of its own)
// — HomePage.jsx places it inside a shared container alongside the
// always-expanded CategorySidebar, filling whatever width remains next to
// it. Each slide is itself a link to that department's shop page.
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play, ShoppingBag } from "lucide-react";

import { useLocale } from "../../context/LocaleProvider.jsx";
import { resolveImage, isPlaceholderStub } from "../../lib/utils.js";

const ROTATION_SLUGS = ["burqa", "abaya", "hijab", "khimar"];
const AUTO_ADVANCE_MS = 6000;

export default function HeroCarousel({ departments, heroImageBySlug }) {
  const { t } = useLocale();
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );
  const paused = userPaused || interactionPaused || reducedMotion;

  const slides = ROTATION_SLUGS.map((slug) => {
    const dept = departments.find((d) => d.slug === slug);
    const raw = heroImageBySlug?.[slug];
    // Every seeded product in this environment is currently a placehold.co
    // text-label stub (e.g. "Abaya" spelled out across a gray box), not an
    // actual photo — isPlaceholderStub() rejects those so the slide falls
    // back to the app's own hatch pattern instead of rendering that stub
    // at hero scale. An admin-set carousel image (Shop Config → Carousel)
    // is real photography and is used as-is.
    const image = raw && !isPlaceholderStub(raw) ? raw : null;
    return dept ? { slug, dept, image } : null;
  }).filter(Boolean);

  const active = slides[index] ?? slides[0];

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
    if (paused || slides.length <= 1) return undefined;
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [paused, slides.length]);

  const go = (delta) => setIndex((i) => (i + delta + slides.length) % slides.length);

  if (!active) return null;

  return (
    <div
      aria-roledescription="carousel"
      className="relative h-full min-h-[360px] w-full overflow-hidden rounded-[22px] bg-media"
      onMouseEnter={() => setInteractionPaused(true)}
      onMouseLeave={() => setInteractionPaused(false)}
      onFocus={() => setInteractionPaused(true)}
      onBlur={() => setInteractionPaused(false)}
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={active.slug}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0"
          aria-roledescription="slide"
          aria-label={`${index + 1} / ${slides.length}`}
        >
          <Link href={`/shop?category=${active.dept._id}`} className="absolute inset-0 block focus-ring">
            {active.image ? (
              <Image
                src={resolveImage(active.image, 1600)}
                alt=""
                fill
                sizes="(max-width: 1024px) 100vw, 70vw"
                fetchPriority="high"
                className="object-cover object-top"
              />
            ) : (
              <div aria-hidden="true" className="absolute inset-0 hatch grid place-items-center">
                <ShoppingBag className="h-16 w-16 text-ink/10" strokeWidth={1.2} />
              </div>
            )}
          </Link>
        </motion.div>
      </AnimatePresence>

      {slides.length > 1 && (
        <>
          {/* Prev/next controls — siblings of the slide's Link (not
              nested inside it), painted above it by DOM order, so clicking
              an arrow never triggers the slide's own navigation. */}
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label={t("home.heroPrevSlide")}
            className="absolute left-4 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-ink/70 text-white transition-colors hover:bg-ink focus-ring"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label={t("home.heroNextSlide")}
            className="absolute right-4 top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-ink/70 text-white transition-colors hover:bg-ink focus-ring"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.slug}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`${i + 1} / ${slides.length}`}
                aria-current={i === index}
                className={`h-1.5 rounded-full transition-all ${i === index ? "w-6 bg-white" : "w-1.5 bg-white/60 hover:bg-white/80"}`}
              />
            ))}
          </div>

          {/* Pause control — required alongside hover/focus pausing per
              WCAG 2.2.2 (Pause, Stop, Hide) for any auto-advancing
              content. */}
          <button
            type="button"
            onClick={() => setUserPaused((p) => !p)}
            aria-pressed={userPaused}
            aria-label={userPaused ? t("home.resumeRotation") : t("home.pauseRotation")}
            className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-ink/70 text-white transition-colors hover:bg-ink focus-ring"
          >
            {userPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
        </>
      )}
    </div>
  );
}
