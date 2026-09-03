"use client";

import { useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

import ProductCard from "./ProductCard.jsx";
import ProductCardSkeleton from "./ProductCardSkeleton.jsx";
import { cn } from "../../lib/utils.js";
import { useLocale } from "../../context/LocaleProvider.jsx";

/**
 * The one reusable product rail — Recently Viewed and You May Also Like both
 * render through this, using the exact same ProductCard the rest of the
 * storefront does. Two layouts, split at `sm:` (640px): a plain 2-column
 * grid on mobile (no scrolling, no peeking card — every card fully visible,
 * just scroll the page) and a horizontal scroll-snap rail from `sm:` up,
 * where there's enough width for the ~4-5-visible-plus-arrows treatment to
 * read as a rail rather than a cramped scroller.
 *
 * Renders nothing while there's genuinely nothing to show — no empty box,
 * no placeholder cards — so a caller can mount this unconditionally and
 * trust it to hide itself.
 */
export default function ProductRail({
  title,
  subtitle,
  products,
  isLoading = false,
  skeletonCount = 4,
  id,
}) {
  const { t } = useLocale();
  const scrollerRef = useRef(null);
  const shouldReduceMotion = useReducedMotion();

  const scrollByCard = (direction) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector("[data-rail-item]");
    const amount = (card?.offsetWidth || 280) + 20; // card width + gap-5
    el.scrollBy({ left: direction * amount, behavior: shouldReduceMotion ? "auto" : "smooth" });
  };

  if (!isLoading && (!products || products.length === 0)) return null;

  const items = isLoading ? Array.from({ length: skeletonCount }) : products;
  const showArrows = !isLoading && products.length > 4;

  return (
    <motion.section
      aria-labelledby={id}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px" }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative"
    >
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 id={id} className="font-heading text-xl font-bold sm:text-2xl">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {showArrows && (
          <div className="hidden shrink-0 gap-2 md:flex">
            <button
              type="button"
              onClick={() => scrollByCard(-1)}
              aria-label={t("a11y.scrollLeft")}
              className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink transition-colors hover:border-ink hover:bg-wash focus-ring"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollByCard(1)}
              aria-label={t("a11y.scrollRight")}
              className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink transition-colors hover:border-ink hover:bg-wash focus-ring"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Mobile: a plain 2-column grid, sitting inside the normal page
          padding — no bleed, no scroll, every card fully visible.
          sm: and up: the -mx/px pairing lets the rail bleed to the viewport
          edge for the horizontal scroll-snap treatment, while staying
          inside container-x's padding at rest. container-x's own padding is
          a fluid clamp(20px,4vw,56px), not a fixed value — mirroring that
          exact expression here (rather than a fixed -mx-8 step) keeps the
          bleed exactly canceling it at every width in between, instead of
          drifting out of sync (and overflowing the viewport by a few px) in
          the gap between two fixed breakpoints. overflow-x-auto is scoped
          to this element only — never the page. */}
      <div
        ref={scrollerRef}
        className="grid grid-cols-2 gap-x-3 gap-y-7 sm:mx-[clamp(-56px,-4vw,-20px)] sm:flex sm:snap-x sm:snap-mandatory sm:gap-5 sm:overflow-x-auto sm:scroll-smooth sm:px-[clamp(20px,4vw,56px)] sm:pb-2 sm:no-scrollbar lg:mx-0 lg:px-0"
      >
        {items.map((product, i) => (
          <div
            key={isLoading ? i : product._id}
            data-rail-item
            // A plain grid cell on mobile (no explicit width needed); from
            // sm: up this becomes a flex item at a fractional width so
            // ~4-5 cards fit across the rail with the next one peeking in.
            className="min-w-0 sm:w-[44%] sm:flex-none sm:snap-start md:w-[31%] lg:w-[23%] xl:w-[19%]"
          >
            {isLoading ? <ProductCardSkeleton /> : <ProductCard product={product} index={i} />}
          </div>
        ))}
      </div>
    </motion.section>
  );
}
