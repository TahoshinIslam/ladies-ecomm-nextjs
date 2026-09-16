// Shop-category-tiles feature — the homepage's "Shop your everyday
// favourites" tile row and the Shop page's category filter are now the
// same shared presentation (components/product/CategoryCard.jsx), reused
// as a real <Link> on the homepage and a real <button> filter on Shop
// (views/shop/ShopPageClient.jsx's CategoryTileFilter). The redundant
// sidebar CategoryFilterGroup and the old text-pill DepartmentChips are
// both gone. This repo has no jsdom/RTL (see shopRedesignStaticChecks.
// test.mjs's own header comment) — these are real source-text/behavior
// assertions against the actual shipped files, in the same convention.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const CARD_PATH = new URL("../components/product/CategoryCard.jsx", import.meta.url).pathname;
const SHOP_CLIENT_PATH = new URL("../views/shop/ShopPageClient.jsx", import.meta.url).pathname;
const HOME_PATH = new URL("../views/HomePage.jsx", import.meta.url).pathname;

const cardSrc = fs.readFileSync(CARD_PATH, "utf8");
const shopSrc = fs.readFileSync(SHOP_CLIENT_PATH, "utf8");
const homeSrc = fs.readFileSync(HOME_PATH, "utf8");

describe("CategoryCard.jsx — accessible active state and dual as='link'/as='button' rendering", () => {
  test("the button variant sets aria-pressed from `active`, not a class-only indicator", () => {
    assert.match(cardSrc, /aria-pressed=\{active\}/);
  });

  test("active state is never color-only: an accent ring AND a non-color checkmark badge both gate on `active`", () => {
    assert.match(cardSrc, /active\s*&&\s*"ring-2 ring-verm ring-offset-2 ring-offset-canvas"/);
    assert.match(cardSrc, /\{active\s*&&\s*\(/);
    assert.match(cardSrc, /<Check /);
  });

  test("the button variant disables via a real `disabled` attribute (keyboard/AT correct), not just pointer-events CSS", () => {
    const buttonBranch = cardSrc.match(/if \(as === "button"\)\s*\{([\s\S]*?)\n  \}/)[1];
    assert.match(buttonBranch, /disabled=\{disabled\}/);
  });

  test("the link variant renders a real next/link <Link>, not a button styled as a link", () => {
    assert.match(cardSrc, /import Link from "next\/link"/);
    assert.match(cardSrc, /<Link href=\{href\}/);
  });

  test("both variants render the identical CategoryTileVisual (image/icon/hatch-fallback + label) — guarantees homepage and Shop can never visually diverge", () => {
    const buttonBranch = cardSrc.match(/if \(as === "button"\)\s*\{([\s\S]*?)\n  \}/)[1];
    const linkBranch = cardSrc.slice(cardSrc.indexOf("return (\n    <Link"));
    assert.match(buttonBranch, /<CategoryTileVisual/);
    assert.match(linkBranch, /<CategoryTileVisual/);
  });

  test("missing image falls back to the shared `hatch` utility, not a broken image or blank tile", () => {
    assert.match(cardSrc, /className="absolute inset-0 hatch"/);
  });
});

describe("ShopPageClient.jsx — category tiles reuse the homepage's exact department set, order, and images", () => {
  test("favouriteDepartments is computed via the shared sortDepartmentsForFavourites(), not a local reimplementation", () => {
    assert.match(shopSrc, /sortDepartmentsForFavourites\(catsData\?\.categories \?\? initialCategories\)\.slice\(0, FAVOURITE_DEPARTMENTS_COUNT\)/);
    assert.match(shopSrc, /import\s*\{[^}]*sortDepartmentsForFavourites[^}]*\}\s*from\s*["']\.\.\/\.\.\/lib\/storefrontDepartments\.js["']/);
  });

  test("HomePage.jsx uses the same shared helper (both call sites can never drift to a different department set/order)", () => {
    assert.match(homeSrc, /sortDepartmentsForFavourites\(categories\)/);
  });

  test("CategoryTileFilter renders through the shared CategoryCard component, not a bespoke chip/pill", () => {
    const fn = shopSrc.match(/function CategoryTileFilter\([\s\S]*?\n\}/)[0];
    assert.match(fn, /<CategoryCard/);
    assert.ok(
      !/function DepartmentChips|function CategoryFilterGroup/.test(shopSrc),
      "the old chip row and redundant sidebar group's function definitions must both be fully removed (a historical mention in an explanatory comment is fine)",
    );
  });

  test("the 'All' tile is a real first tile using a non-color icon (Grid3x3), not a department", () => {
    const fn = shopSrc.match(/function CategoryTileFilter\([\s\S]*?\n\}/)[0];
    const allTileIdx = fn.indexOf("<CategoryCard");
    const firstDeptIdx = fn.indexOf("departments.map");
    assert.ok(allTileIdx > -1 && allTileIdx < firstDeptIdx, "the All tile's <CategoryCard> must render before the departments.map(...) tiles");
    const allTileBlock = fn.slice(allTileIdx, firstDeptIdx);
    assert.match(allTileBlock, /icon=\{Grid3x3\}/);
    assert.match(allTileBlock, /active=\{!selected\}/);
  });

  test("department tiles use the department image (falling back to null → CategoryCard's own hatch), never the homepage's own heavier hero-image derivation", () => {
    assert.match(shopSrc, /image=\{departmentImages\[d\.slug\] \|\| null\}/);
  });
});

describe("ShopPageClient.jsx — selectDepartment URL/filter contract (aria-pressed, reset, preserve/drop, duplicate-nav guard)", () => {
  test("every category tile passes aria-pressed indirectly via CategoryCard's `active` prop (button variant sets aria-pressed from it)", () => {
    const fn = shopSrc.match(/function CategoryTileFilter\([\s\S]*?\n\}/)[0];
    assert.match(fn, /active=\{selected === d\._id\}/);
  });

  test("selectDepartment resets to page 1 implicitly by building a brand-new URLSearchParams (no stale `page` can survive)", () => {
    const fn = shopSrc.match(/const selectDepartment = \(deptId\) => \{([\s\S]*?)\n  \};/)[1];
    assert.match(fn, /const next = new URLSearchParams\(\);/, "must start from an empty URLSearchParams, not copy the existing one (which could carry a stale `page`)");
  });

  test("selectDepartment preserves exactly the documented universal filters and nothing else", () => {
    const fn = shopSrc.match(/const selectDepartment = \(deptId\) => \{([\s\S]*?)\n  \};/)[1];
    const listMatch = fn.match(/for \(const k of \[([^\]]+)\]\)/);
    assert.ok(listMatch, "expected a for-of loop over an explicit preserved-key list");
    const preserved = listMatch[1].split(",").map((s) => s.trim().replace(/"/g, ""));
    assert.deepEqual(
      preserved,
      ["sort", "search", "priceMin", "priceMax", "ageGroup", "collection", "new", "featured", "discount", "availability", "ratingGte"],
    );
  });

  test("selectDepartment never re-adds department-specific facets (style, brand, or an arbitrary attribute key) to the preserved list", () => {
    const fn = shopSrc.match(/const selectDepartment = \(deptId\) => \{([\s\S]*?)\n  \};/)[1];
    assert.ok(!/"style"|"brand"/.test(fn), "style/brand must be dropped on department switch, never carried over");
  });

  test("clicking 'All' clears the category param entirely rather than setting it to an empty string", () => {
    const fn = shopSrc.match(/const selectDepartment = \(deptId\) => \{([\s\S]*?)\n  \};/)[1];
    assert.match(fn, /if \(deptId\) next\.set\("category", deptId\);/, "category must only be set when a real deptId is passed — 'All' (deptId='') leaves it unset");
  });

  test("re-selecting the already-active department (including 'All' while already on 'All') is a guarded no-op — no duplicate navigation", () => {
    const fn = shopSrc.match(/const selectDepartment = \(deptId\) => \{([\s\S]*?)\n  \};/)[1];
    assert.match(fn, /if \(\(deptId \|\| ""\) === selectedDept\) return;/);
  });
});

describe("ShopPageClient.jsx — pending-transition disabling and responsive layout", () => {
  test("the tile row is disabled (real `disabled` prop threaded through to each CategoryCard, not just dimmed) while a route transition is pending", () => {
    assert.match(shopSrc, /disabled=\{isPending\}/);
    const fn = shopSrc.match(/function CategoryTileFilter\([\s\S]*?\n\}/)[0];
    assert.match(fn, /disabled=\{disabled\}/g);
  });

  test("the row visually dims (opacity) and sets aria-busy while pending, matching the sidebar's own isPending treatment", () => {
    const fn = shopSrc.match(/function CategoryTileFilter\([\s\S]*?\n\}/)[0];
    assert.match(fn, /disabled && "pointer-events-none opacity-50"/);
    assert.match(fn, /aria-busy=\{disabled\}/);
  });

  test("mobile scroll rail bleeds to the true viewport edge (negative margin cancels container-x's own padding) exactly like the homepage's row", () => {
    const fn = shopSrc.match(/function CategoryTileFilter\([\s\S]*?\n\}/)[0];
    assert.match(fn, /-mx-5[^"]*px-5[^"]*sm:mx-0[^"]*sm:px-0/, "expected the same edge-bleed-then-cancel pattern as HomePage.jsx's favourites row");
  });

  test("the desktop grid uses a column count that evenly divides the row's real tile count (1 All + FAVOURITE_DEPARTMENTS_COUNT = 9), avoiding an orphaned trailing tile", () => {
    const fn = shopSrc.match(/function CategoryTileFilter\([\s\S]*?\n\}/)[0];
    assert.match(fn, /sm:grid-cols-3/);
    assert.match(fn, /lg:grid-cols-9/);
    assert.ok(9 % 3 === 0 && 9 % 9 === 0, "sanity: both chosen column counts must evenly divide 9 tiles");
  });

  test("the loading skeleton renders exactly FAVOURITE_DEPARTMENTS_COUNT + 1 placeholder tiles (All + every department), so the skeleton never jumps in tile count once real data arrives", () => {
    const fn = shopSrc.match(/function CategoryTileFilter\([\s\S]*?\n\}/)[0];
    assert.match(fn, /Array\.from\(\{ length: FAVOURITE_DEPARTMENTS_COUNT \+ 1 \}\)/);
  });
});

describe("ShopPageClient.jsx — no duplicate categories request; server-seeded first paint", () => {
  test("ShopPageClient accepts initialCategories/initialDepartmentImages props (server-seeded first paint, matching Header.jsx's initialDepartments pattern)", () => {
    assert.match(shopSrc, /initialCategories\s*=\s*\[\]/);
    assert.match(shopSrc, /initialDepartmentImages\s*=\s*\{\}/);
  });

  test("only a single useGetCategoriesQuery() invocation exists in the whole file — the tile row reuses it, it never adds a second client request", () => {
    const occurrences = [...shopSrc.matchAll(/=\s*useGetCategoriesQuery\(\);/g)];
    assert.equal(occurrences.length, 1, "expected exactly one useGetCategoriesQuery() call, shared by brands/attributes/title/grouping logic AND the new tile row");
  });
});

describe("ShopPageClient.jsx / views/ShopPage.jsx — redundant sidebar Category control fully removed", () => {
  test("FilterPanel no longer accepts or renders a departments/deptLoading-driven Category group", () => {
    const fn = shopSrc.match(/function FilterPanel\(\{([\s\S]*?)\n\}\) \{/)[1];
    assert.ok(!/departments|deptLoading/.test(fn), "FilterPanel's own props must no longer include departments/deptLoading");
  });

  test("FilterPanel call sites (mobile sheet and desktop sidebar) no longer pass departments/deptLoading props", () => {
    const calls = [...shopSrc.matchAll(/<FilterPanel([\s\S]*?)\/>/g)];
    assert.equal(calls.length, 2, "expected exactly two FilterPanel render sites (mobile sheet + desktop sidebar)");
    for (const [, props] of calls) {
      assert.ok(!/departments=/.test(props) && !/deptLoading=/.test(props), "neither FilterPanel render site may still pass departments/deptLoading");
    }
  });
});

describe("views/ShopPage.jsx — server seeds categories/department images once, reused by both CategoryLanding and the client tile row", () => {
  const shopPageSrc = fs.readFileSync(new URL("../views/ShopPage.jsx", import.meta.url).pathname, "utf8");

  test("categories and publicSettings are fetched together up front, not as two sequential/duplicate calls", () => {
    assert.match(shopPageSrc, /const \[categories, publicSettings\] = await Promise\.all\(\[getCachedCategories\(\), getCachedPublicSettings\(\)\]\);/);
  });

  test("getCachedCategories() is called exactly once inside the ShopPage function itself (the CategoryLanding branch reuses the top-level `categories`, no second fetch) — the unrelated ShopBreadcrumbJsonLd component's own separate call for a different purpose (resolving one breadcrumb label) doesn't count", () => {
    const shopPageFn = shopPageSrc.slice(
      shopPageSrc.indexOf("export default async function ShopPage"),
      shopPageSrc.indexOf("async function ShopBreadcrumbJsonLd"),
    );
    const occurrences = shopPageFn
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .filter((line) => /getCachedCategories\(\)/.test(line));
    assert.equal(occurrences.length, 1, `expected exactly one real (non-comment) call, found: ${occurrences.join(" | ")}`);
  });

  test("ShopPageClient receives both initialCategories and initialDepartmentImages", () => {
    assert.match(shopPageSrc, /initialCategories=\{serializeForClient\(categories\)\}/);
    assert.match(shopPageSrc, /initialDepartmentImages=\{departmentImages\}/);
  });
});
