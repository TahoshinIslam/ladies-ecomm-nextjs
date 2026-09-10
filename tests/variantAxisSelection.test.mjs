// Regression coverage for a real product-page bug: a product where each
// color only comes in one specific size (e.g. Black only at M, Blue only
// at L — exactly this shop's real seed data, "Oxford Formal Shirt") could
// never let a shopper discover or select the second color at all. The old
// getAxisOptions() cross-filtered each axis's displayed options by the
// OTHER axes' CURRENT selection — including axis values nobody had
// actually chosen, just defaulted from the first variant. Since Size
// defaulted to "M" (Black's size), the Color row's own "what's available"
// query filtered by size=M and never saw Blue at all; symmetrically the
// Size row filtered by color=black and never saw L. Both axes locked each
// other before the shopper touched anything.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { getAxisOptions, resolveVariant, getDefaultVariantSelection, repairVariantSelection } from "../lib/utils.js";

const AXES = ["color", "size"];

// Mirrors the real bug: Black only exists at M, Blue only at L — no
// variant shares both a color and the other's size.
const lockedVariants = [
  { attributes: { color: "black", size: "m" }, stock: 18 },
  { attributes: { color: "blue", size: "l" }, stock: 9 },
];

describe("lib/utils.js — getAxisOptions never hides a real axis value", () => {
  test("both colors appear even though each only exists at a different size", () => {
    const options = getAxisOptions(lockedVariants, "color");
    assert.deepEqual(
      options.map((o) => o.value).sort(),
      ["black", "blue"],
    );
  });

  test("both sizes appear even though each only exists for a different color", () => {
    const options = getAxisOptions(lockedVariants, "size");
    assert.deepEqual(
      options.map((o) => o.value).sort(),
      ["l", "m"],
    );
  });

  test("an axis value is disabled only when every variant carrying it is out of stock — never because it doesn't match another axis's current pick", () => {
    const variants = [
      { attributes: { color: "black", size: "m" }, stock: 0 },
      { attributes: { color: "blue", size: "l" }, stock: 5 },
    ];
    const options = getAxisOptions(variants, "color");
    assert.equal(options.find((o) => o.value === "black").disabled, true);
    assert.equal(options.find((o) => o.value === "blue").disabled, false);
  });

  test("a value with at least one in-stock variant is never disabled, even if another variant of the same value is out of stock", () => {
    const variants = [
      { attributes: { color: "black", size: "m" }, stock: 0 },
      { attributes: { color: "black", size: "l" }, stock: 4 },
    ];
    const options = getAxisOptions(variants, "color");
    assert.equal(options.find((o) => o.value === "black").disabled, false);
  });
});

describe("lib/utils.js — repairVariantSelection reconciles the OTHER axes around a pinned (just-clicked) one", () => {
  test("clicking Blue (color) repairs Size to L, resolving to the real blue/L variant — the color the shopper just picked is never reverted", () => {
    const afterClickingBlue = repairVariantSelection(
      lockedVariants,
      { color: "blue", size: "m" }, // size is still the stale default
      AXES,
      "color", // color is pinned — the axis the shopper just clicked
    );
    assert.equal(afterClickingBlue.color, "blue", "the just-clicked axis must never be overwritten by repair");
    assert.equal(afterClickingBlue.size, "l");
    assert.ok(resolveVariant(lockedVariants, afterClickingBlue, AXES), "the repaired selection must resolve to a real variant");
  });

  test("clicking Size L repairs Color to blue, symmetrically", () => {
    const afterClickingL = repairVariantSelection(
      lockedVariants,
      { color: "black", size: "l" },
      AXES,
      "size",
    );
    assert.equal(afterClickingL.size, "l");
    assert.equal(afterClickingL.color, "blue");
    assert.ok(resolveVariant(lockedVariants, afterClickingL, AXES));
  });

  test("prefers an in-stock alternative over an out-of-stock one when repairing", () => {
    const variants = [
      { attributes: { color: "black", size: "m" }, stock: 5 },
      { attributes: { color: "blue", size: "l" }, stock: 0 },
      { attributes: { color: "blue", size: "xl" }, stock: 7 },
    ];
    const afterClickingBlue = repairVariantSelection(variants, { color: "blue", size: "m" }, AXES, "color");
    assert.equal(afterClickingBlue.color, "blue");
    assert.equal(afterClickingBlue.size, "xl", "should skip the out-of-stock blue/L and land on the in-stock blue/XL");
  });

  test("the default (first-load) selection is already a real, resolvable variant, unaffected by this fix", () => {
    const defaults = getDefaultVariantSelection(lockedVariants, AXES);
    assert.deepEqual(defaults, { color: "black", size: "m" });
    assert.ok(resolveVariant(lockedVariants, defaults, AXES));
  });
});
