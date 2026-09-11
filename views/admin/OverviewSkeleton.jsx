import Skeleton from "../../components/ui/Skeleton.jsx";

// Fallback for the <Suspense> boundary in OverviewPage.jsx, around the
// actual analytics fetch/charts — not a route-level loading.jsx. A
// loading.jsx at app/admin/ would sit ABOVE that layout's own redirect()
// staff-role gate (they share the same segment), flushing a 200-status
// fallback before the real redirect could apply — see
// tests/errorBoundaryArchitecture.test.mjs's "loading boundaries never sit
// above a known auth/authorization gate" suite, which asserts no such file
// exists. This Suspense boundary lives safely BELOW that check instead
// (requireServerPermission has already resolved by the time this can even
// render), so it gets the same streamed-skeleton benefit without the
// status-code risk.
export default function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-background p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-16" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-background p-4">
            <Skeleton className="h-5 w-5 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-16" />
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-background p-5">
        <Skeleton className="mb-4 h-4 w-32" />
        <Skeleton className="h-72 w-full" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-background p-5">
            <Skeleton className="mb-4 h-4 w-32" />
            <Skeleton className="h-64 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
