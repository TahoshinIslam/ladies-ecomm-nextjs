"use client";

// Always-expanded desktop category sidebar for the homepage hero row —
// unlike the header's CategoryMegaMenu (click "Departments" to open a
// flyout), this list itself never collapses: every department is visible
// on load, no click required. Hovering a department still reveals the same
// mid/right drill-down columns as the header's mega menu, as a flyout
// anchored to the sidebar's right edge, so full 3-level navigation stays
// available without the panel itself ever hiding. Desktop-only (lg+); on
// smaller screens the header's mega menu + mobile drawer already cover
// category access, matching this pass's own "compact opening section"
// scope.
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { useLocale } from "../../context/LocaleProvider.jsx";
import { departmentName } from "../../lib/i18n/catalog.js";
import { iconFor } from "./CategoryMegaMenu.jsx";

// `categories` is the only prop — plain serialized data from the server
// component that renders this (HomePage.jsx). `t`/`locale` come from
// useLocale() instead of props: this is a Client Component rendered
// directly from an async Server Component, and functions (the `t`
// translator) can't cross that boundary as a prop the way they can between
// two Client Components (e.g. Header.jsx → CategoryMegaMenu.jsx).
export default function CategorySidebar({ categories }) {
  const { t, locale } = useLocale();
  const topLevel = useMemo(() => categories.filter((c) => !c.parent), [categories]);
  const [hoverId, setHoverId] = useState(null);
  const [activeMidId, setActiveMidId] = useState(null);

  const childrenOf = (parentId) => categories.filter((c) => String(c.parent) === String(parentId));

  const midColumn = hoverId ? childrenOf(hoverId) : [];
  const effectiveMidId =
    activeMidId && midColumn.some((c) => String(c._id) === String(activeMidId)) ? activeMidId : midColumn[0]?._id ?? null;
  const rightColumn = effectiveMidId ? childrenOf(effectiveMidId) : [];

  const clearHover = () => {
    setHoverId(null);
    setActiveMidId(null);
  };

  if (topLevel.length === 0) return null;

  return (
    <nav
      aria-label={t("header.departments")}
      onMouseLeave={clearHover}
      className="relative hidden h-full w-[272px] flex-none flex-col overflow-visible rounded-[22px] border border-line bg-surface lg:flex"
    >
      {/* This list runs to 20 real departments and counting — it scrolls
          within the sidebar's own height (matched to the hero panel next
          to it) rather than forcing the whole row taller or spilling past
          the rounded border. */}
      <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto py-1.5">
        {topLevel.map((d) => {
          const Icon = iconFor(d.icon);
          const kids = childrenOf(d._id);
          const active = String(d._id) === String(hoverId);
          return (
            <li key={d._id}>
              <Link
                href={`/shop?category=${d._id}`}
                onMouseEnter={() => setHoverId(d._id)}
                onFocus={() => setHoverId(d._id)}
                className={`flex items-center gap-3 px-4 py-[11px] text-[13.5px] font-medium transition-colors focus-ring ${
                  active ? "bg-wash text-verm" : "text-ink hover:bg-wash"
                }`}
              >
                <Icon className="h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{departmentName(locale, d.slug, d.name)}</span>
                {kids.length > 0 && <ChevronRight className="h-3.5 w-3.5 flex-none text-stone" aria-hidden="true" />}
              </Link>
            </li>
          );
        })}
      </ul>

      {hoverId && midColumn.length > 0 && (
        <div
          role="menu"
          className="absolute left-full top-0 z-[95] flex h-full min-h-full w-[440px] overflow-hidden border border-l-0 border-line bg-surface shadow-soft"
        >
          <div className="w-[200px] flex-none overflow-y-auto border-r border-line py-2">
            {midColumn.map((c) => {
              const active = String(c._id) === String(effectiveMidId);
              return (
                <Link
                  key={c._id}
                  href={`/shop?category=${hoverId}&style=${c._id}`}
                  onMouseEnter={() => setActiveMidId(c._id)}
                  onFocus={() => setActiveMidId(c._id)}
                  className={`block px-4 py-2.5 text-[13.5px] transition-colors focus-ring ${
                    active ? "bg-wash text-verm" : "text-ink hover:bg-wash hover:text-verm"
                  }`}
                >
                  {departmentName(locale, c.slug, c.name)}
                </Link>
              );
            })}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {rightColumn.length === 0 ? (
              <p className="px-1 text-[13px] text-stone">{effectiveMidId ? t("header.noFurtherStyles") : ""}</p>
            ) : (
              <ul className="space-y-2">
                {rightColumn.map((c) => (
                  <li key={c._id}>
                    <Link href={`/shop?style=${c._id}`} className="block text-[13.5px] text-ink transition-colors hover:text-verm">
                      {departmentName(locale, c.slug, c.name)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
