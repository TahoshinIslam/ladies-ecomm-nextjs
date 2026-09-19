// Confirmed, reproduced bug, fixed: on small screens, Header.jsx rendered
// its own always-visible inline search bar (`<HeaderSearchField />` inside
// the mobile app-shell's full-width row) AND the mobile bottom nav had its
// own separate "Search" tab (opening SearchModal.jsx, a full-screen
// overlay with the same underlying search) — two separate search entry
// points on mobile. The header's inline row is now removed entirely on
// small screens (not merely hidden while the overlay happens to be open),
// leaving the bottom-nav "Search" tab as the one mobile search entry
// point. Desktop is unaffected: it keeps its own `<HeaderSearchField />`
// in the `hidden md:block` row further down, since the bottom nav itself
// is mobile-only.
//
// Static source-text check, same convention as
// tests/headerCategoryMenu.test.mjs (this repo has no jsdom/RTL).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relPath) => fs.readFileSync(new URL(relPath, import.meta.url).pathname, "utf8");
const headerSrc = read("../components/layout/Header.jsx");

describe("Header.jsx — no inline search bar in the mobile app-shell row; the bottom-nav Search tab is the one mobile entry point", () => {
  test("the mobile app-shell's own full-width search row (the old `container-x bg-verm pb-3 md:hidden` block) is gone", () => {
    assert.ok(
      !/<div className=\{?cn?\(?"container-x bg-verm pb-3 md:hidden/.test(headerSrc),
      "the mobile-only inline search row must be removed, not just conditionally hidden",
    );
  });

  test("Header.jsx renders exactly one <HeaderSearchField /> — the desktop-only row", () => {
    const matches = headerSrc.match(/<HeaderSearchField \/>/g) || [];
    assert.equal(matches.length, 1, "only the desktop row's HeaderSearchField should remain");
  });

  test("the desktop search row (hidden md:block) is untouched", () => {
    assert.match(headerSrc, /<div className="hidden bg-verm text-accent-foreground md:block">/);
  });

  test("no longer reads the now-unused ui.searchOpen selector", () => {
    assert.ok(!/s\.ui\.searchOpen/.test(headerSrc), "searchOpen is no longer needed in Header.jsx now that the mobile row is gone outright");
  });
});
