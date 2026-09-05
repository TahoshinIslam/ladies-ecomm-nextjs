// Phase 10 — static accessibility architecture checks. Same house style
// as tests/imageOptimization.test.mjs: targets known, high-value,
// concretely-checkable rules rather than naive broad regexes that would
// produce large false-positive allowlists.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const abs = (...parts) => path.join(ROOT, ...parts);
const read = (relPath) => fs.readFileSync(abs(relPath), "utf8");

function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function findFiles(dir, { exclude = ["node_modules", ".next", ".git"], extRe = /\.jsx$/ } = {}) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findFiles(full, { exclude, extRe }));
    else if (extRe.test(entry.name)) results.push(full);
  }
  return results;
}

const SCAN_DIRS = ["app", "views", "components"].map((d) => abs(d));
const jsxFiles = SCAN_DIRS.flatMap((d) => findFiles(d));

describe("Phase 10 — skip link and its target exist", () => {
  test("app/layout.js renders a skip-to-content link targeting #main", () => {
    const content = read("app/layout.js");
    assert.match(content, /href="#main"/);
  });

  test("the storefront layout and admin layout each render a real id=\"main\" landmark", () => {
    assert.match(read("app/(routes)/layout.jsx"), /id="main"/);
    assert.match(read("components/admin/AdminLayout.jsx"), /id="main"/);
  });
});

describe("Phase 10 — no positive tabIndex anywhere in scanned source", () => {
  test("no file sets a positive numeric tabIndex (breaks natural, predictable tab order)", () => {
    const offenders = [];
    for (const file of jsxFiles) {
      const content = stripComments(fs.readFileSync(file, "utf8"));
      const matches = [...content.matchAll(/tabIndex=\{?["']?(\d+)["']?\}?/g)];
      for (const m of matches) {
        if (Number(m[1]) > 0) offenders.push(`${path.relative(ROOT, file)} (tabIndex=${m[1]})`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  test("no interactive control is permanently removed from the tab order via tabIndex={-1} gated on a mouse-only hover state", () => {
    // The specific regression this guards: ProductCard.jsx's Quick Add
    // button used to be tabIndex={hovered ? 0 : -1} — keyboard-only users
    // could never reach it. Visibility must be CSS-driven
    // (group-hover/group-focus-within), not tabIndex-driven.
    const content = stripComments(read("components/product/ProductCard.jsx"));
    assert.ok(!/tabIndex=\{hovered/.test(content));
    assert.match(content, /group-focus-within:opacity-100/);
  });
});

describe("Phase 10 — dialog/sheet/drawer components have real dialog semantics and focus management", () => {
  const DIALOG_FILES = [
    "components/ui/Drawer.jsx",
    "components/layout/SearchModal.jsx",
    "components/product/QuickAddSheet.jsx",
    "components/product/ProductFinder.jsx",
  ];

  for (const rel of DIALOG_FILES) {
    test(`${rel} declares role="dialog" and aria-modal`, () => {
      const content = read(rel);
      assert.match(content, /role="dialog"/);
      assert.match(content, /aria-modal="true"/);
    });
  }

  test("components/layout/Header.jsx's mobile nav drawer has dialog semantics and uses the shared focus hook", () => {
    const content = read("components/layout/Header.jsx");
    assert.match(content, /role="dialog"/);
    assert.match(content, /aria-modal="true"/);
    assert.match(content, /useDialogFocus\(/);
  });

  test("SearchModal, QuickAddSheet, and ProductFinder all use the shared hooks/useDialogFocus.js hook (fixes the missing focus-restore-on-close bug found in all three)", () => {
    for (const rel of ["components/layout/SearchModal.jsx", "components/product/QuickAddSheet.jsx", "components/product/ProductFinder.jsx"]) {
      const content = read(rel);
      assert.match(content, /from ["'].*hooks\/useDialogFocus\.js["']/, `${rel} must import the shared dialog-focus hook`);
      assert.match(content, /useDialogFocus\(\{/, `${rel} must call the hook`);
    }
  });

  test("hooks/useDialogFocus.js restores focus to the previously-focused element on close", () => {
    const content = read("hooks/useDialogFocus.js");
    assert.match(content, /previouslyFocused/);
    assert.match(content, /previouslyFocused\?\.focus\?\.\(\)/);
  });
});

describe("Phase 10 — forms expose labels and validation errors accessibly", () => {
  test("components/ui/Input.jsx associates label and input via htmlFor/id, and links errors via aria-describedby/aria-invalid", () => {
    const content = read("components/ui/Input.jsx");
    assert.match(content, /htmlFor=\{inputId\}/);
    assert.match(content, /id=\{inputId\}/);
    assert.match(content, /aria-invalid=\{error/);
    assert.match(content, /aria-describedby=\{errorId/);
  });

  test("components/ui/Input.jsx's password-visibility toggle is keyboard-reachable (no tabIndex={-1}) and its accessible name changes with state", () => {
    const content = read("components/ui/Input.jsx");
    assert.ok(!/tabIndex=\{-1\}/.test(content), "the show/hide password button must stay in the tab order");
    assert.match(content, /showPassword \? "Hide password" : "Show password"/);
  });

  test("the admin Field helper (views/admin/SettingsPage.jsx) and ComboField (views/admin/ProductsPage.jsx) associate label and control via htmlFor/id", () => {
    const settings = read("views/admin/SettingsPage.jsx");
    assert.match(settings, /htmlFor=\{controlId\}/);
    const products = read("views/admin/ProductsPage.jsx");
    assert.match(products, /htmlFor=\{inputId\}/);
  });
});

describe("Phase 10 — carousel has accessible controls and reduced-motion behavior", () => {
  test("views/home/HeroCarousel.jsx exposes a pause/resume control with aria-pressed, and pauses on hover/focus", () => {
    const content = read("views/home/HeroCarousel.jsx");
    assert.match(content, /aria-pressed=\{(userP|p)aused\}/);
    assert.match(content, /onMouseEnter/);
    assert.match(content, /onFocus/);
  });

  test("the auto-advance timer live-tracks prefers-reduced-motion (a 'change' listener, not just a one-time check at mount)", () => {
    const content = read("views/home/HeroCarousel.jsx");
    assert.match(content, /addEventListener\("change"/);
  });

  test("context/ThemeProvider.jsx wraps the app in MotionConfig reducedMotion=\"user\", extending reduced-motion support to every framer-motion animation app-wide", () => {
    const content = read("context/ThemeProvider.jsx");
    assert.match(content, /from ["']framer-motion["']/);
    assert.match(content, /<MotionConfig reducedMotion="user">/);
  });
});

describe("Phase 10 — global focus-visible styles and reduced-motion CSS exist", () => {
  test("app/globals.css defines a focus-visible outline utility and a prefers-reduced-motion media block", () => {
    const content = read("app/globals.css");
    assert.match(content, /:focus-visible\s*\{/);
    assert.match(content, /@media \(prefers-reduced-motion: reduce\)/);
  });
});

describe("Phase 10 — no restrictive viewport/zoom configuration exists", () => {
  test("app/layout.js's viewport export never disables zoom (no maximum-scale=1 / user-scalable=no)", () => {
    const content = read("app/layout.js");
    assert.ok(!/maximumScale/.test(content));
    assert.ok(!/userScalable/.test(content));
  });
});

describe("Phase 10 — Phase 9 image architecture remains intact", () => {
  test("no raw <img> was reintroduced (still zero, per tests/imageOptimization.test.mjs)", () => {
    const RAW_IMG_RE = /<img\b/;
    const offenders = jsxFiles.filter((f) => RAW_IMG_RE.test(stripComments(fs.readFileSync(f, "utf8"))));
    assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), []);
  });

  test("lib/approvedImageSource.js still exists and is still used by the three former exceptions", () => {
    assert.ok(fs.existsSync(abs("lib/approvedImageSource.js")));
  });
});
