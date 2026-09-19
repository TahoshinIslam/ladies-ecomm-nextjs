"use client";

// Full-width rotating carousel — no text/heading overlay, just imagery
// sliding with left/right arrow controls and dot indicators. A bare panel
// (no outer <section>/container of its own) — HomePage.jsx places it
// inside a shared container alongside the always-expanded CategorySidebar,
// filling whatever width remains next to it.
//
// Admin-promotions feature: this component's data source is now the public
// Promotions service (`promotions` prop — carousel-eligible banners for
// `placement: "home_hero"`, already schedule/audience-filtered and
// target-resolved server-side by services/promotionService.js) instead of
// always being the hardcoded department rotation. When no admin-created
// carousel promotion is currently eligible, it falls back to that original
// department-rotation behavior unchanged — see this file's own
// buildFallbackSlides() — so the homepage never regresses to a broken/empty
// hero just because no admin campaign exists yet (Migration Strategy 2 from
// the admin-promotions feature spec).
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play, ShoppingBag } from "lucide-react";

import { useLocale } from "../../context/LocaleProvider.jsx";
import FramedHeroSlide from "./FramedHeroSlide.jsx";
import { resolveImage, isPlaceholderStub } from "../../lib/utils.js";
import { resolveSlotFraming, sanitizeFraming } from "../../lib/imageFraming.js";

const ROTATION_SLUGS = ["burqa", "abaya", "hijab", "khimar"];
const AUTO_ADVANCE_MS = 6000;

function buildFallbackSlides(departments, heroImageBySlug, heroFramingBySlug) {
  return ROTATION_SLUGS.map((slug) => {
    const dept = departments.find((d) => d.slug === slug);
    if (!dept) return null;
    const raw = heroImageBySlug?.[slug];
    // Every seeded product in this environment is currently a placehold.co
    // text-label stub (e.g. "Abaya" spelled out across a gray box), not an
    // actual photo — isPlaceholderStub() rejects those so the slide falls
    // back to the app's own hatch pattern instead of rendering that stub
    // at hero scale.
    const image = raw && !isPlaceholderStub(raw) ? raw : null;
    // Crops saved in Shop Config → Carousel (only present for an admin-set
    // image); none saved = unframed = the original object-contain render.
    const framing = heroFramingBySlug?.[slug];
    return {
      key: slug,
      desktopImage: image,
      mobileImage: image,
      desktopFraming: image ? sanitizeFraming(framing?.desktop) : null,
      mobileFraming: image ? sanitizeFraming(framing?.mobile) : null,
      href: `/shop?category=${dept._id}`,
      alt: "",
      clickable: true,
    };
  }).filter(Boolean);
}

function buildPromotionSlides(promotions, locale) {
  return promotions.map((p) => ({
    key: p.id,
    desktopImage: p.desktopImage,
    mobileImage: p.mobileImage || p.desktopImage,
    // Saved crops (lib/imageFraming.js); null = unframed = render as before.
    desktopFraming: sanitizeFraming(p.desktopFraming),
    mobileFraming: sanitizeFraming(p.mobileFraming),
    href: p.href,
    alt: (locale === "bn" ? p.imageAltBn : p.imageAlt) || (locale === "bn" ? p.titleBn : p.title) || "",
    clickable: p.clickable,
  }));
}

export default function HeroCarousel({ departments, heroImageBySlug, heroFramingBySlug, promotions }) {
  const { t, locale } = useLocale();
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [interactionPaused, setInteractionPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );
  const paused = userPaused || interactionPaused || reducedMotion;

  const slides =
    promotions && promotions.length > 0
      ? buildPromotionSlides(promotions, locale)
      : buildFallbackSlides(departments, heroImageBySlug, heroFramingBySlug);

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

  // Saved crops. Desktop uses only its own crop; mobile uses its own, or —
  // when just a desktop crop was saved — carries that one over (Fill
  // re-covers the 4:3 frame). No crop at all = the untouched legacy render.
  // (Carried over only when both slots show the SAME image — a crop stores
  // that image's proportions, so it can't be applied to a different file.)
  const desktopFraming = active.desktopFraming;
  const mobileSrc = active.mobileImage || active.desktopImage;
  const mobileFraming = resolveSlotFraming({ own: active.mobileFraming, ownSrc: mobileSrc, other: desktopFraming, otherSrc: active.desktopImage });
  const isFramed = Boolean(active.desktopImage && (desktopFraming || mobileFraming));

  const Wrapper = active.clickable ? Link : "div";
  const wrapperProps = active.clickable
    ? { href: active.href, "aria-label": active.alt || undefined }
    : { "aria-hidden": !active.alt || undefined };

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
          key={active.key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0"
          aria-roledescription="slide"
          aria-label={`${index + 1} / ${slides.length}`}
        >
          {/* Not nested inside another link/button — a plain <div> when the
              slide has no safe/resolved target (targetType "none", or a
              stale target the server already omitted upstream) so the
              whole banner is never a dead or invalid link. */}
          <Wrapper className="absolute inset-0 block focus-ring" {...wrapperProps}>
            {isFramed ? (
              // A saved framing exists (Admin → Promotions → Adjust framing):
              // rendered through the SAME FramedImage the admin editor
              // previews with, so the crop matches exactly.
              <FramedHeroSlide
                desktopImage={active.desktopImage}
                mobileImage={mobileSrc}
                desktopFraming={desktopFraming}
                mobileFraming={mobileFraming}
              />
            ) : active.desktopImage ? (
              <>
                {/* Two breakpoint-scoped <Image> elements (desktop/mobile
                    creative can differ — an admin may upload a distinct
                    mobile asset) rather than one `sizes`-only responsive
                    image. `fetchPriority="high"` is unconditional here,
                    matching this codebase's own established hero-carousel
                    convention (see tests/imageOptimization.test.mjs's own
                    comment): AnimatePresence's `mode="wait"` above ensures
                    only ONE slide is ever mounted at a time, so "the
                    active slide's image(s)" and "the one genuine LCP
                    candidate for this render" are the same thing — this is
                    not the many-cards-at-once shape (ProductCard.jsx) that
                    actually needs an index-conditional `priority && index
                    === 0` guard. */}
                {/* object-contain (not object-cover): shows the complete,
                    uncropped original image on every screen size — any
                    leftover space letterboxes against this panel's own
                    bg-media instead of cutting off part of the photo. */}
                <Image
                  src={resolveImage(active.desktopImage, 1600)}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 0px, 70vw"
                  fetchPriority="high"
                  className="hidden object-contain object-top sm:block"
                />
                <Image
                  src={resolveImage(active.mobileImage || active.desktopImage, 900)}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 100vw, 0px"
                  fetchPriority="high"
                  className="object-contain object-top sm:hidden"
                />
              </>
            ) : (
              <div aria-hidden="true" className="absolute inset-0 hatch grid place-items-center">
                <ShoppingBag className="h-16 w-16 text-ink/10" strokeWidth={1.2} />
              </div>
            )}
          </Wrapper>
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
                key={s.key}
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
