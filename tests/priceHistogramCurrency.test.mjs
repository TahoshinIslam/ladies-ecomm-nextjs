// Confirmed audit finding, fixed: components/product/PriceHistogramSlider.jsx
// and views/shop/ShopPageClient.jsx's price-range filter chip both formatted
// raw basePrice/discountPrice-scale numbers via settings.formatPrice()
// (which defaults to treating its input as USD and multiplies by the live
// exchange rate) instead of settings.formatBdt() (no conversion) — a real,
// currently-live bug affecting 100% of the catalog once every product was
// migrated to price_currency='BDT' (confirmed via a direct query: all 14
// products are 'BDT'). Reproduced live in the browser (the slider showed
// "৳1,180,800" as the catalog max when the real max product price is
// ৳9,840 — exactly 9840 × 120, the tell-tale sign of an unwanted currency
// conversion) before this fix.
//
// Static-source check, same house style as tests/adminSkuAutoGeneration.test.mjs
// and tests/homeDepartmentGridOrder.test.mjs — this repo's plain
// `node:test` suite has no JSX transform, so these two Client Components
// can't be imported and rendered directly here.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (relPath) => fs.readFileSync(path.join(ROOT, relPath), "utf8");

describe("components/product/PriceHistogramSlider.jsx — price-range labels use formatBdt(), never formatPrice()", () => {
  const source = read("components/product/PriceHistogramSlider.jsx");

  test("the min/max labels call settings.formatBdt(), not settings.formatPrice()", () => {
    assert.match(source, /settings\.formatBdt\(lo\)/, "the min label must use formatBdt(lo)");
    assert.match(source, /settings\.formatBdt\(hi\)/, "the max label must use formatBdt(hi)");
    assert.doesNotMatch(
      source,
      /settings\.formatPrice\(lo\)|settings\.formatPrice\(hi\)/,
      "must never call formatPrice() on the already-BDT lo/hi values — that would re-apply the exchange rate",
    );
  });

  test("the catalog bounds are computed from the raw discountPrice/basePrice columns directly (no client-side currency math)", () => {
    assert.match(source, /Number\(p\.discountPrice \?\? p\.basePrice\)/, "must read the raw catalog price fields as-is");
  });
});

describe("views/shop/ShopPageClient.jsx — price filter chip label uses formatBdt(), never formatPrice()", () => {
  const source = read("views/shop/ShopPageClient.jsx");

  test("the priceMin/priceMax filter chip label calls settings.formatBdt(), not settings.formatPrice()", () => {
    const priceChipBlock = source.match(/const priceMin = sp\.get\("priceMin"\);[\s\S]{0,700}/)?.[0];
    assert.ok(priceChipBlock, "expected to find the price-range filter-chip block");
    assert.match(priceChipBlock, /settings\.formatBdt\(Number\(priceMin\)\)/);
    assert.match(priceChipBlock, /settings\.formatBdt\(Number\(priceMax\)\)/);
    assert.doesNotMatch(
      priceChipBlock,
      /settings\.formatPrice\(Number\(priceMin\)\)|settings\.formatPrice\(Number\(priceMax\)\)/,
      "must never call formatPrice() on these already-BDT URL query values",
    );
  });
});

// Note on the premise this fix relies on: a blanket formatBdt() (no
// per-row currency lookup) is correct here specifically because every
// product is price_currency='BDT' now (verified via a live query during
// this fix — see docs/CURRENCY_MIGRATION_PLAN.md). ProductCard.jsx/PDP/
// cart still pass each product's own .priceCurrency explicitly (more
// robust, kept as-is) because they render one specific product's price;
// a catalog-wide min/max aggregate has no single "this row's currency" to
// look up, so it can only be correct once the whole catalog agrees.
