// Shared, pure decision logic for the BDT-only currency migration's
// per-row conversion — used by BOTH scripts/migrations/0003_bdt_price_currency.mjs
// and tests/bdtPricingIntegrity.test.mjs, so the idempotency-guard test
// exercises this exact function, not a hand-copied reimplementation that
// could silently drift from what the real migration actually does.
//
// Pure and DB-free on purpose: the migration file itself stays responsible
// for reading the current row and issuing the UPDATE; this function's only
// job is "given the current row and the audited expected pre-migration
// value, what should the new row look like, and were we already done?" —
// making the actual conversion arithmetic and idempotency guard testable
// without a database connection.

/**
 * @param {{basePrice: number, discountPrice: number|null, priceCurrency: string}} currentRow
 * @param {{baseUsd: number, discountUsd: number|null}} expected — the audited pre-migration value this row must currently hold
 * @param {number} rate — the exchange rate to apply (e.g. 120)
 * @returns {{applied: boolean, basePrice: number, discountPrice: number|null, priceCurrency: "BDT"}}
 * @throws if the row is not already migrated AND doesn't match `expected` — a stale/unexpected-data guard, never silently converts something unaudited.
 */
export function computeProductBdtMigration(currentRow, expected, rate) {
  if (currentRow.priceCurrency === "BDT") {
    // Already migrated — a no-op, not a re-conversion. This is the exact
    // guard under test in tests/bdtPricingIntegrity.test.mjs's
    // "cannot double-convert" case.
    return {
      applied: false,
      basePrice: currentRow.basePrice,
      discountPrice: currentRow.discountPrice,
      priceCurrency: "BDT",
    };
  }

  const discountMismatch =
    expected.discountUsd == null ? currentRow.discountPrice != null : Number(currentRow.discountPrice) !== expected.discountUsd;
  if (Number(currentRow.basePrice) !== expected.baseUsd || discountMismatch) {
    throw new Error(
      `Row's current price (base=${currentRow.basePrice}, discount=${currentRow.discountPrice}) no longer matches ` +
        `the audited value (base=${expected.baseUsd}, discount=${expected.discountUsd}) this migration expects — ` +
        `refusing to convert stale/unexpected data. Re-audit before re-running.`,
    );
  }

  return {
    applied: true,
    basePrice: expected.baseUsd * rate,
    discountPrice: expected.discountUsd == null ? null : expected.discountUsd * rate,
    priceCurrency: "BDT",
  };
}

/**
 * Same shape of decision for a single variant price override (no discount
 * field, no priceCurrency of its own — see scripts/migrations/
 * 0003_bdt_price_currency.mjs's VARIANT_CONVERSIONS). A variant inherits
 * its parent product's currency, so idempotency here is judged from the
 * PRICE VALUE itself, in this fixed order:
 *   1. Already equals the fully-converted target (expectedUsd * rate) —
 *      a prior run already applied this exact conversion. No-op.
 *   2. Equals the original, still-unconverted audited USD value — this
 *      run's real job. Convert it.
 *   3. Anything else — stale/unexpected data. Refuse, never guess.
 */
export function computeVariantBdtMigration(currentPrice, expectedUsd, rate) {
  const converted = expectedUsd * rate;
  const current = Number(currentPrice);
  if (current === converted) {
    return { applied: false, price: current };
  }
  if (current !== expectedUsd) {
    throw new Error(
      `Variant's current price (${currentPrice}) no longer matches either the audited pre-migration value ` +
        `(${expectedUsd}) or the already-converted value (${converted}) — refusing to convert. Re-audit before re-running.`,
    );
  }
  return { applied: true, price: converted };
}
