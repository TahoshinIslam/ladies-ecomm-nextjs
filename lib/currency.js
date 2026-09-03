// Single centralized currency utility for the whole storefront. Bangladesh
// Taka only — no USD branch anywhere in here on purpose.
//
// Node's ICU data does NOT give us what the spec needs out of the box:
//   Intl.NumberFormat("bn-BD", {style:"currency",currency:"BDT"}).format(1250)
//     -> "১,২৫০৳"   (Bengali digits, but ৳ suffixed — spec wants prefixed)
//   Intl.NumberFormat("en-BD", {style:"currency",currency:"BDT"}).format(1250)
//     -> "BDT 1,250" (no ৳ glyph at all in this locale's currency data)
// So the symbol is placed manually and only plain decimal formatting (which
// *does* give correct digit scripts and thousands grouping) is delegated to
// Intl. Verified against Node's ICU: bn-BD decimal formatting of 1250 is
// "১,২৫০"; en-BD is "1,250".
const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

const toBengaliDigits = (str) => str.replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)]);

const isBanglaLocale = (locale) => locale === "bn-BD" || locale === "bn";

/**
 * Round a raw stored USD-denominated catalog price (Product.basePrice,
 * variant.price/discountPrice, etc. — see services/productService.js and
 * the admin Settings page's own "Product prices are stored in USD" note)
 * into a real Taka amount using the live, admin-configured exchange rate.
 * Never applied to values that are already BDT (order/checkout totals from
 * the API are pre-converted server-side — see orderService.js's
 * toRegionCurrency — running them through this a second time would be a
 * real, silent pricing bug).
 */
export function usdToBdt(rawUsdValue, rate) {
  const n = Number(rawUsdValue);
  const r = Number(rate);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * (Number.isFinite(r) && r > 0 ? r : 1));
}

/**
 * Format an amount that is ALREADY in Taka (no conversion applied) as a
 * customer-facing string: "৳১,২৫০" for Bangla, "৳1,250" for English.
 * Invalid input safely falls back to "৳0" rather than throwing or printing
 * "NaN"/"undefined" on a receipt.
 */
export function formatBdt(alreadyBdtValue, locale) {
  const n = Number(alreadyBdtValue);
  const safe = Number.isFinite(n) ? Math.round(n) : 0;
  const abs = Math.abs(safe);
  let digits;
  try {
    digits = new Intl.NumberFormat(isBanglaLocale(locale) ? "bn-BD" : "en-BD", {
      maximumFractionDigits: 0,
    }).format(abs);
  } catch {
    digits = String(abs);
  }
  return `${safe < 0 ? "-" : ""}৳${digits}`;
}

/**
 * The common case end-to-end: a raw stored USD catalog value, converted at
 * the live rate and formatted for the given locale.
 */
export function formatMoney(rawUsdValue, locale, rate) {
  return formatBdt(usdToBdt(rawUsdValue, rate), locale);
}

export { toBengaliDigits };
