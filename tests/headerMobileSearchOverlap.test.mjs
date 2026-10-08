// Mobile search: one entry point per screen size, never two at once. On phones the header has a full-width search field under the
// logo bar (`md:hidden`) and the bottom bar has no Search tab (its middle tab is Categories); from md up the header's main row
// carries its own field (`hidden md:block`), centred between the logo and the actions.
//
// Static source-text check, same convention as
// tests/headerCategoryMenu.test.mjs (this repo has no jsdom/RTL).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relPath) => fs.readFileSync(new URL(relPath, import.meta.url).pathname, "utf8");
const headerSrc = read("../components/layout/Header.jsx");

describe("Header.jsx — a search field on phones and another from md up, never both visible", () => {
  test("the phone-only search row sits under the logo bar and is hidden from md up", () => {
    assert.match(headerSrc, /<div className="bg-verm pb-3 md:hidden">\s*<div className="container-x">\s*<HeaderSearchField \/>/);
  });

  test("the main row's own field is the md-and-up one, in the middle column of an equal-outer-tracks grid (page centre)", () => {
    assert.match(headerSrc, /<div className="hidden bg-verm text-accent-foreground md:block">/);
    assert.match(headerSrc, /grid-cols-\[1fr_minmax\(220px,520px\)_1fr\]/);
    assert.equal((headerSrc.match(/<HeaderSearchField \/>/g) || []).length, 2, "one for phones, one for md and up");
  });

  test("the bottom bar has no Search tab any more (it would be a second phone entry point); its middle tab opens the category drawer", () => {
    const nav = read("../components/layout/MobileNav.jsx");
    assert.ok(!/toggleSearch/.test(nav));
    assert.match(nav, /toggleMobileMenu/);
    assert.match(nav, /navigation\.categories/);
  });

  test("no longer reads the now-unused ui.searchOpen selector", () => {
    assert.ok(!/s\.ui\.searchOpen/.test(headerSrc));
  });
});
