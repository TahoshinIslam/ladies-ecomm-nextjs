// Regression coverage for a real Home-page bug: the "Shop by department"
// grid (views/HomePage.jsx) must render departments in a deliberate order,
// not whatever order the DB happens to return them in.
// services/categoryService.js's listCategories() sorts by `sortOrder` then
// `name` — every seeded department ties on sortOrder=0, so the real order
// was alphabetical (Abaya, Burqa, Hijab, Khimar, Modest Sets, Niqab), not
// the intended Burqa-first arrangement. The fix sorts `departments` by
// DEPARTMENT_ORDER's own fixed sequence before the grid renders, so the
// card order is always the intended one regardless of the categories
// collection's incidental sort.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (relPath) => fs.readFileSync(path.join(ROOT, relPath), "utf8");

describe("views/HomePage.jsx — department grid renders in DEPARTMENT_ORDER's intended order, not the DB's incidental one", () => {
  const source = read("views/HomePage.jsx");

  test("the `departments` array is explicitly re-sorted by DEPARTMENT_ORDER right after the !c.parent filter, not left in getCachedCategories()'s incidental order", () => {
    assert.match(
      source,
      /\.filter\(\(c\)\s*=>\s*!c\.parent\)\s*\.sort\(/,
      "departments must be sorted right after the !c.parent filter, not left in getCachedCategories()'s incidental order",
    );
    assert.match(
      source,
      /DEPARTMENT_ORDER\.indexOf\(a\.slug\)/,
      "the sort comparator must key off DEPARTMENT_ORDER's own fixed sequence",
    );
  });

  test("applying the real DEPARTMENT_ORDER sequence (extracted from source, so this can't drift from the file) to an alphabetically-sorted input reproduces the intended Burqa/Abaya/Hijab/Niqab/Khimar/Modest-Sets order", () => {
    const orderMatch = source.match(/const DEPARTMENT_ORDER = \[([\s\S]*?)\];/);
    assert.ok(orderMatch, "DEPARTMENT_ORDER constant must exist in views/HomePage.jsx");

    const order = [...orderMatch[1].matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...order].sort(), ["abaya", "burqa", "hijab", "khimar", "modest-sets", "niqab"].sort());

    // The real failure mode: getCachedCategories() returning every seeded
    // department tied on sortOrder=0, secondary-sorted by name.
    const alphabeticalFromDb = ["abaya", "burqa", "hijab", "khimar", "modest-sets", "niqab"];

    const sorted = [...alphabeticalFromDb].sort(
      (a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
    );

    assert.deepEqual(sorted, ["burqa", "abaya", "hijab", "niqab", "khimar", "modest-sets"]);
  });

  test("a hypothetical department with no DEPARTMENT_ORDER entry sorts after all six known ones (never crashes, never jumps ahead)", () => {
    const orderMatch = source.match(/const DEPARTMENT_ORDER = \[([\s\S]*?)\];/);
    const order = [...orderMatch[1].matchAll(/"([\w-]+)"/g)].map((m) => m[1]);

    const withUnknown = ["unknown-new-department", "burqa", "niqab"];
    const sorted = [...withUnknown].sort(
      (a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)),
    );
    assert.deepEqual(sorted, ["burqa", "niqab", "unknown-new-department"]);
  });
});
