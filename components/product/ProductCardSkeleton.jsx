import Skeleton from "../ui/Skeleton.jsx";

/**
 * Mirrors ProductCard's geometry exactly — 4:5 plate, then a 14px gap and the
 * same three text rows — so swapping the real card in causes no layout shift.
 */
export default function ProductCardSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="aspect-4/5 w-full rounded-[14px]" />
      <div className="mt-3.5 flex items-start justify-between gap-3.5">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-[11px] w-20" />
          <Skeleton className="mt-2 h-[18px] w-3/4" />
          <Skeleton className="mt-2 h-[13px] w-1/2" />
        </div>
        <Skeleton className="h-[17px] w-14 flex-none" />
      </div>
    </div>
  );
}
