// MobileCategoryDrawer.jsx — active-state highlighting. Previously every
// row (department button or leaf link) rendered identically regardless of
// whether it was the category/style the shopper was actually viewing —
// "everything is white, active or non active." Static source-text checks,
// same convention as tests/categoryDrillMenuStaticChecks.test.mjs (no
// jsdom/RTL in this repo).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../components/layout/MobileCategoryDrawer.jsx", import.meta.url).pathname, "utf8");

describe("MobileCategoryDrawer.jsx — active state is derived from the real URL, not a separately-tracked click flag", () => {
  test("isActive reads useSearchParams() directly — a node with children matches a bare ?category=<id> (no ?style=), a leaf matches ?style=<id>", () => {
    assert.match(src, /import \{ useSearchParams \} from "next\/navigation";/);
    assert.match(src, /const sp = useSearchParams\(\);/);
    const isActiveFn = src.match(/const isActive = \(node\) =>[\s\S]*?;/)[0];
    assert.match(isActiveFn, /hasChildren\(node\) \? sp\.get\("category"\) === String\(node\._id\) && !sp\.get\("style"\) : sp\.get\("style"\) === String\(node\._id\)/);
  });

  test("deriving from the URL (not internal state) means the drawer shows the right thing even after a fresh load, Back/Forward, or reaching the page via a completely different UI (e.g. the desktop hover menu)", () => {
    // Documented via the isActive comment itself — assert the reasoning
    // survives, since it's the whole point of reading from sp rather than
    // tracking "last clicked" locally.
    assert.match(src, /even after a fresh page load, a Back\/Forward navigation, or reaching the\s*\n\s*\/\/ same page a completely different way/);
  });
});

describe("MobileCategoryDrawer.jsx — the active row uses a non-color-only cue, matching CategoryDrillMenu.jsx's own convention", () => {
  test("both the department button and the leaf link apply bg-verm + accent-foreground text when active, not just a color change on otherwise-identical rows", () => {
    assert.match(src, /const rowClasses = `flex items-center gap-3 border-b border-line px-4 py-3\.5 text-\[15px\] transition-colors focus-ring \$\{\s*\n\s*active \? "bg-verm text-accent-foreground" : "text-ink hover:bg-wash"\s*\n\s*\}`;/);
  });

  test("both the button and link branches actually use rowClasses, so neither can silently drift out of sync with the other", () => {
    const occurrences = [...src.matchAll(/rowClasses/g)];
    assert.ok(occurrences.length >= 3, "expected rowClasses defined once and consumed by both the button and Link branches");
  });

  test("the icon and chevron also switch to a light color when active, so they stay legible against the solid green fill", () => {
    assert.match(src, /active \? "text-accent-foreground" : "text-stone"/);
    assert.match(src, /active \? "text-accent-foreground\/70" : "text-stone"/);
  });
});
