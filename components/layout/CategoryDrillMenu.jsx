"use client";

// The real hover drill-down, one column per level and as many levels as the
// category tree has (Food -> Snacks -> Biscuits -> Milk Biscuits -> ...),
// shared by CategorySidebar.jsx (the home page's always-open list
// beside the hero) and HeaderCategoryMenu.jsx (the header's "All
// Categories" trigger, shown on every page except the home page) — extracted so every entry
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
  // The hovered/focused node at each level, from the top-level list down: path[0] is the department, path[1] the subcategory
  // opened beside it, path[2] the one opened beside that, and so on. A column to the right exists only while the node before it
  // has subcategories — never an empty panel.
  const [path, setPath] = useState([]);

  const childrenOf = (parentId) => categories.filter((c) => String(c.parent) === String(parentId));

  const columns = [];
  for (let level = 0; level < path.length; level += 1) {
    const kids = childrenOf(path[level]);
    if (!kids.length) break;
    columns.push({ level, parentId: path[level], items: kids });
  }

  // Hovering/focusing a node at `level` makes it the open one there and closes everything deeper.
  const openAt = (level, id) => setPath((p) => (String(p[level]) === String(id) ? p.slice(0, level + 1) : [...p.slice(0, level), id]));
  const clearHover = () => setPath([]);

  // Ref map (category id -> its link element) for the keyboard fixes below.
  // The flyout columns are DOM SIBLINGS of the scrolling top-level <ul>
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

  // A node with subcategories is browsed by its own id (every product beneath it, at any depth); a node with none is a style of its own.
  const hrefFor = (node, hasKids) => (hasKids ? `/shop?category=${node._id}` : `/shop?style=${node._id}`);

  const onKeyDown = (e, { level, node, kids, firstInColumn }) => {
    if (e.key !== "Tab") return;
    if (!e.shiftKey && kids.length > 0) {
      e.preventDefault();
      focusItem(kids[0]._id);
    } else if (e.shiftKey && firstInColumn && level > 0) {
      e.preventDefault();
      focusItem(path[level - 1]);
    }
  };

  if (topLevel.length === 0) return null;

  const renderRow = (node, level, index, items, extraClass) => {
    const Icon = effectiveIconFor(node, categories);
    const kids = childrenOf(node._id);
    const active = String(node._id) === String(path[level]);
    return (
      <Link
        ref={setItemRef(node._id)}
        key={node._id}
        href={hrefFor(node, kids.length > 0)}
        onMouseEnter={() => openAt(level, node._id)}
        onFocus={() => openAt(level, node._id)}
        onClick={onNavigate}
        onKeyDown={(e) => onKeyDown(e, { level, node, kids, firstInColumn: index === 0 })}
        // `py-2.5`: the same row padding in every column, so rows line up across them.
        className={`flex items-center gap-3 px-4 py-2.5 text-[13.5px] transition-colors focus-ring ${extraClass} ${
          active ? "bg-verm text-accent-foreground" : "text-ink hover:bg-verm hover:text-accent-foreground"
        }`}
      >
        <Icon className="h-4 w-4 flex-none" strokeWidth={1.8} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{departmentName(locale, node.slug, node.name)}</span>
        {kids.length > 0 && (
          <ChevronRight className={`h-3.5 w-3.5 flex-none ${active ? "text-accent-foreground/70" : "text-stone"}`} aria-hidden="true" />
        )}
      </Link>
    );
  };

  return (
    <div onMouseLeave={clearHover} className={cn("relative flex", className)}>
      {/* This list runs to 20 real departments and counting — it scrolls
          within its own height rather than forcing the whole panel taller
          or spilling past its caller's rounded border.
          `rounded-[22px]`: matches BOTH real callers' own outer chrome
          exactly (HeaderCategoryMenu.jsx and CategorySidebar.jsx each wrap
          this in a `rounded-[22px] border` box with no padding of its
          own — this `<ul>` fills that box entirely) — without it, an
          active row's flush `bg-verm` is a plain rectangle that visibly
          overlaps the parent's rounded corners, since the parent itself
          must stay `overflow-visible` for the flyout columns below to
          escape horizontally. This `<ul>` is a SIBLING of the flyout
          (never an ancestor), so its clip can never touch it. */}
      <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-[22px] py-1">
        {topLevel.map((d, i) => (
          <li key={d._id}>{renderRow(d, 0, i, topLevel, "font-medium")}</li>
        ))}
      </ul>

      {columns.length > 0 && (
        <div
          // One flex row of columns, each opening to the right of the one before. It scrolls sideways if a very deep branch runs out of
          // room rather than spilling off-screen.
          className="absolute left-full top-0 z-[95] flex h-full min-h-full max-w-[calc(100vw-340px)] overflow-x-auto overflow-y-hidden border border-l-0 border-line bg-surface shadow-soft"
        >
          {columns.map(({ level, parentId, items }) => (
            <div
              key={`${level}-${parentId}`}
              className="w-[220px] flex-none divide-y divide-line overflow-y-auto border-r border-line py-1 last:border-r-0"
            >
              {items.map((c, i) => renderRow(c, level + 1, i, items, ""))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
