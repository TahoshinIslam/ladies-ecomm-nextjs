"use client";

// Drill-down category browser for the mobile hamburger drawer — tapping a
// department slides in its subcategories with a "‹ [Department]" back row
// in place of a flat, all-levels-at-once list, matching the reference
// layout's own category drawer. A node with no children is a real leaf:
// tapping it navigates straight to that filtered shop page, using the same
// category/style query-param convention CategoryMegaMenu.jsx already uses
// for the header's desktop flyout (so the two stay consistent): the
// department itself uses `category=<id>`, a direct child uses
// `category=<departmentId>&style=<id>`, and a grandchild (this taxonomy is
// at most 3 levels deep) uses `style=<id>` alone.
import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { departmentName } from "../../lib/i18n/catalog.js";
import { iconFor } from "./CategoryMegaMenu.jsx";

export default function MobileCategoryDrawer({ categories, locale, t, onNavigate }) {
  const [path, setPath] = useState([]);

  const childrenOf = (parentId) => categories.filter((c) => String(c.parent) === String(parentId));
  const current = path[path.length - 1] ?? null;
  const list = current ? childrenOf(current._id) : categories.filter((c) => !c.parent);

  // `ancestorPath` is every level ABOVE `node` (not including it) — for a
  // member of `list` that's the current `path` (children of `current`,
  // whose own ancestors are exactly `path`); for `current` itself (the
  // trailing "shop all in this category" link below) it's `path` minus its
  // own last entry, since `current` is one level shallower than its
  // children.
  const hrefAt = (node, ancestorPath) => {
    if (ancestorPath.length === 0) return `/shop?category=${node._id}`;
    if (ancestorPath.length === 1) return `/shop?category=${ancestorPath[0]._id}&style=${node._id}`;
    return `/shop?style=${node._id}`;
  };
  const hrefFor = (node) => hrefAt(node, path);

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
        const hasChildren = childrenOf(node._id).length > 0;
        const name = departmentName(locale, node.slug, node.name);
        return hasChildren ? (
          <button
            key={node._id}
            type="button"
            onClick={() => setPath((p) => [...p, node])}
            className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left text-[15px] transition-colors hover:bg-wash focus-ring"
          >
            {Icon && <Icon className="h-[18px] w-[18px] flex-none text-stone" strokeWidth={1.8} aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <ChevronRight className="h-4 w-4 flex-none text-stone" aria-hidden="true" />
          </button>
        ) : (
          <Link
            key={node._id}
            href={hrefFor(node)}
            onClick={onNavigate}
            className="flex items-center gap-3 border-b border-line px-4 py-3.5 text-[15px] transition-colors hover:bg-wash focus-ring"
          >
            {Icon && <Icon className="h-[18px] w-[18px] flex-none text-stone" strokeWidth={1.8} aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate">{name}</span>
          </Link>
        );
      })}
      {current && (
        <Link
          href={hrefAt(current, path.slice(0, -1))}
          onClick={onNavigate}
          className="block px-4 py-3 text-[13.5px] text-stone transition-colors hover:text-verm"
        >
          {t("header.shopAllInCategory")}
        </Link>
      )}
    </div>
  );
}
