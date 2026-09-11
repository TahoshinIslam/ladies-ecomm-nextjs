import Skeleton from "../../components/ui/Skeleton.jsx";
import ProductCardSkeleton from "../../components/product/ProductCardSkeleton.jsx";

// The /shop route's Suspense fallback (app/(routes)/shop/page.jsx) — shown
// while the Server Component re-fetches for a brand new URL (any filter,
// sort, or page change navigates via router.push/replace, which re-renders
// this Suspense boundary). Previously a single small pulsing bar with no
// resemblance to the real page, so a filter change looked like nothing was
// happening rather than like something was loading. Mirrors the real
// page's actual layout (breadcrumb, heading, department chips, filter
// sidebar, product grid) so the transition reads as "loading this page,"
// not a blank flash — and so there's zero layout shift once the real
// content swaps in.
const FILTER_GROUPS = [
  { rows: 6 }, // Category
  { rows: 3 }, // Product Collection
  { rows: 2 }, // Availability
];

export default function ShopPageSkeleton() {
  return (
    <div className="container-x py-8">
      <Skeleton className="h-4 w-40" />

      <div className="mb-5 mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Skeleton className="h-9 w-48" />
          <Skeleton className="mt-2 h-4 w-28" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-10 w-36 rounded-md" />
          <Skeleton className="h-10 w-24 rounded-lg lg:hidden" />
        </div>
      </div>

      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-24 flex-none rounded-full" />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="hidden lg:block">
          <div className="rounded-lg border border-border bg-background p-5">
            {FILTER_GROUPS.map((group, gi) => (
              <div key={gi} className="mb-5 border-b border-border pb-5 last:border-0 last:pb-0">
                <Skeleton className="mb-3 h-3 w-24" />
                <div className="space-y-2.5">
                  {Array.from({ length: group.rows }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Skeleton className="h-4 w-4 rounded" />
                      <Skeleton className="h-3" style={{ width: `${50 + ((i * 13) % 35)}%` }} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
