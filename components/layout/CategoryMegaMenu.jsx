"use client";

// A real 3-column category flyout — top-level departments on the left,
// that department's own subcategories in the middle, and (only when a
// subcategory itself has children) a third column of styles on the right.
// Built from the same flat category list every other department UI in this
// app already fetches (useGetCategoriesQuery) — no separate data source,
// no hardcoded taxonomy here.
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Baby,
  ChevronRight,
  Gem,
  Grid3x3,
  Home,
  PawPrint,
  PenLine,
  Puzzle,
  Shirt,
  Smartphone,
  Sparkles,
  SprayCan,
  UtensilsCrossed,
} from "lucide-react";

import { departmentName } from "../../lib/i18n/catalog.js";

// Keyed by Category.icon (a plain string set by admins/seed scripts, never
// rendered as raw HTML — see models/categoryModel.js's own comment).
// Anything unset or unrecognized falls back to a generic grid icon rather
// than rendering nothing.
// Exported so CategorySidebar.jsx (the homepage's always-expanded sidebar)
// can render the exact same department icons without a second icon map to
// keep in sync.
export const CATEGORY_ICONS = {
  shirt: Shirt,
  gem: Gem,
  "utensils-crossed": UtensilsCrossed,
  baby: Baby,
  "spray-can": SprayCan,
  "paw-print": PawPrint,
  sparkles: Sparkles,
  home: Home,
  "pen-line": PenLine,
  puzzle: Puzzle,
  smartphone: Smartphone,
};

export function iconFor(iconKey) {
  return CATEGORY_ICONS[iconKey] || Grid3x3;
}

export default function CategoryMegaMenu({ categories, locale, t, onNavigate }) {
  const topLevel = useMemo(() => categories.filter((c) => !c.parent), [categories]);
  const [activeTopId, setActiveTopId] = useState(topLevel[0]?._id ?? null);
  const [activeMidId, setActiveMidId] = useState(null);

  const childrenOf = (parentId) =>
    categories.filter((c) => String(c.parent) === String(parentId));

  const midColumn = activeTopId ? childrenOf(activeTopId) : [];
  const effectiveMidId = activeMidId && midColumn.some((c) => String(c._id) === String(activeMidId))
    ? activeMidId
    : midColumn[0]?._id ?? null;
  const rightColumn = effectiveMidId ? childrenOf(effectiveMidId) : [];

  const selectTop = (id) => {
    setActiveTopId(id);
    setActiveMidId(null);
  };

  return (
    <div
      role="menu"
      className="absolute left-0 top-full z-[110] flex w-[min(90vw,880px)] overflow-hidden border border-t-0 border-line bg-surface shadow-soft"
    >
      <div className="w-56 flex-none overflow-y-auto border-r border-line py-2" style={{ maxHeight: 440 }}>
        {topLevel.map((d) => {
          const Icon = iconFor(d.icon);
          const active = String(d._id) === String(activeTopId);
          return (
            <button
              key={d._id}
              type="button"
              onMouseEnter={() => selectTop(d._id)}
              onFocus={() => selectTop(d._id)}
              onClick={() => selectTop(d._id)}
              className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13.5px] font-medium transition-colors focus-ring ${
                active ? "bg-wash text-verm" : "text-ink hover:bg-wash"
              }`}
            >
              <Icon className="h-4 w-4 flex-none" strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate">{departmentName(locale, d.slug, d.name)}</span>
              {childrenOf(d._id).length > 0 && <ChevronRight className="h-3.5 w-3.5 flex-none text-stone" />}
            </button>
          );
        })}
      </div>

      <div className="w-56 flex-none overflow-y-auto border-r border-line py-2" style={{ maxHeight: 440 }}>
        {midColumn.length === 0 ? (
          activeTopId && (
            <Link
              href={`/shop?category=${activeTopId}`}
              onClick={onNavigate}
              className="block px-4 py-2.5 text-[13.5px] text-stone hover:text-verm"
            >
              {t("header.shopAllInCategory")}
            </Link>
          )
        ) : (
          midColumn.map((c) => {
            const active = String(c._id) === String(effectiveMidId);
            return (
              <Link
                key={c._id}
                href={`/shop?category=${activeTopId}&style=${c._id}`}
                onMouseEnter={() => setActiveMidId(c._id)}
                onFocus={() => setActiveMidId(c._id)}
                onClick={onNavigate}
                className={`block px-4 py-2.5 text-[13.5px] transition-colors focus-ring ${
                  active ? "bg-wash text-verm" : "text-ink hover:bg-wash hover:text-verm"
                }`}
              >
                {departmentName(locale, c.slug, c.name)}
              </Link>
            );
          })
        )}
      </div>

      <div className="w-64 flex-none overflow-y-auto p-4" style={{ maxHeight: 440 }}>
        {rightColumn.length === 0 ? (
          <p className="px-1 text-[13px] text-stone">{effectiveMidId ? t("header.noFurtherStyles") : ""}</p>
        ) : (
          <ul className="space-y-2">
            {rightColumn.map((c) => (
              <li key={c._id}>
                <Link
                  href={`/shop?style=${c._id}`}
                  onClick={onNavigate}
                  className="block text-[13.5px] text-ink transition-colors hover:text-verm"
                >
                  {departmentName(locale, c.slug, c.name)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
