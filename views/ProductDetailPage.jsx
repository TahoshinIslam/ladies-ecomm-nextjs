import { headers } from "next/headers";
import { notFound } from "next/navigation";

import ProductDetailInteractive from "./product/ProductDetailInteractive.jsx";
import { getCachedProductByIdOrSlug, getCachedRelatedProducts, getCachedAttributesForCategory, getCachedPublicSettings } from "../lib/serverDataCache.js";
import { serializeForClient } from "../lib/serialize.js";
import { HttpError } from "../lib/http.js";
import { getServerLocale } from "../lib/i18n/server.js";
import { localizeProduct, localizeProductList, localizeAttributeDefinitionList } from "../lib/i18n/localize.js";
import { resolveImage } from "../lib/utils.js";
import { usdToBdt } from "../lib/currency.js";
import { absoluteUrl, truncateDescription, safeJsonLd } from "../lib/seo.js";

// Phase 7 — real Server Component: loads the product directly through the
// existing services/productService.js contract (same one GET
// /api/products/[idOrSlug] uses — same 404-on-missing behavior, same
// visibility rules, nothing tightened or loosened here), then hands
// plain, localized, serialized data to the one Client Component that
// needs it for interaction (views/product/ProductDetailInteractive.jsx).
//
// Phase 8 — the underlying reads are now cached (lib/serverDataCache.js).
// Localization is applied AFTER the cache read, on the cached bilingual
// data — never baked into the cache itself — so one cache entry serves
// every locale instead of duplicating the same product per language.
export default async function ProductDetailPage({ params }) {
  const { idOrSlug } = await params;
  const locale = await getServerLocale();

  let rawProduct;
  try {
    rawProduct = await getCachedProductByIdOrSlug(idOrSlug);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }

  const [rawRelated, rawAttrDefs, settings] = await Promise.all([
    getCachedRelatedProducts(idOrSlug, 8),
    getCachedAttributesForCategory(rawProduct.topCategory),
    getCachedPublicSettings(),
  ]);

  const product = serializeForClient(localizeProduct(rawProduct, locale));
  const relatedProducts = serializeForClient(localizeProductList(rawRelated, locale));
  const attrDefs = serializeForClient(localizeAttributeDefinitionList(rawAttrDefs, locale));

  return (
    <>
      <ProductJsonLd product={rawProduct} settings={settings} />
      <ProductDetailInteractive
        product={product}
        relatedProducts={relatedProducts}
        attrDefs={attrDefs}
      />
    </>
  );
}

// Phase 10 — safe Product structured data, built only from real,
// already-fetched fields (no second MongoDB read, no invented values).
// `product.rating`/`numReviews` are genuinely aggregated by
// models/reviewModel.js's calcAverageRating on every real review
// save/delete (never a placeholder), so aggregateRating is included only
// when at least one real review exists — an untouched product's default
// rating of 0 is not a rating worth publishing. Escaped via
// lib/seo.js's safeJsonLd() and rendered with the same per-request CSP
// nonce every other inline mechanism in this app relies on (proxy.js
// sets it on the `x-nonce` request header).
async function ProductJsonLd({ product, settings }) {
  const nonce = (await headers()).get("x-nonce") || undefined;
  const canonicalPath = `/product/${product.slug}`;
  const rate = settings?.currency?.usdToBdt;
  const effectivePrice = usdToBdt(product.discountPrice ?? product.basePrice, rate);
  const inStock = (product.variants || []).some((v) => (v.stock ?? 0) > 0);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: truncateDescription(product.description, 500),
    image: (product.images || []).map((src) => resolveImage(src, 1200)),
    url: absoluteUrl(canonicalPath),
    ...(product.brand?.name ? { brand: { "@type": "Brand", name: product.brand.name } } : {}),
    offers: {
      "@type": "Offer",
      url: absoluteUrl(canonicalPath),
      priceCurrency: "BDT",
      price: effectivePrice,
      availability: inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
    ...(product.numReviews > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.rating,
            reviewCount: product.numReviews,
          },
        }
      : {}),
  };

  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
    />
  );
}
