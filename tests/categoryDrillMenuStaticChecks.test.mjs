// CategoryDrillMenu.jsx — the shared 3-column hover drill-down (department
// -> style -> further style) rendered by both CategorySidebar.jsx (the
// homepage's always-expanded list) and HeaderCategoryMenu.jsx (the header's
// hover-to-open "Shop by Category" trigger) — static source-text checks,
// same convention as tests/shopRedesignStaticChecks.test.mjs (this repo has
// no jsdom/RTL). Regression coverage for three real bugs found in manual
// testing, back when this logic still lived directly in CategorySidebar.jsx:
//   1. A leaf category (no real children) was showing a chevron anyway.
//   2. Every subcategory showed one generic grid icon, indistinguishable
//      from any other department's subcategories.
//   3. The 3rd (right) column popped up the instant a department was
//      hovered, before any subcategory itself was hovered.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC_PATH = new URL("../components/layout/CategoryDrillMenu.jsx", import.meta.url).pathname;
const src = fs.readFileSync(SRC_PATH, "utf8");

describe("CategoryDrillMenu.jsx — chevrons only render for a real, non-empty child list", () => {
  test("the mid column's chevron is gated on grandkids.length > 0, computed per-item via childrenOf(c._id) — never unconditional", () => {
    const midBlock = src.slice(src.indexOf('div className="w-[200px]'), src.indexOf("rightColumn.length > 0 && ("));
    assert.match(midBlock, /const grandkids = childrenOf\(c\._id\);/);
    assert.match(midBlock, /\{grandkids\.length > 0 && \(/);
  });

  test("the right column's chevron is gated on greatGrandkids.length > 0, computed per-item via childrenOf(c._id) — never unconditional", () => {
    const rightBlock = src.slice(src.indexOf("rightColumn.length > 0 && ("));
    assert.match(rightBlock, /const greatGrandkids = childrenOf\(c\._id\);/);
    assert.match(rightBlock, /\{greatGrandkids\.length > 0 && <ChevronRight/);
  });
});

describe("CategoryDrillMenu.jsx — icons are inherited from the nearest ancestor with one set, never a flat generic fallback for every subcategory", () => {
  test("effectiveIconFor walks the parent chain looking for a real `icon` field before falling back", () => {
    const fnMatch = src.match(/function effectiveIconFor\(category, categories\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(fnMatch, "effectiveIconFor must exist");
    assert.match(fnMatch[1], /if \(current\.icon\) return iconFor\(current\.icon\);/);
    assert.match(fnMatch[1], /current = categories\.find/);
  });

  test("every column (top-level, mid, right) resolves its icon via effectiveIconFor, not a bare iconFor(c.icon) that would always show the generic fallback for subcategories", () => {
    const occurrences = [...src.matchAll(/const Icon = effectiveIconFor\(/g)];
    assert.equal(occurrences.length, 3, "expected all 3 columns (top-level, mid, right) to call effectiveIconFor");
    assert.ok(!/const Icon = iconFor\(/.test(src), "no column should call the bare iconFor() directly — that always falls back to the generic grid icon for every subcategory");
  });
});

describe("CategoryDrillMenu.jsx — the 3rd column only appears after an explicit hover/focus on a mid-column item", () => {
  test("effectiveMidId resolves to null (not midColumn[0]) until activeMidId names a real item in the current midColumn", () => {
    const match = src.match(/const effectiveMidId =\s*\n?\s*activeMidId[\s\S]*?: (null|midColumn\[0\]\?\.\_id \?\? null);/);
    assert.ok(match, "expected the effectiveMidId ternary");
    assert.equal(match[1], "null", "must fall back to null, not midColumn[0] — auto-selecting the first item made column 3 pop up on a bare department hover");
  });

  // Regression: gating effectiveMidId alone wasn't enough — the right
  // column's own wrapper <div> was still unconditionally mounted (just
  // with null content), so it rendered as a real, visibly blank white
  // panel next to the mid column even with nothing hovered yet. The fix
  // has to remove the WRAPPER itself, not just its contents.
  test("the right column's own wrapper div is conditionally rendered on effectiveMidId && rightColumn.length > 0 — not just its inner content set to null", () => {
    const flyout = src.slice(src.indexOf("absolute left-full top-0 z-[95]"), src.lastIndexOf("</div>"));
    assert.match(
      flyout,
      /\{effectiveMidId && rightColumn\.length > 0 && \(\s*\n\s*<div className="w-\[240px\]/,
      "the right column's wrapper <div> itself must be behind `effectiveMidId && rightColumn.length > 0`, not always rendered with conditional content inside",
    );
  });

  test("the flyout container no longer uses a fixed width that reserves space for the right column before it exists", () => {
    const flyoutClassName = src.match(/absolute left-full top-0 z-\[95\][^"]*/)[0];
    assert.ok(!/w-\[440px\]/.test(flyoutClassName), "a fixed w-[440px] on the flyout would reserve the right column's width even when it isn't rendered");
  });

  // Regression: a mid-item with no further children (the common case in
  // this catalog — see effectiveIconFor's own comment about the mostly
  // flat 2-level tree) still opened a 3rd column just to show a "nothing
  // further" message — an unhelpful near-empty panel that read as another
  // blank popup. The 3rd column must not exist at all in that case; the
  // absent chevron already told the shopper there's nothing further.
  test("hovering a mid-item with zero real children never renders any 3rd-column message — the column simply doesn't exist, not a text explaining it's empty", () => {
    assert.ok(
      !/noFurtherStyles/.test(src),
      "CategoryDrillMenu.jsx must not reference header.noFurtherStyles at all — rightColumn.length > 0 already gates the whole 3rd column out when there's nothing to show",
    );
  });
});
