import { notFound } from "next/navigation";

import ProductDetailPage from "@/views/ProductDetailPage.jsx";
import { getCachedProductByIdOrSlug } from "@/lib/serverDataCache.js";
import { HttpError } from "@/lib/http.js";
import { resolveImage } from "@/lib/utils.js";
import { absoluteUrl, truncateDescription } from "@/lib/seo.js";

// Phase 10 — reuses the SAME Phase 8 cached read the page body itself
// calls (lib/serverDataCache.js's getCachedProductByIdOrSlug) — same
// unstable_cache entry, so this never adds a duplicate uncached MongoDB
// read alongside the page's own fetch. `params` is a Promise in this
// Next version (confirmed against node_modules/next/dist/docs and
// matching every other dynamic route in this repo), so it's awaited here
// exactly like views/ProductDetailPage.jsx already does.
export async function generateMetadata({ params }) {
  const { idOrSlug } = await params;

  let product;
  try {
    product = await getCachedProductByIdOrSlug(idOrSlug);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }

  const canonicalPath = `/product/${product.slug || idOrSlug}`;
  const canonicalUrl = absoluteUrl(canonicalPath);
  const description = truncateDescription(product.description);
  const image = product.images?.[0] ? resolveImage(product.images[0], 1200) : null;

  return {
    title: product.name,
    description,
    // Inactive products still render today (see views/ProductDetailPage
    // .jsx — no isActive check gates the page body), but they're
    // intentionally excluded from listings/sitemap; noindex keeps search
    // engines from surfacing a page the storefront itself doesn't link
    // to anymore, without changing that existing render behavior.
    robots: product.isActive
      ? { index: true, follow: true }
      : { index: false, follow: true },
    alternates: { canonical: canonicalPath },
    openGraph: {
      type: "website",
      title: product.name,
      description,
      url: canonicalUrl,
      ...(image ? { images: [{ url: image, alt: product.name }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: product.name,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default function Page({ params }) {
  return (
    <ProductDetailPage params={params} />
  );
}
