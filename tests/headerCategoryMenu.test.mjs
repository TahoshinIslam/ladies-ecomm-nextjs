// "All Categories" header nav entry (HeaderCategoryMenu.jsx) — the
// storefront's one shared category entry point (rendered on every page's
// nav row, not just /shop), reusing the exact same drill-down markup as
// every other category UI via the shared CategoryDrillMenu.jsx. Static
// source-text checks, same convention as
// tests/categoryDrillMenuStaticChecks.test.mjs (this repo has no jsdom/RTL).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relPath) => fs.readFileSync(new URL(relPath, import.meta.url).pathname, "utf8");

const headerSrc = read("../components/layout/Header.jsx");
const sidebarSrc = read("../components/layout/CategorySidebar.jsx");
const menuSrc = read("../components/layout/HeaderCategoryMenu.jsx");

describe("Header.jsx — the old hardcoded department shortcuts are fully removed", () => {
  test("the nav row no longer maps over departments.slice(0, 3) — those individual department links are gone", () => {
    assert.ok(!/departments\.slice\(0, 3\)/.test(headerSrc), "the 3 hardcoded department shortcut links must be removed from the header nav");
  });

  test("the now-unused `departments` local variable and departmentName import were removed too, not left as dead code", () => {
    assert.ok(!/const departments = allCategories\.filter/.test(headerSrc));
    assert.ok(!/import \{ departmentName \} from "\.\.\/\.\.\/lib\/i18n\/catalog\.js"/.test(headerSrc));
  });

  // HeaderCategoryMenu sits at the far left of the nav row, beside the
  // primary Home/Shop/New/Deals/Contact links (see
  // tests/headerNavCenteringAndDrawerPersistence.test.mjs for that layout
  // and its storefront-wide, not /shop-only, rendering) — this just
  // confirms it still exists somewhere in the header, rendered with the
  // real categories prop.
  test("HeaderCategoryMenu is rendered in the header, passed the real categories list", () => {
    assert.match(headerSrc, /<HeaderCategoryMenu categories=\{allCategories\}/);
  });
});

describe("CategorySidebar.jsx and HeaderCategoryMenu.jsx — both delegate to the same shared CategoryDrillMenu, never a re-implementation", () => {
  test("CategorySidebar.jsx renders CategoryDrillMenu, not its own copy of the drill-down markup", () => {
    assert.match(sidebarSrc, /import CategoryDrillMenu from "\.\/CategoryDrillMenu\.jsx"/);
    assert.match(sidebarSrc, /<CategoryDrillMenu categories=\{categories\}/);
    assert.ok(!/function effectiveIconFor/.test(sidebarSrc), "the icon-inheritance logic must live only in CategoryDrillMenu.jsx now");
  });

  test("HeaderCategoryMenu.jsx renders CategoryDrillMenu, not its own copy of the drill-down markup", () => {
    assert.match(menuSrc, /import CategoryDrillMenu from "\.\/CategoryDrillMenu\.jsx"/);
    assert.match(menuSrc, /<CategoryDrillMenu categories=\{categories\}/);
  });
});

describe("HeaderCategoryMenu.jsx — hover-opens (unpinned) and click-toggles (pinned), never auto-opens on Tab focus", () => {
  test("mouse-enter on the wrapper opens it, gated on pinned/suppressed state and a real hover-capable+fine pointer (never unconditional)", () => {
    assert.match(menuSrc, /const handleMouseEnter = \(\) => \{/);
    assert.match(menuSrc, /if \(pinned \|\| suppressHoverRef\.current \|\| !hoverCapable\(\)\) return;/);
    assert.match(menuSrc, /setOpen\(true\);/);
    assert.match(menuSrc, /onMouseEnter=\{handleMouseEnter\}/);
  });

  test("mouse-leave closes it after a short delay, unless it's pinned", () => {
    assert.match(menuSrc, /const handleMouseLeave = \(\) => \{/);
    assert.match(menuSrc, /if \(pinned\) return;/);
    assert.match(menuSrc, /closeTimerRef\.current = setTimeout\(\(\) => setOpen\(false\), CLOSE_DELAY_MS\);/);
    assert.match(menuSrc, /onMouseLeave=\{handleMouseLeave\}/);
  });

  test("clicking the trigger opens+pins from closed, pins an already-open hover state, and closes an already-pinned one (suppressing an immediate hover reopen)", () => {
    const fn = menuSrc.match(/const handleTriggerClick = \(\) => \{[\s\S]*?\n  \};/)[0];
    assert.match(fn, /if \(!open\) \{\s*\n\s*setOpen\(true\);\s*\n\s*setPinned\(true\);/);
    assert.match(fn, /if \(!pinned\) \{\s*\n\s*\/\/ Hover already opened it/);
    assert.match(fn, /setOpen\(false\);\s*\n\s*setPinned\(false\);\s*\n\s*suppressHoverRef\.current = true;/);
  });

  test("clicking any real link inside the drill-down closes the dropdown immediately via onNavigate, instead of waiting on mouseleave", () => {
    assert.match(menuSrc, /onNavigate=\{close\}/);
  });

  test("the trigger never opens the menu just from receiving focus — no onFocus handler sets it open", () => {
    assert.ok(!/onFocus=\{\(\) => setOpen\(true\)\}/.test(menuSrc), "focusing the trigger (e.g. via Tab) must not by itself open the panel — only hover, click, or a native Enter/Space activation may");
  });

  test("Escape closes it and returns focus to the trigger", () => {
    assert.match(menuSrc, /if \(e\.key !== "Escape"\) return;/);
    assert.match(menuSrc, /triggerRef\.current\?\.focus\(\);/);
  });

  test("an outside click closes it without touching focus", () => {
    assert.match(menuSrc, /if \(containerRef\.current && !containerRef\.current\.contains\(e\.target\)\) close\(\);/);
  });

  test("losing focus to something outside the trigger+panel also closes it", () => {
    assert.match(menuSrc, /const handleBlur = \(e\) => \{/);
    assert.match(menuSrc, /onBlur=\{handleBlur\}/);
  });

  test("the trigger is a real button exposing aria-haspopup/aria-expanded/aria-controls — plain button semantics, not the full ARIA menu pattern", () => {
    assert.match(menuSrc, /aria-haspopup="true"/);
    assert.match(menuSrc, /aria-expanded=\{open\}/);
    assert.match(menuSrc, /aria-controls=\{panelId\}/);
  });

  test("the dropdown is only rendered at all when there's at least one real top-level department — never an empty popup", () => {
    assert.match(menuSrc, /if \(!categories\?\.\s*some\(\(c\) => !c\.parent\)\) return null;/);
  });
});
