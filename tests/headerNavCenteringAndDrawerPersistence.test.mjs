// Header.jsx nav layout + MobileCategoryDrawer.jsx drill-down persistence
// — static source-text checks, same convention as
// tests/headerCategoryMenu.test.mjs (this repo has no jsdom/RTL).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relPath) => fs.readFileSync(new URL(relPath, import.meta.url).pathname, "utf8");

const headerSrc = read("../components/layout/Header.jsx");
const drawerSrc = read("../components/layout/MobileCategoryDrawer.jsx");

describe("Header.jsx — HeaderCategoryMenu (\"All Categories\") is rendered storefront-wide, not gated to /shop", () => {
  test("HeaderCategoryMenu is rendered unconditionally in the nav row (no pathname check gating it)", () => {
    assert.match(headerSrc, /<HeaderCategoryMenu categories=\{allCategories\} className="hidden lg:flex" \/>/);
    assert.ok(
      !/\{pathname === "\/shop" && <HeaderCategoryMenu/.test(headerSrc),
      "HeaderCategoryMenu must no longer be gated to /shop — the homepage no longer has its own always-visible CategorySidebar",
    );
  });

  test("the trigger is hidden below lg — the hamburger's own mobile drawer already covers category access at that breakpoint, so both together would be a duplicate control", () => {
    assert.match(headerSrc, /<HeaderCategoryMenu categories=\{allCategories\} className="hidden lg:flex" \/>/);
  });
});

describe("Header.jsx — the nav row is a left-anchored flex row (trigger + primary links together), not a 3-column centered grid", () => {
  test("the nav row uses container-x (the same shared page-width utility as the hero/footer/every other section), not the old grid-cols-[1fr_auto_1fr] centering or a hand-rolled px-5/px-8/px-14 scale", () => {
    assert.match(headerSrc, /container-x flex items-center gap-6"/);
    assert.ok(!/grid-cols-\[1fr_auto_1fr\]/.test(headerSrc), "the center-balancing grid is gone now that the nav sits beside the trigger instead of needing to stay mathematically centered");
    assert.ok(!/px-5 sm:px-8 lg:px-14/.test(headerSrc), "the header's rows must share container-x's own padding, not a separately hand-tuned breakpoint scale that can drift out of sync with it");
  });

  test("the hamburger button and the All Categories trigger share the row's first flex group, immediately followed by the primary nav — no trailing empty spacer column", () => {
    const navRow = headerSrc.slice(headerSrc.indexOf('container-x flex items-center gap-6"'), headerSrc.indexOf('<nav aria-label="Primary"'));
    assert.match(navRow, /toggleMobileMenu/);
    assert.match(navRow, /HeaderCategoryMenu categories=\{allCategories\}/);
    const afterNav = headerSrc.slice(headerSrc.indexOf('<nav aria-label="Primary"'));
    assert.ok(!/<div aria-hidden="true" \/>/.test(afterNav), "the empty spacer column that balanced the old centered grid must be gone");
  });
});

describe("MobileCategoryDrawer.jsx — drill-down state is lifted to Header.jsx, not owned locally", () => {
  test("the drawer no longer holds its own path state (that reset to [] every time AnimatePresence unmounted it on close)", () => {
    assert.ok(!/const \[path, setPath\] = useState/.test(drawerSrc), "path/setPath must come in as props from Header.jsx, not be re-created here");
    assert.ok(!/import \{ useState \} from "react"/.test(drawerSrc), "no more local state means no more need for useState in this file");
  });

  test("the component signature accepts path and setPath as props", () => {
    assert.match(drawerSrc, /export default function MobileCategoryDrawer\(\{ categories, locale, t, path, setPath, onNavigate \}\)/);
  });

  test("Header.jsx owns the lifted state and passes it down to the drawer", () => {
    assert.match(headerSrc, /const \[mobileCategoryPath, setMobileCategoryPath\] = useState\(\[\]\);/);
    assert.match(headerSrc, /path=\{mobileCategoryPath\}/);
    assert.match(headerSrc, /setPath=\{setMobileCategoryPath\}/);
  });

  test("Header.jsx never resets mobileCategoryPath on route change — only closes the drawer (mobileMenuOpen), so reopening it lands back where the shopper left off", () => {
    const effectBlock = headerSrc.match(/useEffect\(\(\) => \{\s*dispatch\(setMobileMenuOpen\(false\)\);\s*\}, \[pathname, dispatch\]\);/);
    assert.ok(effectBlock, "expected the existing route-change effect that only closes the drawer");
    assert.ok(!/setMobileCategoryPath/.test(effectBlock[0]), "this effect must not also reset the category drill-down path");
  });
});
