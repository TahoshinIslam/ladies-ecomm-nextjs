// CategoryDrillMenu.jsx — the shared hover drill-down rendered by both CategorySidebar.jsx (the homepage's always-expanded list) and
// HeaderCategoryMenu.jsx (the header's hover-to-open "All Categories" trigger). It opens one column per level, as deep as the category
// tree goes (Food -> Snacks -> Biscuits -> Milk Biscuits ...). Static source-text checks, same convention as
// tests/shopRedesignStaticChecks.test.mjs (this repo has no jsdom/RTL). Regression coverage for real bugs found in manual testing:
//   1. A leaf category (no real children) was showing a chevron anyway.
//   2. Every subcategory showed one generic grid icon, indistinguishable from any other department's subcategories.
//   3. A column to the right popped up before anything in the column before it had been hovered, or as an empty panel.
//   4. The menu stopped at three levels although the categories nest deeper.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC_PATH = new URL("../components/layout/CategoryDrillMenu.jsx", import.meta.url).pathname;
const src = fs.readFileSync(SRC_PATH, "utf8");

describe("CategoryDrillMenu.jsx — chevrons only render for a real, non-empty child list", () => {
  test("every row computes its own children via childrenOf(node._id) and gates the chevron on kids.length > 0 — never unconditional", () => {
    assert.match(src, /const kids = childrenOf\(node\._id\);/);
    assert.match(src, /\{kids\.length > 0 && \(\s*\n\s*<ChevronRight/);
  });
  test("one row renderer serves every column, so a deep level cannot drift from the first", () => {
    assert.equal([...src.matchAll(/<ChevronRight/g)].length, 1);
    assert.equal([...src.matchAll(/const renderRow = /g)].length, 1);
  });
});

describe("CategoryDrillMenu.jsx — icons are inherited from the nearest ancestor with one set, never a flat generic fallback for every subcategory", () => {
  test("effectiveIconFor walks the parent chain looking for a real `icon` field before falling back", () => {
    const fnMatch = src.match(/function effectiveIconFor\(category, categories\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(fnMatch, "effectiveIconFor must exist");
    assert.match(fnMatch[1], /if \(current\.icon\) return iconFor\(current\.icon\);/);
    assert.match(fnMatch[1], /current = categories\.find/);
  });

  test("every row resolves its icon via effectiveIconFor, not a bare iconFor(c.icon) that would always show the generic fallback for subcategories", () => {
    assert.equal([...src.matchAll(/const Icon = effectiveIconFor\(/g)].length, 1, "the single row renderer must call effectiveIconFor");
    assert.ok(!/const Icon = iconFor\(/.test(src));
  });
});

describe("CategoryDrillMenu.jsx — as many columns as the tree is deep, each opening only from an explicit hover/focus", () => {
  test("the open path is a list (one entry per level), not a fixed hover/mid pair", () => {
    assert.match(src, /const \[path, setPath\] = useState\(\[\]\);/);
    assert.ok(!/activeMidId|midColumn|rightColumn/.test(src), "the old fixed three-column state must be gone");
  });

  test("columns are built by walking the path and stop at the first node with no children — never an empty panel", () => {
    const loop = src.slice(src.indexOf("const columns = []"), src.indexOf("// Hovering/focusing a node"));
    assert.match(loop, /for \(let level = 0; level < path\.length; level \+= 1\)/);
    assert.match(loop, /if \(!kids\.length\) break;/);
    assert.ok(!/level < [0-9]/.test(loop), "no fixed level cap");
  });

  test("hovering or focusing a node opens it at its level and closes everything deeper", () => {
    assert.match(src, /openAt = \(level, id\) =>/);
    assert.match(src, /p\.slice\(0, level \+ 1\)/);
    assert.match(src, /\[\.\.\.p\.slice\(0, level\), id\]/);
  });

  test("a node with children links to /shop?category=<itself> (every product beneath it); a leaf links to /shop?style=<itself>", () => {
    assert.match(src, /hasKids \? `\/shop\?category=\$\{node\._id\}` : `\/shop\?style=\$\{node\._id\}`/);
  });

  test("the flyout is one flex row of columns that scrolls sideways rather than spilling off-screen, and has no fixed width reserving room for columns that do not exist", () => {
    const className = src.match(/absolute left-full top-0 z-\[95\][^"]*/)[0];
    assert.match(className, /overflow-x-auto/);
    assert.match(className, /max-w-\[calc\(100vw-/);
    assert.ok(!/w-\[440px\]/.test(className));
  });

  test("keyboard: Tab from a row with children enters its column; Shift+Tab from the first row of a column returns to the parent row", () => {
    assert.match(src, /focusItem\(kids\[0\]\._id\)/);
    assert.match(src, /e\.shiftKey && firstInColumn && level > 0/);
    assert.match(src, /focusItem\(path\[level - 1\]\)/);
  });

  test("the flyout is a SIBLING of the scrolling <ul> (no ancestor overflow clipping it), and every column shares py-2.5 rows and a py-1 wrapper", () => {
    assert.match(src, /<ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-\[22px\] py-1">/);
    assert.match(src, /px-4 py-2\.5 text-\[13\.5px\]/);
    assert.match(src, /divide-y divide-line overflow-y-auto border-r border-line py-1/);
  });

  test("an empty 'nothing further' message never exists", () => {
    assert.ok(!/noFurtherStyles/.test(src));
  });
});
