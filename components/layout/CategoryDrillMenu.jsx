"use client";

// The real 3-column hover drill-down (department -> style -> further
// style) shared by CategorySidebar.jsx (unused on the homepage as of the
// shop-category-tiles redesign, kept for any other caller) and
// HeaderCategoryMenu.jsx (the header's "All Categories" trigger, now
// rendered storefront-wide, not just on /shop) — extracted so every entry
// point can never drift into two different navigation experiences. Owns
// only the list + flyout markup and its hover/focus state; the caller
// supplies its own outer chrome (border/rounded/width/visibility) and
// positioning context.
import { useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { useLocale } from "../../context/LocaleProvider.jsx";
import { departmentName } from "../../lib/i18n/catalog.js";
import { cn } from "../../lib/utils.js";
import { iconFor } from "./CategoryMegaMenu.jsx";

// Only a top-level department ever has its own `icon` set (see
// categoryModel.js's own comment — every subcategory's `icon` field is
// permanently empty). Falling back to a single generic grid icon for
// EVERY subcategory made every department's flyout look identical and
// meaningless. Instead, walk up the parent chain to the nearest ancestor
// that actually has one set — in practice that's always the top-level
// department itself, so "Food"'s children show Food's own fork-and-knife
// icon, "Jewelry"'s children show Jewelry's own gem icon, etc. — a real,
// department-specific icon rather than a one-size-fits-all placeholder.
function effectiveIconFor(category, categories) {
  let current = category;
  const seen = new Set();
  while (current && !seen.has(String(current._id))) {
    if (current.icon) return iconFor(current.icon);
    seen.add(String(current._id));
    current = categories.find((c) => String(c._id) === String(current.parent));
  }
  return iconFor(undefined);
}

// `onNavigate` (optional) fires on every real link click — the header's
// hover-triggered menu uses it to close itself immediately on navigation,
// rather than waiting for the (now-irrelevant) mouseleave.
export default function CategoryDrillMenu({ categories, onNavigate, className }) {
  const { locale } = useLocale();
  const topLevel = categories.filter((c) => !c.parent);
  const [hoverId, setHoverId] = useState(null);
  const [activeMidId, setActiveMidId] = useState(null);

  const childrenOf = (parentId) => categories.filter((c) => String(c.parent) === String(parentId));

  const midColumn = hoverId ? childrenOf(hoverId) : [];
  // Deliberately NOT defaulting to midColumn[0] the way CategoryMegaMenu.jsx
  // does for its own (click-to-open) flyout: this menu opens on a plain
  // hover of the top-level row, so auto-selecting the first mid item made
  // the right (3rd) column pop up immediately too — before the shopper had
  // hovered any subcategory at all. Only an explicit hover/focus on a
  // mid-column item (setActiveMidId below) reveals column 3.
  const effectiveMidId =
    activeMidId && midColumn.some((c) => String(c._id) === String(activeMidId)) ? activeMidId : null;
  const rightColumn = effectiveMidId ? childrenOf(effectiveMidId) : [];

  const clearHover = () => {
    setHoverId(null);
    setActiveMidId(null);
  };

  // Ref map (category id -> its link element) for the keyboard fixes below.
  // The mid/right flyouts are DOM SIBLINGS of the scrolling top-level <ul>
  // (not descendants) — required so the ul's own overflow-y-auto (this list
  // runs to 20 departments) doesn't clip a flyout escaping horizontally via
  // `left-full`. That sibling placement means default Tab order walks
  // through every remaining top-level department before ever reaching the
  // currently-open flyout — a real keyboard trap for anything below the top
  // level. These handlers redirect Tab/Shift+Tab at exactly the column
  // boundaries so every level stays reachable without touching the DOM
  // structure the overflow/positioning depends on.
  const itemRefs = useRef({});
  const setItemRef = (id) => (el) => {
    itemRefs.current[id] = el;
  };
  const focusItem = (id) => itemRefs.current[id]?.focus();

  if (topLevel.length === 0) return null;

  return (
    <div onMouseLeave={clearHover} className={cn("relative flex", className)}>
      {/* This list runs to 20 real departments and counting — it scrolls
          within its own height rather than forcing the whole panel taller
          or spilling past its caller's rounded border. */}
      <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto py-1.5">
        {topLevel.map((d) => {
          const Icon = effectiveIconFor(d, categories);
          const kids = childrenOf(d._id);
          const active = String(d._id) === String(hoverId);
          return (
            <li key={d._id}>
              <Link
                ref={setItemRef(d._id)}
                href={`/shop?category=${d._id}`}
                onMouseEnter={() => setHoverId(d._id)}
                onFocus={() => setHoverId(d._id)}
                onClick={onNavigate}
                onKeyDown={(e) => {
                  if (e.key === "Tab" && !e.shiftKey && kids.length > 0) {
                    e.preventDefault();
                    focusItem(kids[0]._id);
                  }
                }}
                className={`flex items-center gap-3 px-4 py-[11px] text-[13.5px] font-medium transition-colors focus-ring ${
                  active ? "bg-verm text-accent-foreground" : "text-ink hover:bg-verm hover:text-accent-foreground"
                }`}
              >
                <Icon className="h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{departmentName(locale, d.slug, d.name)}</span>
                {kids.length > 0 && (
                  <ChevronRight className={`h-3.5 w-3.5 flex-none ${active ? "text-accent-foreground/70" : "text-stone"}`} aria-hidden="true" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {hoverId && midColumn.length > 0 && (
        <div
          // Deliberately NOT a fixed width covering both the mid AND right
          // columns: that made the right column's own wrapper div always
          // occupy real space — rendered empty, but still a very visible
          // blank white panel — every time a department was hovered, even
          // before any mid-column item had been. The right column's
          // wrapper is only mounted at all once a mid item with real
          // children is actually hovered (see below), so with nothing
          // hovered yet this flyout is just the mid column's own width.
          className="absolute left-full top-0 z-[95] flex h-full min-h-full overflow-hidden border border-l-0 border-line bg-surface shadow-soft"
        >
          <div className="w-[200px] flex-none divide-y divide-line overflow-y-auto border-r border-line py-1">
            {midColumn.map((c) => {
              const Icon = effectiveIconFor(c, categories);
              const active = String(c._id) === String(effectiveMidId);
              const grandkids = childrenOf(c._id);
              // `category=<parent>&style=<self>` only ever matches real
              // products when `c` is itself a genuine leaf (services/
              // productService.js maps `style` to a `category` filter and
              // `category` to `topCategory` — both must hold on the same
              // product). Once `c` has its own children (a department like
              // Burqa sitting under a Men/Women division, or a marketplace
              // mid-tier like Food's "Fruits & Vegetables"), no product's
              // own `category` is literally `c` — that composite href
              // silently resolves to zero results. Browsing `c` directly by
              // its own id (exactly how a top-level department link works)
              // is the correct target either way.
              const href = grandkids.length > 0 ? `/shop?category=${c._id}` : `/shop?style=${c._id}`;
              return (
                <Link
                  ref={setItemRef(c._id)}
                  key={c._id}
                  href={href}
                  onMouseEnter={() => setActiveMidId(c._id)}
                  onFocus={() => setActiveMidId(c._id)}
                  onClick={onNavigate}
                  onKeyDown={(e) => {
                    if (e.key !== "Tab") return;
                    if (!e.shiftKey && grandkids.length > 0) {
                      e.preventDefault();
                      focusItem(grandkids[0]._id);
                    } else if (e.shiftKey && midColumn[0]?._id === c._id) {
                      e.preventDefault();
                      focusItem(hoverId);
                    }
                  }}
                  className={`flex items-center gap-3 px-4 py-2.5 text-[13.5px] transition-colors focus-ring ${
                    active ? "bg-verm text-accent-foreground" : "text-ink hover:bg-verm hover:text-accent-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{departmentName(locale, c.slug, c.name)}</span>
                  {grandkids.length > 0 && (
                    <ChevronRight className={`h-3.5 w-3.5 flex-none ${active ? "text-accent-foreground/70" : "text-stone"}`} aria-hidden="true" />
                  )}
                </Link>
              );
            })}
          </div>
          {/* Only mounted when the hovered mid-item actually has further
              children — never just to show a "nothing further" message. A
              mid-item with none (the common case: this catalog is mostly a
              flat 2-level department -> style tree) already has no chevron
              promising one, so a 3rd column here would be an unexplained
              blank-ish panel, not useful information. */}
          {effectiveMidId && rightColumn.length > 0 && (
            <div className="w-[240px] flex-none divide-y divide-line overflow-y-auto py-1">
              {rightColumn.map((c) => {
                const Icon = effectiveIconFor(c, categories);
                const greatGrandkids = childrenOf(c._id);
                return (
                  <Link
                    ref={setItemRef(c._id)}
                    key={c._id}
                    href={`/shop?style=${c._id}`}
                    onClick={onNavigate}
                    onKeyDown={(e) => {
                      if (e.key === "Tab" && e.shiftKey && rightColumn[0]?._id === c._id) {
                        e.preventDefault();
                        focusItem(effectiveMidId);
                      }
                    }}
                    className="flex items-center gap-3 px-4 py-2.5 text-[13.5px] text-ink transition-colors focus-ring hover:bg-verm hover:text-accent-foreground"
                  >
                    <Icon className="h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{departmentName(locale, c.slug, c.name)}</span>
                    {greatGrandkids.length > 0 && <ChevronRight className="h-3.5 w-3.5 flex-none text-stone" aria-hidden="true" />}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
