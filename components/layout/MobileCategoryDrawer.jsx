"use client";

// Drill-down category browser for the mobile hamburger drawer — tapping a
// department slides in its subcategories with a "‹ [Department]" back row
// in place of a flat, all-levels-at-once list, matching the reference
// layout's own category drawer. A node with no children is a real leaf:
// tapping it navigates straight to that filtered shop page.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { departmentName } from "../../lib/i18n/catalog.js";
import { iconFor } from "./CategoryMegaMenu.jsx";

// `path`/`setPath` are owned by Header.jsx, not this component — Header.jsx
// never unmounts, while this drawer's contents do (AnimatePresence removes
// them from the DOM on close), so state that lived here reset to [] every
// time the drawer closed and reopened. Lifting it up means reopening the
// drawer picks back up exactly where the shopper left the drill-down, e.g.
// mid-browse in Food -> Fruits & Vegetables after tapping a leaf product.
export default function MobileCategoryDrawer({ categories, locale, t, path, setPath, onNavigate }) {
  const sp = useSearchParams();
  const childrenOf = (parentId) => categories.filter((c) => String(c.parent) === String(parentId));
  const current = path[path.length - 1] ?? null;
  const list = current ? childrenOf(current._id) : categories.filter((c) => !c.parent);
  const hasChildren = (node) => childrenOf(node._id).length > 0;

  // Keyed purely on whether `node` itself has children — never on how deep
  // it sits. `category=<id>` maps to a `topCategory` filter and `style=<id>`
  // to a `category` filter (services/productService.js); a real product's
  // `category` is always some genuine LEAF, so a composite
  // `category=<ancestor>&style=<node>` only ever matches real products when
  // `node` IS that leaf. A department that itself has children (Burqa under
  // the Women division, or a marketplace mid-tier like Food's "Fruits &
  // Vegetables") is never any product's own `category` — browsing it by its
  // own id, exactly like a top-level department link, is what actually
  // returns its products.
  const linkFor = (node) => (hasChildren(node) ? `/shop?category=${node._id}` : `/shop?style=${node._id}`);

  // A node reads as "active" exactly when the CURRENT page's URL is the one
  // its own linkFor() would produce — i.e. the shopper is actually looking
  // at this department/style's products right now, not just "this button
  // was clicked at some point." Reading it from the real URL (rather than
  // some separately-tracked "last selected" flag) means it's always correct
  // even after a fresh page load, a Back/Forward navigation, or reaching the
  // same page a completely different way (e.g. the desktop hover menu).
  const isActive = (node) =>
    hasChildren(node) ? sp.get("category") === String(node._id) && !sp.get("style") : sp.get("style") === String(node._id);

  if (list.length === 0) return null;

  return (
    <div>
      {current && (
        <button
          type="button"
          onClick={() => setPath((p) => p.slice(0, -1))}
          className="flex w-full items-center gap-1.5 border-b border-line px-4 py-3.5 text-left text-[15px] font-semibold text-verm focus-ring"
        >
          <ChevronLeft className="h-4 w-4 flex-none" />
          {departmentName(locale, current.slug, current.name)}
        </button>
      )}
      {list.map((node) => {
        const Icon = path.length === 0 ? iconFor(node.icon) : null;
        const nodeHasChildren = hasChildren(node);
        const active = isActive(node);
        const name = departmentName(locale, node.slug, node.name);
        // Same non-color-only convention as CategoryDrillMenu.jsx's desktop
        // flyout: a solid green fill + white text, never a color-only cue.
        const rowClasses = `flex items-center gap-3 border-b border-line px-4 py-3.5 text-[15px] transition-colors focus-ring ${
          active ? "bg-verm text-accent-foreground" : "text-ink hover:bg-wash"
        }`;
        return nodeHasChildren ? (
          <button
            key={node._id}
            type="button"
            onClick={() => setPath((p) => [...p, node])}
            className={`w-full text-left ${rowClasses}`}
          >
            {Icon && (
              <Icon
                className={`h-[18px] w-[18px] flex-none ${active ? "text-accent-foreground" : "text-stone"}`}
                strokeWidth={1.8}
                aria-hidden="true"
              />
            )}
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <ChevronRight className={`h-4 w-4 flex-none ${active ? "text-accent-foreground/70" : "text-stone"}`} aria-hidden="true" />
          </button>
        ) : (
          <Link key={node._id} href={linkFor(node)} onClick={onNavigate} className={rowClasses}>
            {Icon && (
              <Icon
                className={`h-[18px] w-[18px] flex-none ${active ? "text-accent-foreground" : "text-stone"}`}
                strokeWidth={1.8}
                aria-hidden="true"
              />
            )}
            <span className="min-w-0 flex-1 truncate">{name}</span>
          </Link>
        );
      })}
      {current && (
        <Link
          href={linkFor(current)}
          onClick={onNavigate}
          className="block px-4 py-3 text-[13.5px] text-stone transition-colors hover:text-verm"
        >
          {t("header.shopAllInCategory")}
        </Link>
      )}
    </div>
  );
}
