import { createHash } from "node:crypto";

// Batch pricing helpers shared by the quote, the preview and checkout.
//
// An order line's units come from receipt batches (see models/inventoryModel.js), and each batch
// has its own selling price. A line whose units sell at more than one price becomes one order line
// per price — "5 × ৳500 and 3 × ৳550" — never an average. Batches that sell at the same price are one
// order line (their segments stay attached for the reservation).

/**
 * Group a line's segments by the unit price they sell at, keeping allocation order.
 * `priceOf(segment)` gives the unit price. Returns [{ unitPrice, quantity, segments }].
 */
export function groupSegmentsByPrice(segments, priceOf) {
  const groups = [];
  for (const seg of segments) {
    const unitPrice = priceOf(seg);
    const last = groups[groups.length - 1];
    if (last && last.unitPrice === unitPrice) {
      last.quantity = Math.round((last.quantity + seg.quantity) * 1000) / 1000;
      last.segments.push(seg);
    } else {
      groups.push({ unitPrice, quantity: seg.quantity, segments: [seg] });
    }
  }
  return groups;
}

/**
 * A fingerprint of what a shopper has been shown and agreed to: the goods by item, quantity and
 * price, and the total. Deliberately free of batch ids, lots and costs — those are not the
 * shopper's business, and a different batch at the same price is not a change they need to review.
 */
export function quoteHash(lines, total) {
  const canonical = [...lines]
    .map((l) => [String(l.variantId), Number(l.quantity), Number(l.unitPrice)])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[2] - b[2] || a[1] - b[1]);
  return createHash("sha256").update(JSON.stringify({ lines: canonical, total: Number(total) })).digest("hex").slice(0, 32);
}

/** The part of a quote a browser may see: items, quantities and prices — no batch, lot or cost. */
export function publicQuoteLines(lines) {
  return lines.map((l) => ({ productId: l.productId, variantId: l.variantId, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal }));
}
