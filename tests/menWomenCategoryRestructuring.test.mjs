// Men/Women gender-division restructuring — the 9 original fashion
// departments (Burqa, Hijab, Niqab, Abaya, Khimar, Modest Sets, T-Shirt,
// Shirts, Jeans) moved from being root categories to sitting one level
// under new top-level "Women"/"Men" divisions. That's exactly the same
// division -> department -> style shape the marketplace-expansion
// categories (Food -> Fruits & Vegetables -> Fresh Fruits) already use, so
// the category tree itself needed no schema change — but several places
// assumed "one of these 9 slugs" implied "a root category," which broke
// once that stopped being true. Static source-text checks, same
// convention as tests/categoryDrillMenuStaticChecks.test.mjs (no jsdom/RTL
// in this repo).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relPath) => fs.readFileSync(new URL(relPath, import.meta.url).pathname, "utf8");

const shopPageSrc = read("../views/ShopPage.jsx");
const drillMenuSrc = read("../components/layout/CategoryDrillMenu.jsx");
const mobileDrawerSrc = read("../components/layout/MobileCategoryDrawer.jsx");
const megaMenuSrc = read("../components/layout/CategoryMegaMenu.jsx");

describe("views/ShopPage.jsx — the FASHION_DEPARTMENT_SLUGS grid-first exemption survives the departments no longer being root categories", () => {
  test("isFashionDept is matched by slug alone, not \"is this a root category\"", () => {
    assert.match(shopPageSrc, /const isFashionDept = requestedCategory && FASHION_DEPARTMENT_SLUGS\.includes\(requestedCategory\.slug\);/);
    assert.ok(!/isFashionDept =\s*\n?\s*requestedCategory && !requestedCategory\.parent/.test(shopPageSrc), "must not require !parent any more — Burqa etc. now have a real parent (Women)");
  });
});

describe("lib/storefrontDepartments.js — sortDepartmentsForFavourites keeps showing the 9 departments even though they're no longer root categories", () => {
  test("the filter is slug membership alone, not \"is this a root category\"", () => {
    const src = read("../lib/storefrontDepartments.js");
    assert.match(src, /\.filter\(\(c\) => STOREFRONT_DEPARTMENT_SLUGS\.includes\(c\.slug\)\)/);
    assert.ok(!/!c\.parent && STOREFRONT_DEPARTMENT_SLUGS/.test(src), "must not require !c.parent — that would silently empty the favourites row once these departments got a real parent");
  });
});

describe("CategoryDrillMenu.jsx — mid-column links never use the broken category+style composite for a non-leaf item", () => {
  test("a mid-column item with its own children links to /shop?category=<itself>, not /shop?category=<parent>&style=<itself>", () => {
    assert.match(drillMenuSrc, /const href = grandkids\.length > 0 \? `\/shop\?category=\$\{c\._id\}` : `\/shop\?style=\$\{c\._id\}`;/);
    assert.ok(!/category=\$\{hoverId\}&style=\$\{c\._id\}/.test(drillMenuSrc), "the old composite href (0 results for any non-leaf mid item, e.g. Burqa under Women or Food's Fruits & Vegetables) must be gone");
  });
});

describe("MobileCategoryDrawer.jsx — same fix: links are keyed on the node's OWN children, never on how deep it sits", () => {
  test("linkFor picks category=<id> for a node with children, style=<id> for a genuine leaf — regardless of depth", () => {
    assert.match(mobileDrawerSrc, /const linkFor = \(node\) => \(hasChildren\(node\) \? `\/shop\?category=\$\{node\._id\}` : `\/shop\?style=\$\{node\._id\}`\);/);
  });

  test("the old depth-keyed hrefAt/hrefFor (broken for any mid-tier department that itself has children) is fully removed", () => {
    assert.ok(!/hrefAt/.test(mobileDrawerSrc), "hrefAt must be gone entirely — depth-based href selection is exactly what broke here");
    assert.ok(!/hrefFor/.test(mobileDrawerSrc));
  });

  test("both the leaf list-item links and the trailing \"Shop all in this category\" link go through the same linkFor", () => {
    const occurrences = [...mobileDrawerSrc.matchAll(/href=\{linkFor\(/g)];
    assert.equal(occurrences.length, 2, "expected linkFor used for both the per-item link and the current-category 'Shop all' link");
  });
});

describe("CategoryMegaMenu.jsx — Mars/Venus icons are registered for the new Men/Women divisions", () => {
  test("CATEGORY_ICONS maps 'mars' and 'venus' icon keys", () => {
    assert.match(megaMenuSrc, /mars: Mars,/);
    assert.match(megaMenuSrc, /venus: Venus,/);
  });
});
