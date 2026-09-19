// The bottom tab bar (MobileNav) shows on phones AND tablets — i.e. below the
// `lg` breakpoint, the same one where the header switches to its hamburger
// drawer and the product page shows its sticky purchase bar. These checks pin
// that the three stay in step, and that everything the bar would otherwise
// cover (page end/footer, compare tray) makes room for it.
// Static source-text checks, this repo's house style (no jsdom/RTL).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url).pathname, "utf8");
// MobileNav is 66px of tabs + a 1px top border + max(10px, safe-area) padding.
const NAV_RESERVE = "calc(67px+max(10px,env(safe-area-inset-bottom)))";

describe("MobileNav breakpoint", () => {
  const nav = read("components/layout/MobileNav.jsx");

  test("is visible below lg (phones and tablets), hidden from lg up — not hidden at md any more", () => {
    const cls = /<nav[\s\S]*?className="([^"]+)"/.exec(nav)[1];
    assert.match(cls, /\bfixed\b/);
    assert.match(cls, /\blg:hidden\b/);
    assert.doesNotMatch(cls, /\bmd:hidden\b/);
  });

  test("uses the same breakpoint as the header's hamburger drawer and the product page's sticky purchase bar", () => {
    assert.match(read("components/layout/Header.jsx"), /focus-ring lg:hidden"/, "hamburger button is lg:hidden");
    assert.match(read("views/product/ProductDetailInteractive.jsx"), /shadow-sheet lg:hidden"/, "sticky purchase bar is lg:hidden");
  });
});

describe("space is reserved for the bar wherever it shows", () => {
  test("the page wrapper pads its END (so the footer is never covered) below lg only, using the bar's full height (incl. its border)", () => {
    const shell = read("components/layout/StorefrontShell.jsx");
    assert.ok(shell.includes(`pb-[${NAV_RESERVE}] lg:pb-0`), "wrapper reserves the nav height below lg");
    assert.doesNotMatch(shell, /pb-\[76px\]/, "the old main-only padding (which ended above the footer) is gone");
  });

  test("the compare tray sits above the bar below lg and flush with the bottom from lg", () => {
    const tray = read("components/product/CompareTray.jsx");
    assert.ok(tray.includes(`bottom-[${NAV_RESERVE}]`));
    assert.match(tray, /lg:bottom-0/);
  });

  test("the reserve is MobileNav's own 66px row + 1px border + max(10px, safe-area) padding", () => {
    const nav = read("components/layout/MobileNav.jsx");
    assert.match(nav, /h-\[66px\]/);
    assert.match(nav, /pb-\[max\(10px,env\(safe-area-inset-bottom\)\)\]/);
    assert.match(read("views/product/ProductDetailInteractive.jsx"), /bottom: "calc\(66px \+ max\(10px, env\(safe-area-inset-bottom\)\)\)"/);
  });
});
