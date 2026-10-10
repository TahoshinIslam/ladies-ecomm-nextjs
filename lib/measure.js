// Items sold by measure (kg, g, l, ml) are ordered by AMOUNT, in steps of their smallest sellable pack — 0.5 kg, 1 kg, 2 kg —
// priced per base unit. Pieces keep to whole units. One place says what a valid amount is, so the product page, the cart, the
// quote and checkout can never disagree (the dashboard's migration 120 made cart and order quantities decimal).

const MAX_QUANTITY = 99999;
const TOLERANCE = 1e-6;

/** How much one step of this variant is (1 for a piece). */
export function orderStep(variant) {
  const step = Number(variant?.step);
  return step > 0 ? step : 1;
}

/** Quantities are kept to three decimals, as every stock quantity is. */
export function roundQuantity(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

/** Is `quantity` an amount this variant can be ordered in: positive, a whole number of its steps, not absurd. */
export function isOrderableQuantity(variant, quantity) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0 || q > MAX_QUANTITY) return false;
  const steps = q / orderStep(variant);
  return Math.abs(steps - Math.round(steps)) < TOLERANCE;
}

/** "0.5 kg", "2 kg", "3" (a piece shows just the number). */
export function formatQuantity(quantity, unit) {
  const q = roundQuantity(quantity);
  const text = Number.isInteger(q) ? String(q) : String(q);
  return unit && unit !== "pc" ? `${text} ${unit}` : text;
}

/** A pack's label for a shopper: "500 g", "1 kg". Uses the pack's own name when it has one. */
export function packLabel(pack, unit) {
  return pack?.name || formatQuantity(pack?.baseQuantity, unit);
}

/**
 * How a bag item is counted: from the live catalog when the server sent it (`measure`), else from what was stored with the
 * item when it was added (a guest bag). Anything unknown is a piece, stepped by one.
 */
export function itemMeasure(item) {
  const m = item?.measure ?? item?.variant ?? {};
  const step = Number(m.step);
  return { unit: m.unit || "pc", step: step > 0 ? step : 1 };
}
