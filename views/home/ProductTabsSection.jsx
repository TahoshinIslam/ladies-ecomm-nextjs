"use client";

// A reusable tabbed showcase on the home page — pre-fetched by the Server
// Component (views/HomePage.jsx) as plain props. Switching tabs is instant
// (nothing to (re)load); no client round trip for the data. `deptId` is
// optional — omitted, the tabs' "view all" links point at the whole shop
// instead of one department.
import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Sparkles, Star, TrendingUp, Percent } from "lucide-react";

import ProductCard from "../../components/product/ProductCard.jsx";
import Button from "../../components/ui/Button.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import { useLocale } from "../../context/LocaleProvider.jsx";
import SectionHead from "./SectionHead.jsx";

const TAB_ICONS = { new: Sparkles, featured: Star, bestseller: TrendingUp, discount: Percent };

// "bestseller" has no canonical `collection=` value (it isn't one of the
// shop's New/Featured/Discount tabs), so it's the one tab defined by
// sort=-rating instead, the same real, honest "best" signal
// views/HomePage.jsx already uses to pick department hero images. Every
// products array arrives already-fetched; this component only ever reads
// them.
export default function ProductTabsSection({ sectionId, headingId, eyebrow, title, sub, deptId, products }) {
  const { t } = useLocale();
  const shouldReduceMotion = useReducedMotion();
  const [active, setActive] = useState("new");

  const deptParam = deptId ? `category=${deptId}&` : "";
  const tabs = [
    { key: "new", labelKey: "home.tabNewArrival", href: `/shop?${deptParam}collection=new` },
    { key: "featured", labelKey: "home.tabFeatured", href: `/shop?${deptParam}collection=featured` },
    { key: "bestseller", labelKey: "home.tabBestseller", href: `/shop?${deptParam}sort=-rating` },
    { key: "discount", labelKey: "home.tabDiscount", href: `/shop?${deptParam}collection=discount` },
  ];

  const activeTab = tabs.find((tab) => tab.key === active);
  const activeProducts = products[active] ?? [];
  const ActiveIcon = TAB_ICONS[active];

  const underlineTransition = shouldReduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 };

  return (
    <section id={sectionId} aria-labelledby={headingId} className="container-x pt-32">
      <SectionHead eyebrow={eyebrow} title={title} sub={sub} id={headingId} bordered />

      <div
        role="tablist"
        aria-label={t("home.productCategories")}
        className="mt-8 flex gap-7 overflow-x-auto border-b border-line no-scrollbar"
      >
        {tabs.map((tab) => {
          const isActive = active === tab.key;
          const Icon = TAB_ICONS[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`${sectionId}-tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`${sectionId}-tabpanel-${tab.key}`}
              onClick={() => setActive(tab.key)}
              className={`relative flex flex-none items-center gap-2 whitespace-nowrap pb-3.5 font-mono text-[12px] uppercase tracking-[0.12em] transition-colors focus-ring ${isActive ? "text-ink" : "text-stone hover:text-ink"}`}
            >
              <Icon className={`h-3.5 w-3.5 transition-transform duration-150 ${isActive ? "scale-110" : ""}`} />
              {t(tab.labelKey)}
              {isActive && (
                <motion.span
                  layoutId={`${sectionId}-tabs-underline`}
                  transition={underlineTransition}
                  className="absolute inset-x-0 -bottom-px h-[2px] bg-verm"
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${sectionId}-tabpanel-${active}`}
        aria-labelledby={`${sectionId}-tab-${active}`}
        className="mt-9"
      >
        <motion.div
          key={active}
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          {activeProducts.length === 0 ? (
            <EmptyState icon={ActiveIcon} title={t("home.nothingHereYet")} message={t("home.noItemsGeneric")} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {activeProducts.map((p, i) => (
                  <ProductCard key={p._id} product={p} index={i} />
                ))}
              </div>
              <div className="mt-9 flex justify-center">
                <Link href={activeTab.href}>
                  <Button variant="subtle" size="lg">
                    {t("home.viewAllLower", { label: t(activeTab.labelKey) })}
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
