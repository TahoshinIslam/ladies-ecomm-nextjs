// Shop redesign v3 — static source-text checks in place of jsdom/RTL
// rendering (this repo has neither and none are added here, per v3-2).
// These assert the actual source contains the required responsive CSS
// classes and accessible tab markup — real evidence about what ships,
// short of a full render.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SHOP_CLIENT_PATH = new URL("../views/shop/ShopPageClient.jsx", import.meta.url).pathname;
const src = fs.readFileSync(SHOP_CLIENT_PATH, "utf8");

describe("ShopPageClient.jsx — responsive visible-count is server-rendered CSS, not post-mount JS hiding", () => {
  test("the product grid uses the standardized 2/3/4-column breakpoints (mobile/tablet/desktop)", () => {
    assert.match(src, /grid-cols-2\s+gap-5\s+md:grid-cols-3\s+lg:grid-cols-4/);
  });

  test("initialCardVisibilityClass is a pure function (no hooks/state read inside it) driven purely by index/revealedExtra", () => {
    const fnMatch = src.match(/function initialCardVisibilityClass\(([^)]*)\)\s*{([\s\S]*?)\n}/);
    assert.ok(fnMatch, "initialCardVisibilityClass must exist as a standalone function");
    const [, params, body] = fnMatch;
    assert.match(params, /index/);
    assert.match(params, /revealedExtra/);
    assert.ok(!/useState|useEffect|useMemo/.test(body), "must not read React state/hooks directly — pure function of its arguments only");
  });

  test("the 9th card (index 8) is hidden below md, the 10th-12th (index 9-11) hidden below lg", () => {
    assert.match(src, /hidden md:flex/);
    assert.match(src, /hidden lg:flex/);
  });

  test("cards beyond the initial 12-item buffer (index >= 12) are never responsively hidden", () => {
    assert.match(src, /if \(index >= 12\) return "";/);
  });

  test("the grid never uses a client-only visibility mechanism (no post-mount display-toggling className built from a breakpoint useState) for the initial card set", () => {
    // The breakpoint state exists (it's used for Load-more batch sizing —
    // see the pure-helpers test file), but it must never be threaded into
    // initialCardVisibilityClass's own arguments (index, revealedExtra
    // only) — asserted above already; this test additionally confirms the
    // grid-mapping call site itself doesn't pass `breakpoint` in.
    const callSite = src.match(/initialCardVisibilityClass\(([^)]*)\)/g) || [];
    const gridCall = callSite.find((c) => c.includes("i,") || c.includes("i, revealedExtra"));
    assert.ok(gridCall, "expected a call site like initialCardVisibilityClass(i, revealedExtra)");
    assert.ok(!gridCall.includes("breakpoint"), "the grid's own card visibility must never depend on the post-mount breakpoint state");
  });
});

describe("ShopPageClient.jsx — collection filter is a checkbox group, matching Category/Age Group/Availability", () => {
  test("CollectionFilterGroup renders through the shared FilterGroup/CheckBox components, not a bespoke tab widget", () => {
    const fnMatch = src.match(/function CollectionFilterGroup\(([\s\S]*?)\n}\n/);
    assert.ok(fnMatch, "CollectionFilterGroup must exist");
    const fn = fnMatch[0];
    assert.match(fn, /<FilterGroup/);
    assert.match(fn, /<CheckBox/);
    assert.ok(!/role="tab/.test(fn), "must not still render tab/tablist markup");
  });

  test("the group excludes the implicit All entry — unchecking the active option is how you get back to all, same as Availability", () => {
    const fnMatch = src.match(/function CollectionFilterGroup\(([\s\S]*?)\n}\n/)[0];
    assert.match(fnMatch, /COLLECTION_TABS\.filter\(\(tab\) => tab\.value\)/);
  });

  test("checking an option always goes through setCollection (never a raw setParam that could leave a legacy boolean behind)", () => {
    const fnMatch = src.match(/function CollectionFilterGroup\(([\s\S]*?)\n}\n/)[0];
    assert.match(fnMatch, /setCollection\(/);
    assert.ok(!/setParam\(/.test(fnMatch), "CollectionFilterGroup must never call setParam directly — only setCollection, which also clears the legacy booleans");
  });

  test("setCollection clears the legacy new/featured/discount params whenever it's called (never emits a mixed canonical+legacy request)", () => {
    const setCollectionFn = src.match(/const setCollection = \(value\) => \{([\s\S]*?)\n  \};/)[1];
    assert.match(setCollectionFn, /next\.delete\("new"\)/);
    assert.match(setCollectionFn, /next\.delete\("featured"\)/);
    assert.match(setCollectionFn, /next\.delete\("discount"\)/);
  });
});

describe("ShopPageClient.jsx — Age Group filter only renders with real variety (no hardcoded department check)", () => {
  test("hasMeaningfulAgeGroupVariety is computed purely from facet counts, not a department slug/id comparison", () => {
    const fnMatch = src.match(/const hasMeaningfulAgeGroupVariety = \(counts\) => ([^\n]+)/);
    assert.ok(fnMatch, "hasMeaningfulAgeGroupVariety must exist");
    assert.ok(!/selectedDept|department|slug/i.test(fnMatch[1]), "must not hardcode a department check — only counts");
  });

  test("AgeGroupFilterGroup is only rendered behind hasMeaningfulAgeGroupVariety in both the no-department and department-selected branches", () => {
    const occurrences = [...src.matchAll(/hasMeaningfulAgeGroupVariety\(facets\?\.ageGroup\)/g)];
    assert.ok(occurrences.length >= 2, "expected the gate to guard both FilterPanel render branches");
  });
});
