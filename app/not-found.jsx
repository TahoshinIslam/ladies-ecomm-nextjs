// Phase 10 — the root not-found boundary: renders for any URL that
// doesn't match a route, AND for any segment that calls notFound() and
// doesn't have its own closer not-found.jsx (product/order detail don't
// define their own — this file backs those too, which is why its
// message stays generic rather than "this order doesn't exist" or
// similar; it must never confirm or deny the existence of a specific
// private resource — see views/OrderDetailPage.jsx's own reasoning for
// collapsing "missing" and "not yours" into the same notFound()). No
// props (Next's file convention — not-found.jsx receives nothing). A
// real 404 status is returned for an ordinary non-streamed request; see
// tests/http/seoStatusRegression.integration.test.mjs for the real-HTTP
// proof this still holds for unknown routes, missing products, and
// cross-customer orders.
import Link from "next/link";
import { SearchX, Home, ShoppingBag } from "lucide-react";

export const metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="container-x flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full bg-media text-verm">
        <SearchX className="h-6 w-6" strokeWidth={1.8} />
      </span>
      <h1 className="mt-6 text-[clamp(28px,3.6vw,40px)] font-semibold tracking-[-0.03em]">
        We couldn&rsquo;t find that page
      </h1>
      <p className="mt-3 max-w-[46ch] text-[15.5px] leading-relaxed text-stone">
        The page you&rsquo;re looking for may have moved or no longer exists. Try the homepage, or keep browsing the shop.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex h-12 items-center gap-2 rounded-[10px] bg-ink px-6 text-sm font-semibold text-canvas transition-colors hover:bg-verm focus-ring"
        >
          <Home className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          Go home
        </Link>
        <Link
          href="/shop"
          className="inline-flex h-12 items-center gap-2 rounded-[10px] border border-line px-6 text-sm font-semibold transition-colors hover:border-ink focus-ring"
        >
          <ShoppingBag className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
          Browse the shop
        </Link>
      </div>
    </div>
  );
}
