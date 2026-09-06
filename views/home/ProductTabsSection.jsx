"use client";

// Phase 7 — the tabbed section keeps its tab-switch state client-side
// (it's the one part of this section that's genuinely interactive), but
// all four tab panels' product arrays arrive pre-fetched, in parallel,
// from the Server Component (views/HomePage.jsx) as plain props — no
// per-tab RTK Query fetch happens here anymore, so switching tabs is
// still instant (nothing to (re)load), just without ever having made a
// client round trip for the data in the first place.
import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Sparkles, Percent, Shirt } from "lucide-react";

import ProductCard from "../../components/product/ProductCard.jsx";
import Button from "../../components/ui/Button.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import SectionHead from "./SectionHead.jsx";

const HOME_TABS = [
  { key: "featured", labelKey: "home.tabFeatured", icon: Sparkles },
  { key: "discount", labelKey: "home.tabDiscount", icon: Percent },
  { key: "burqa", labelKey: "home.tabBurqa", icon: Shirt },
  { key: "hijab", labelKey: "home.tabHijab", icon: Shirt },
];

export default function ProductTabsSection({ panels }) {
  const { t } = useLocale();
  const shouldReduceMotion = useReducedMotion();
  const [active, setActive] = useState("featured");

  const current = panels[active] ?? { products: [], viewAllHref: "/shop", emptyMessageKey: "home.nothingHereYet" };
  const activeTabDef = HOME_TABS.find((tab) => tab.key === active);
  const products = current.products ?? [];

  const underlineTransition = shouldReduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 };

  return (
    <section id="shop-by-tab" aria-labelledby="tabs-h" className="container-x pt-32">
      <SectionHead
        eyebrow={t("home.findYourFitEyebrow")}
        title={t("home.findYourFit")}
        sub={t("home.findYourFitSub")}
        id="tabs-h"
        bordered
      />

      <div
        role="tablist"
        aria-label={t("home.productCategories")}
        className="mt-8 flex gap-7 overflow-x-auto border-b border-line no-scrollbar"
      >
        {HOME_TABS.map((tab) => {
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`home-tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`home-tabpanel-${tab.key}`}
              onClick={() => setActive(tab.key)}
              className={`relative flex flex-none items-center gap-2 whitespace-nowrap pb-3.5 font-mono text-[12px] uppercase tracking-[0.12em] transition-colors focus-ring ${isActive ? "text-ink" : "text-stone hover:text-ink"}`}
            >
              <tab.icon className={`h-3.5 w-3.5 transition-transform duration-150 ${isActive ? "scale-110" : ""}`} />
              {t(tab.labelKey)}
              {isActive && (
                <motion.span
                  layoutId="home-tabs-underline"
                  transition={underlineTransition}
                  className="absolute inset-x-0 -bottom-px h-[2px] bg-verm"
                />
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`home-tabpanel-${active}`} aria-labelledby={`home-tab-${active}`} className="mt-9">
        <motion.div
          key={active}
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          {products.length === 0 ? (
            <EmptyState
              icon={activeTabDef?.icon || Sparkles}
              title={t("home.nothingHereYet")}
              message={t(current.emptyMessageKey)}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((p, i) => (
                  <ProductCard key={p._id} product={p} index={i} />
                ))}
              </div>
              <div className="mt-9 flex justify-center">
                <Link href={current.viewAllHref}>
                  <Button variant="subtle" size="lg">
                    {t("home.viewAllLower", { label: t(activeTabDef?.labelKey) })}
                    <ArrowRight className="h-[15px] w-[15px]" />
                  </Button>
                </Link>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </section>
  );
}
