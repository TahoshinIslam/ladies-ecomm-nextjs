import { Suspense } from "react";
import ShopPage from "@/views/ShopPage.jsx";
import { truncateDescription } from "@/lib/seo.js";
import { getT } from "@/lib/i18n/server.js";

// Phase 10 — shop query-string indexing policy: the bare `/shop` (no
// query at all) is the one stable, canonical, indexable landing page.
// EVERY query-string variant — free-text search, any facet combination,
// sort order, or pagination — is deliberately `noindex,follow` with its
// canonical pointed back at bare `/shop`. This repo doesn't define a
// fixed set of "intentionally indexable" category/featured/new/discount
// landing combinations anywhere (no such contract exists in
// lib/shopCacheEligibility.js or elsewhere), so the safe default from
// the Phase 10 spec applies: rather than invent which facet
// combinations "should" be indexable, treat all of them as crawl-space
// that must never fragment into unlimited indexable duplicates of the
// same underlying catalog. `follow` is kept so links to real product
// pages reachable from a filtered result are still crawlable.
export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  const hasQuery = Object.keys(params || {}).length > 0;
  const t = await getT();

  return {
    title: "Shop",
    description: truncateDescription(t("seo.defaultDescription")),
    alternates: { canonical: "/shop" },
    robots: hasQuery ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default function Page({ searchParams }) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1480px] px-5 py-20 sm:px-8"><div className="h-8 w-52 animate-pulse rounded-lg bg-media" /></div>}>
      <ShopPage searchParams={searchParams} />
    </Suspense>
  );
}
