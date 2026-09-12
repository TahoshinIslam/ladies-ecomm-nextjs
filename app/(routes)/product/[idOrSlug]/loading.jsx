import Skeleton from "../../../../components/ui/Skeleton.jsx";

// Instant feedback for a product-detail navigation — this route has no
// static shell to prefetch (it's a genuinely dynamic Server Component read,
// see views/ProductDetailPage.jsx), so without this the click-to-image
// complaint was really "nothing at all renders until the full server round
// trip resolves." Shaped to match ProductDetailInteractive.jsx's real
// layout (breadcrumb, 2-col gallery/info grid) so there's no layout shift
// once the real content swaps in.
export default function Loading() {
  return (
    <div className="container-x py-10 pb-28 lg:pb-10">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-10 rounded" />
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-4 w-14 rounded" />
        <Skeleton className="h-4 w-4 rounded-full" />
        <Skeleton className="h-4 w-24 rounded" />
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div className="w-full space-y-4 md:mx-auto md:max-w-[440px] lg:mx-0 lg:max-w-none">
          <Skeleton className="aspect-4/5 w-full rounded-2xl" />
          <div className="flex gap-2">
            <Skeleton className="h-20 w-20 flex-shrink-0 rounded-md" />
            <Skeleton className="h-20 w-20 flex-shrink-0 rounded-md" />
            <Skeleton className="h-20 w-20 flex-shrink-0 rounded-md" />
          </div>
        </div>

        <div className="flex flex-col">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="mt-3 h-9 w-3/4 rounded" />
          <Skeleton className="mt-4 h-5 w-40 rounded" />
          <Skeleton className="mt-5 h-9 w-32 rounded" />
          <div className="mt-5 space-y-2">
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-full rounded" />
            <Skeleton className="h-4 w-2/3 rounded" />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-7 w-28 rounded-full" />
            <Skeleton className="h-7 w-20 rounded-full" />
          </div>
          <div className="mt-6 space-y-2">
            <Skeleton className="h-4 w-16 rounded" />
            <div className="flex gap-2">
              <Skeleton className="h-11 w-16 rounded-lg" />
              <Skeleton className="h-11 w-16 rounded-lg" />
              <Skeleton className="h-11 w-16 rounded-lg" />
            </div>
          </div>
          <Skeleton className="mt-6 h-14 w-full rounded-lg lg:mt-auto" />
        </div>
      </div>
    </div>
  );
}
