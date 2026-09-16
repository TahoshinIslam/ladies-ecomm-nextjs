// Regression coverage for a real Home-page bug: the "Shop by department"
// grid and the "Shop your everyday favourites" tile row (views/HomePage.jsx)
// must render departments in a deliberate order, not whatever order the DB
// happens to return them in. services/categoryService.js's listCategories()
// sorts by `sortOrder` then `name` — every seeded department ties on
// sortOrder=0, so the real order was alphabetical (Abaya, Burqa, Hijab,
// Khimar, Modest Sets, Niqab), not the intended Burqa-first arrangement.
//
// Shop-category-tiles feature — the sort/filter itself moved into
// lib/storefrontDepartments.js's sortDepartmentsForFavourites(), shared by
// views/HomePage.jsx AND views/shop/ShopPageClient.jsx's new category-filter
// tile row, so the two can never show a different department order. This
// file now tests the REAL shared function directly (imported, not
// regex-extracted from HomePage.jsx's source) plus HomePage.jsx's own call
// site.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { sortDepartmentsForFavourites, DEPARTMENT_ORDER } from "../lib/storefrontDepartments.js";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (relPath) => fs.readFileSync(path.join(ROOT, relPath), "utf8");

describe("views/HomePage.jsx — department grid renders in DEPARTMENT_ORDER's intended order, not the DB's incidental one", () => {
  test("HomePage.jsx computes `departments` via the shared sortDepartmentsForFavourites() helper, not a locally re-implemented sort", () => {
    const source = read("views/HomePage.jsx");
    assert.match(
      source,
      /const departments = sortDepartmentsForFavourites\(categories\);/,
      "HomePage.jsx must delegate to the shared helper so its order can never drift from the Shop page's own tile row",
    );
    assert.match(
      source,
      /import\s*\{[^}]*sortDepartmentsForFavourites[^}]*\}\s*from\s*["']\.\.\/lib\/storefrontDepartments\.js["']/,
      "sortDepartmentsForFavourites must be imported from the shared module, not re-declared locally",
    );
  });

  test("applying the real DEPARTMENT_ORDER sequence to an alphabetically-sorted, unfiltered category list reproduces the intended Burqa/Abaya/Hijab/Niqab/Khimar/Modest-Sets order", () => {
    assert.deepEqual([...DEPARTMENT_ORDER].sort(), ["abaya", "burqa", "hijab", "khimar", "modest-sets", "niqab"].sort());

    // The real failure mode: getCachedCategories() returning every seeded
    // department tied on sortOrder=0, secondary-sorted by name.
    const alphabeticalFromDb = ["abaya", "burqa", "hijab", "khimar", "modest-sets", "niqab"].map((slug) => ({
      _id: slug,
      slug,
      parent: null,
    }));

    const sorted = sortDepartmentsForFavourites(alphabeticalFromDb).map((c) => c.slug);
    assert.deepEqual(sorted, ["burqa", "abaya", "hijab", "niqab", "khimar", "modest-sets"]);
  });

  test("a real storefront department with no DEPARTMENT_ORDER entry (e.g. 'gadget', a marketplace division) sorts after all six known ones (never crashes, never jumps ahead)", () => {
    assert.ok(!DEPARTMENT_ORDER.includes("gadget"), "this test needs a real allowlisted slug that ISN'T in DEPARTMENT_ORDER");
    const withUnknown = [
      { _id: "gadget", slug: "gadget", parent: null },
      { _id: "burqa", slug: "burqa", parent: null },
      { _id: "niqab", slug: "niqab", parent: null },
    ];
    const sorted = sortDepartmentsForFavourites(withUnknown).map((c) => c.slug);
    assert.deepEqual(sorted, ["burqa", "niqab", "gadget"]);
  });

  test("a category outside the STOREFRONT_DEPARTMENT_SLUGS allowlist (e.g. stray test/fixture data) is excluded, never shown", () => {
    const withStray = [
      { _id: "burqa", slug: "burqa", parent: null },
      { _id: "stray", slug: "totally-unrecognized-test-category", parent: null },
    ];
    const sorted = sortDepartmentsForFavourites(withStray).map((c) => c.slug);
    assert.deepEqual(sorted, ["burqa"]);
  });

  test("a child category (parent set) is never included, regardless of slug", () => {
    const withChild = [
      { _id: "burqa", slug: "burqa", parent: null },
      { _id: "burqa-child", slug: "burqa", parent: "burqa" },
    ];
    const sorted = sortDepartmentsForFavourites(withChild);
    assert.equal(sorted.length, 1);
    assert.equal(sorted[0]._id, "burqa");
  });
});
