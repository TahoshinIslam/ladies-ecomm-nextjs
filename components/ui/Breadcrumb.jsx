import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "../../lib/utils.js";

/**
 * Shared breadcrumb trail. Was previously hand-rolled once, only on the
 * PDP (Home / Shop / category / product name) — every other route had no
 * breadcrumb at all. This is the one component every page should use so
 * the trail is consistent (same separator, same icon treatment, same
 * current-page styling) instead of each page inventing its own.
 *
 * items: [{ label, href, icon? }] — an item with no `href` (or the last
 * item regardless of `href`) renders as the current page: plain text, no
 * link, aria-current="page". `icon` is optional per item — pass it for
 * the well-known destinations (Home, Shop, Bag, Checkout, Orders, ...);
 * leaf items like a category or product name typically have none.
 */
export default function Breadcrumb({ items, className }) {
  return (
    // Deliberately flex-nowrap, not flex-wrap: wrapping let the whole trail
    // spill onto a second line whenever the last (usually longest — a full
    // product name) segment didn't fit, which read as broken rather than a
    // normal breadcrumb. Every earlier segment (Home, Shop, a category —
    // `flex-none` below) keeps its full natural width; only the final,
    // current-page segment is allowed to shrink and truncates with an
    // ellipsis instead, the standard breadcrumb pattern for a long trailing
    // title.
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "mb-6 flex items-center gap-x-1.5 text-sm text-muted-foreground",
        className,
      )}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const Icon = item.icon;
        const content = (
          <>
            {Icon && <Icon className="h-3.5 w-3.5 flex-none" />}
            <span className="truncate">{item.label}</span>
          </>
        );

        return (
          <span
            key={item.label}
            className={cn("flex items-center gap-x-1.5", isLast ? "min-w-0 flex-1" : "flex-none")}
          >
            {i > 0 && (
              <ChevronRight
                aria-hidden="true"
                className="h-3.5 w-3.5 flex-none text-muted-foreground/50"
              />
            )}
            {isLast || !item.href ? (
              <span
                aria-current={isLast ? "page" : undefined}
                className={cn(
                  "flex min-w-0 items-center gap-1.5",
                  isLast && "font-medium text-foreground",
                )}
              >
                {content}
              </span>
            ) : (
              <Link
                href={item.href}
                className="flex min-w-0 items-center gap-1.5 transition-colors hover:text-foreground"
              >
                {content}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
