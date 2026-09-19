// Confirmed audit finding, fixed: views/HomePage.jsx had zero <h1> elements
// — every section on the page (favourites row, department grid, featured
// products, newsletter) deliberately uses <h2>/<h3> to match its visual
// hierarchy, so the page never had the single page-level heading WCAG 2.4.6
// and basic SEO both expect. Verified live (a browser `document.querySelectorAll("h1").length`
// check against a real production build returned 0 before this fix, 1 after).
// Every other storefront page already had exactly one <h1>
// (views/shop/ShopPageClient.jsx, views/shop/CategoryLanding.jsx,
// views/product/ProductDetailInteractive.jsx, and the static content pages)
// — this file only needed the homepage fixed.
//
// Static-source check, same house style as tests/priceHistogramCurrency.test.mjs
// and tests/homeDepartmentGridOrder.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (relPath) => fs.readFileSync(path.join(ROOT, relPath), "utf8");

describe("views/HomePage.jsx — page has exactly one <h1>, visually hidden, not a visible design change", () => {
  const source = read("views/HomePage.jsx");

  test("renders a single sr-only <h1> using the existing seo.defaultTitle translation key", () => {
    // Matches the real JSX opening tag (`<h1 className=...`), not the
    // literal string "<h1>" that appears inside this file's own comments.
    const matches = source.match(/<h1 /g) || [];
    assert.equal(matches.length, 1, "the homepage must render exactly one <h1>");
    assert.match(
      source,
      /<h1 className="sr-only">\{t\("seo\.defaultTitle"\)\}<\/h1>/,
      "the h1 must be visually hidden (sr-only) and reuse the localized seo.defaultTitle string, not a new hardcoded one",
    );
  });

  test("existing section headings are untouched (still h2/h3, no visual hierarchy change)", () => {
    assert.match(source, /<h2 id="favourites-h"/);
    assert.match(source, /<h3 className="mt-4 text-\[17px\] font-semibold">\{deptName\}<\/h3>/);
  });
});
