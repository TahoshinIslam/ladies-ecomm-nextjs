import { notFound } from "next/navigation";

import ProductDetailInteractive from "./product/ProductDetailInteractive.jsx";
import { getProductByIdOrSlug, listRelated } from "../services/productService.js";
import { resolveAttributesForCategory } from "../services/attributeService.js";
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
export default async function ProductDetailPage({ params }) {
  const { idOrSlug } = await params;
  const locale = await getServerLocale();

  let rawProduct;
  try {
    rawProduct = await getProductByIdOrSlug(idOrSlug);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }

  const [rawRelated, rawAttrDefs] = await Promise.all([
    listRelated(idOrSlug, 8),
    resolveAttributesForCategory(rawProduct.topCategory),
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
