// Confirmed, reported bug, fixed: the 3-column drill-down's Women/Burqa/
// Closed-style Burqa rows had visibly misaligned top/bottom edges, and the
// active (green) row's background overlapped the panel's rounded corners.
// Root cause, found by comparing the actual computed padding/border chain
// (not guessed): the top-level column used `py-1.5` on its `<ul>` and
// `py-[11px]` per row, while the mid/right flyout columns used `py-1` on
// their wrapper and `py-2.5` per row — a real, measurable mismatch on both
// the container's own top/bottom inset AND each row's height. The rounded-
// corner overlap was separate: the top-level `<ul>` had no `rounded-[22px]`
// of its own (unlike its callers' outer boxes), so an active row's flush
// background was a plain rectangle painted past the corner that HAS to
// stay `overflow-visible` for the mid/right flyouts (positioned via
// `left-full`, a SIBLING of this `<ul>`, never a descendant) to not get
// clipped.
//
// Static source-text check, same convention as
// tests/categoryDrillMenuStaticChecks.test.mjs (this repo has no jsdom/RTL).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../components/layout/CategoryDrillMenu.jsx", import.meta.url).pathname, "utf8");

describe("CategoryDrillMenu.jsx — all three columns share the same container inset and row padding", () => {
  test("the top-level <ul> uses the same py-1 container padding as the mid/right flyout wrappers (was py-1.5)", () => {
    assert.match(src, /<ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-\[22px\] py-1">/);
    assert.doesNotMatch(src, /py-1\.5/, "the old, mismatched py-1.5 container padding must be gone");
  });

  test("every row across all three columns uses the same py-2.5 vertical padding (top-level row was py-[11px])", () => {
    const rowPaddings = [...src.matchAll(/className=\{?[`"][^"`]*\bpy-(2\.5|\[11px\])\b/g)].map((m) => m[1]);
    assert.ok(rowPaddings.length >= 3, "expected at least 3 row className occurrences (one per column)");
    assert.ok(rowPaddings.every((p) => p === "2.5"), `every column's row padding must be py-2.5 — found: ${rowPaddings.join(", ")}`);
  });

  test("the mid and right flyout wrappers keep their own py-1 (unchanged reference value the top-level list was brought in line with)", () => {
    assert.match(src, /className="w-\[200px\] flex-none divide-y divide-line overflow-y-auto border-r border-line py-1"/);
    assert.match(src, /className="w-\[240px\] flex-none divide-y divide-line overflow-y-auto py-1"/);
  });
});

describe("CategoryDrillMenu.jsx — the active row's background respects the panel's rounded corners without clipping the flyouts", () => {
  test("the top-level <ul> is rounded to match its callers' own outer `rounded-[22px]` box exactly", () => {
    assert.match(src, /<ul className="[^"]*\brounded-\[22px\][^"]*">/);
  });

  test("the <ul> relies on its existing overflow-y-auto to clip (no separate overflow-hidden needed, and none was added)", () => {
    const ulMatch = src.match(/<ul className="([^"]*)">/);
    assert.ok(ulMatch, "expected to find the top-level <ul>");
    assert.match(ulMatch[1], /overflow-y-auto/);
    assert.doesNotMatch(ulMatch[1], /overflow-hidden/, "overflow-hidden on the <ul> is redundant with overflow-y-auto and not what this fix added");
  });

  test("the flyout column (a SIBLING of the <ul>, positioned via left-full) still has no ancestor overflow:hidden that would clip it — the caller's outer wrapper and this component's own root both stay overflow-visible/unset", () => {
    // The flyout's own box legitimately clips ITS OWN two sub-columns
    // (overflow-hidden here is pre-existing, unrelated to this fix, and
    // scoped to a box the <ul>'s new rounding never touches).
    assert.match(src, /className="absolute left-full top-0 z-\[95\] flex h-full min-h-full overflow-hidden border border-l-0 border-line bg-surface shadow-soft"/);
    // The component's own root wrapper (parent of both the <ul> and the
    // flyout) carries no overflow class of its own — it must stay
    // unclipped so the flyout's `left-full` escape is never cut off.
    const rootMatch = src.match(/<div onMouseLeave=\{clearHover\} className=\{cn\("([^"]*)", className\)\}>/);
    assert.ok(rootMatch, "expected to find CategoryDrillMenu's own root wrapper div");
    assert.doesNotMatch(rootMatch[1], /overflow-/, "the root wrapper must not clip — that would cut off the mid/right flyouts");
  });
});
