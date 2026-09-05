import { notFound } from "next/navigation";

import ProductDetailInteractive from "./product/ProductDetailInteractive.jsx";
import { getCachedProductByIdOrSlug, getCachedRelatedProducts, getCachedAttributesForCategory } from "../lib/serverDataCache.js";
import { serializeForClient } from "../lib/serialize.js";
import { HttpError } from "../lib/http.js";
import { getServerLocale } from "../lib/i18n/server.js";
import { localizeProduct, localizeProductList, localizeAttributeDefinitionList } from "../lib/i18n/localize.js";

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

  const [rawRelated, rawAttrDefs] = await Promise.all([
    getCachedRelatedProducts(idOrSlug, 8),
    getCachedAttributesForCategory(rawProduct.topCategory),
  ]);

  const product = serializeForClient(localizeProduct(rawProduct, locale));
  const relatedProducts = serializeForClient(localizeProductList(rawRelated, locale));
  const attrDefs = serializeForClient(localizeAttributeDefinitionList(rawAttrDefs, locale));

  return (
    <ProductDetailInteractive
      product={product}
      relatedProducts={relatedProducts}
      attrDefs={attrDefs}
    />
  );
}
