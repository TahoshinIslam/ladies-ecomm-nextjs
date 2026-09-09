// Shop redesign v3 — pure, DOM-free unit tests for lib/utils.js's new
// helpers. Per v3-2 (this repo has no jsdom/RTL/Playwright and none are
// added here), these are plain node:test assertions against exported pure
// functions — no DOM, no React rendering, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { effectivePrice, isRealDiscount, responsiveBatchSize, visibleBufferCount } from "../lib/utils.js";

describe("lib/utils.js — effectivePrice() / isRealDiscount() (the one shared price definition)", () => {
  test("no discountPrice at all -> basePrice", () => {
    const p = { basePrice: 1500, discountPrice: null };
    assert.equal(effectivePrice(p), 1500);
    assert.equal(isRealDiscount(p), false);
  });

  test("a real discount (0 < discountPrice < basePrice) -> discountPrice", () => {
    const p = { basePrice: 1500, discountPrice: 1200 };
    assert.equal(effectivePrice(p), 1200);
    assert.equal(isRealDiscount(p), true);
  });

  test("discountPrice of exactly 0 is never treated as the real price (unlike a bare ?? which would return 0)", () => {
    const p = { basePrice: 1500, discountPrice: 0 };
    assert.equal(effectivePrice(p), 1500);
    assert.equal(isRealDiscount(p), false);
  });

  test("discountPrice >= basePrice is never a real discount (defensive — shouldn't be creatable per assertDiscountsValid, but the read-side helper doesn't trust that blindly)", () => {
    assert.equal(isRealDiscount({ basePrice: 1000, discountPrice: 1000 }), false);
    assert.equal(isRealDiscount({ basePrice: 1000, discountPrice: 1200 }), false);
    assert.equal(effectivePrice({ basePrice: 1000, discountPrice: 1200 }), 1000);
  });

  test("a negative discountPrice is never a real discount", () => {
    assert.equal(isRealDiscount({ basePrice: 1000, discountPrice: -50 }), false);
  });
});

describe("lib/utils.js — responsiveBatchSize() / visibleBufferCount() (Load-more batch sizing)", () => {
  test("responsiveBatchSize matches the required 12/9/8 visible-product counts", () => {
    assert.equal(responsiveBatchSize("desktop"), 12);
    assert.equal(responsiveBatchSize("tablet"), 9);
    assert.equal(responsiveBatchSize("mobile"), 8);
  });

  test("an unrecognized breakpoint falls back to desktop (12), never throws", () => {
    assert.equal(responsiveBatchSize("nonsense"), 12);
    assert.equal(responsiveBatchSize(undefined), 12);
  });

  test("visibleBufferCount with no reveal yet matches the breakpoint's base count", () => {
    assert.equal(visibleBufferCount("desktop", 0, 12), 12);
    assert.equal(visibleBufferCount("tablet", 0, 12), 9);
    assert.equal(visibleBufferCount("mobile", 0, 12), 8);
  });

  test("revealedExtra increases visible count but never past the real buffer size", () => {
    assert.equal(visibleBufferCount("mobile", 2, 12), 10);
    assert.equal(visibleBufferCount("mobile", 10, 12), 12); // clamped — buffer only has 12
    assert.equal(visibleBufferCount("tablet", 5, 12), 12); // 9+5=14, clamped to 12
  });

  test("a smaller real buffer (fewer than 12 total products) is respected — never claims more are visible than actually exist", () => {
    assert.equal(visibleBufferCount("desktop", 0, 5), 5);
    assert.equal(visibleBufferCount("mobile", 0, 3), 3);
  });

  test("a negative revealedExtra is treated as zero, never reducing visibility below the breakpoint base", () => {
    assert.equal(visibleBufferCount("mobile", -3, 12), 8);
  });
});
