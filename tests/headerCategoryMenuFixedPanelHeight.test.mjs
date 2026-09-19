// Confirmed feedback, fixed: HeaderCategoryMenu.jsx used to measure the
// homepage hero carousel's real rendered box at runtime and match this
// panel's own height/top-offset to it — which made the panel visibly
// taller on the homepage (up to 560px) than on every other page (a flat
// 420px). Reverted to one static height everywhere, regardless of page.
//
// Static source-text check, same convention as tests/headerCategoryMenu.test.mjs
// (this repo has no jsdom/RTL).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relPath) => fs.readFileSync(new URL(relPath, import.meta.url).pathname, "utf8");
const menuSrc = read("../components/layout/HeaderCategoryMenu.jsx");
const homeSrc = read("../views/HomePage.jsx");

describe("HeaderCategoryMenu.jsx — one fixed panel height on every page, no per-page measurement", () => {
  test("the panel's height is a single static Tailwind class, not conditional on any measured value", () => {
    assert.match(menuSrc, /className="h-\[min\(560px,calc\(100vh-220px\)\)\]/);
  });

  test("the hero-measurement mechanism (ResizeObserver, ` data-home-hero-carousel` lookup, per-page geometry state) is fully removed", () => {
    assert.doesNotMatch(menuSrc, /ResizeObserver/);
    assert.doesNotMatch(menuSrc, /heroGeometry/);
    assert.doesNotMatch(menuSrc, /data-home-hero-carousel/);
    assert.doesNotMatch(menuSrc, /useLayoutEffect/);
  });

  test("HomePage.jsx no longer tags its hero carousel for this panel to measure", () => {
    assert.doesNotMatch(homeSrc, /data-home-hero-carousel/);
  });
});
