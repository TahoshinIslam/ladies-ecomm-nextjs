// Regression coverage for a real Home-page bug: the "Shop by department"
// grid (views/HomePage.jsx) assigns tall/wide hero spans to whichever
// department happens to be FIRST/SECOND in the `departments` array (CSS
// grid auto-placement follows array/DOM order, not the "01"/"02" labels
// baked into DEPARTMENT_COPY). That array came straight from
// getCachedCategories() with no explicit reordering, and
// services/categoryService.js's listCategories() sorts by `sortOrder` then
// `name` — every seeded department ties on sortOrder=0, so the real order
// was alphabetical (Abaya, Burqa, Hijab, Khimar, Modest Sets, Niqab), not
// the intended Burqa-tall-first/Abaya-wide-second hero arrangement.
// Concretely: Abaya (styled "wide") landed in the tall hero's (row1,col1)
// slot, Burqa's tall span got pushed wherever auto-placement found room
// next, and Hijab ended up squeezed into whatever default-sized cell was
// left beside it — a shopper reported this as "Hijab doesn't fit / stuck
// at a fixed size" next to an unexpectedly huge neighbor, even though each
// card's own min-height math (verified separately) is correct in
// isolation. The fix sorts `departments` by DEPARTMENT_COPY's own "01"-"06"
// numbering before the grid renders, so the hero arrangement is always the
// intended one regardless of the categories collection's incidental sort.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (relPath) => fs.readFileSync(path.join(ROOT, relPath), "utf8");

describe("views/HomePage.jsx — department grid renders in DEPARTMENT_COPY's intended order, not the DB's incidental one", () => {
  const source = read("views/HomePage.jsx");

  test("the `departments` array is explicitly re-sorted by DEPARTMENT_COPY's own numbering before the grid maps over it", () => {
    assert.match(
      source,
      /\.filter\(\(c\)\s*=>\s*!c\.parent\)\s*\.sort\(/,
      "departments must be sorted right after the !c.parent filter, not left in getCachedCategories()'s incidental order",
    );
    assert.match(
      source,
      /DEPARTMENT_COPY\[a\.slug\]\?\.num.*DEPARTMENT_COPY\[b\.slug\]\?\.num/,
      "the sort comparator must key off DEPARTMENT_COPY's own num field (the same field the tall/wide span styling reads), not some other ordering",
    );
  });

  test("applying the real DEPARTMENT_COPY numbering (extracted from source, so this can't drift from the file) to an alphabetically-sorted input reproduces the intended Burqa/Abaya/Hijab/Niqab/Khimar/Modest-Sets order", () => {
    const copyBlockMatch = source.match(/const DEPARTMENT_COPY = \{([\s\S]*?)\n\};/);
    assert.ok(copyBlockMatch, "DEPARTMENT_COPY constant must exist in views/HomePage.jsx");

    const numBySlug = {};
    const entryRe = /"?([\w-]+)"?:\s*\{[^}]*num:\s*"(\d+)"/g;
    let m;
    while ((m = entryRe.exec(copyBlockMatch[1]))) {
      numBySlug[m[1]] = m[2];
    }
    // Sanity check the extraction itself worked before trusting it below.
    assert.deepEqual(Object.keys(numBySlug).sort(), ["abaya", "burqa", "hijab", "khimar", "modest-sets", "niqab"].sort());

    // The real failure mode: getCachedCategories() returning every seeded
    // department tied on sortOrder=0, secondary-sorted by name.
    const alphabeticalFromDb = ["abaya", "burqa", "hijab", "khimar", "modest-sets", "niqab"];

    const sorted = [...alphabeticalFromDb].sort(
      (a, b) => (Number(numBySlug[a]) || 99) - (Number(numBySlug[b]) || 99),
    );

    assert.deepEqual(sorted, ["burqa", "abaya", "hijab", "niqab", "khimar", "modest-sets"]);
  });

  test("a hypothetical department with no DEPARTMENT_COPY entry sorts after all six known ones (never crashes, never jumps ahead)", () => {
    const copyBlockMatch = source.match(/const DEPARTMENT_COPY = \{([\s\S]*?)\n\};/);
    const numBySlug = {};
    const entryRe = /"?([\w-]+)"?:\s*\{[^}]*num:\s*"(\d+)"/g;
    let m;
    while ((m = entryRe.exec(copyBlockMatch[1]))) numBySlug[m[1]] = m[2];

    const withUnknown = ["unknown-new-department", "burqa", "niqab"];
    const sorted = [...withUnknown].sort(
      (a, b) => (Number(numBySlug[a]) || 99) - (Number(numBySlug[b]) || 99),
    );
    assert.deepEqual(sorted, ["burqa", "niqab", "unknown-new-department"]);
  });
});
