"use client";

// A single, non-tabbed product showcase — one collection, one heading, one
// "view all" link. Replaces the old ProductTabsSection (New Arrival /
// Featured / Bestseller / Discount behind a tab bar): each collection now
// gets its own section on the home page instead of competing for space
// behind tabs, so this component only ever renders the one list it's
// given. Pre-fetched by the Server Component (views/HomePage.jsx) as a
// plain prop — no client round trip for the data.
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Sparkles, Star } from "lucide-react";

import ProductCard from "../../components/product/ProductCard.jsx";
import Button from "../../components/ui/Button.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import SectionHead from "./SectionHead.jsx";

// Icons are resolved from a plain string key, not passed in as a component
// reference — the caller (views/HomePage.jsx) is a Server Component, and a
// component/function value can't cross the server→client prop boundary to
// a "use client" file like this one (RSC serializes data, not functions).
const ICONS = { new: Sparkles, featured: Star };

export default function ProductShowcaseSection({
  sectionId,
  headingId,
  eyebrow,
  title,
  sub,
  icon,
  products,
  viewAllHref,
  viewAllLabel,
}) {
  const Icon = ICONS[icon] ?? Sparkles;
  const { t } = useLocale();
  const shouldReduceMotion = useReducedMotion();

  return (
    <section id={sectionId} aria-labelledby={headingId} className="container-x pt-32">
      <SectionHead eyebrow={eyebrow} title={title} sub={sub} id={headingId} bordered />

      <motion.div
        initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-8% 0px" }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="mt-9"
      >
        {products.length === 0 ? (
          <EmptyState icon={Icon} title={t("home.nothingHereYet")} message={t("home.noItemsGeneric")} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((p, i) => (
                <ProductCard key={p._id} product={p} index={i} />
              ))}
            </div>
            <div className="mt-9 flex justify-center">
              <Link href={viewAllHref}>
                <Button variant="subtle" size="lg">
                  {viewAllLabel}
                  <ArrowRight className="h-[15px] w-[15px]" />
                </Button>
              </Link>
            </div>
          </>
        )}
      </motion.div>
    </section>
  );
}
