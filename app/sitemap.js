// Phase 10 — App Router metadata sitemap (Next.js 16.3.4's `sitemap.js`
// file convention). Reads the real database (via the Phase 8-cached,
// narrowly-projected lib/serverDataCache.js's getCachedSitemapProducts()
// — active products only, `slug`+`updatedAt` fields only, invalidated by
// the same CATALOG tag every product mutation already fires) rather than
// an HTTP round trip to this app's own API. Includes only genuinely
// public, canonical pages backed by real repository evidence — no
// account/cart/checkout/orders/admin/auth/search-facet permutations, per
// this phase's explicit exclusion list.
import { getCachedSitemapProducts } from "@/lib/serverDataCache.js";
import { absoluteUrl } from "@/lib/seo.js";

// Forces this route to run at REQUEST time only, never during `next
// build` — sitemap.js/robots.js are cached-by-default Route Handlers per
// Next's own docs, which would otherwise try to statically prerender
// this page at build time and touch MongoDB then. This app has no
// database connection available at build time (nor should it need one —
// every other page here is already fully dynamic for the same nonce-CSP
// reason, see lib/cacheTags.js), so a build-time MongoDB read would
// either hang or fail the build outright.
export const dynamic = "force-dynamic";

export default async function sitemap() {
  const products = await getCachedSitemapProducts();

  const staticEntries = [
    { url: absoluteUrl("/"), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/shop"), changeFrequency: "daily", priority: 0.9 },
    { url: absoluteUrl("/size-guide"), changeFrequency: "monthly", priority: 0.3 },
  ];

  const productEntries = products
    .filter((p) => p.slug)
    .map((p) => ({
      url: absoluteUrl(`/product/${p.slug}`),
      lastModified: p.updatedAt ? new Date(p.updatedAt) : undefined,
      changeFrequency: "weekly",
      priority: 0.7,
    }));

  return [...staticEntries, ...productEntries];
}
