// Phase 9 — static image-architecture checks. Text-based, following the
// same house style as tests/serverCacheArchitecture.test.mjs: proves
// concrete, executable invariants (a component imports next/image, a
// remaining raw <img> is on an explicit, reasoned allowlist, a fill image
// declares sizes) rather than anything about wording/formatting.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const abs = (...parts) => path.join(ROOT, ...parts);
const read = (relPath) => fs.readFileSync(abs(relPath), "utf8");

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

// Only .jsx files render real JSX — lib/receipt.js's <img> lives inside a
// plain-JS template-literal HTML string for a print window (never React
// rendering), so scanning only .jsx deliberately excludes it rather than
// needing it on this allowlist too.
const SCAN_DIRS = ["app", "views", "components"].map((d) => abs(d));
const jsxFiles = SCAN_DIRS.flatMap((d) => findFiles(d));

// Strips `//` line comments and `/* */` block comments so a plain regex
// check can't be fooled by prose that happens to mention "<img>" or
// "fill" (this file's own source has both — e.g. CheckoutPage.jsx's
// comment explaining why it avoids a raw <img>). Not a real JS parser —
// doesn't need to be, since no string literal in this codebase's JSX
// contains a literal "//" or "/*" sequence that would trip this up.
function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// A real JSX <img element, with comments stripped first so a prose
// mention of "<img>" can't produce a false positive.
const RAW_IMG_RE = /<img\b/;

// next/image's `fill` is used as a bare boolean JSX prop — `fill` on its
// own line/token, never `fill=...`. This excludes the SVG `fill={...}`
// color attribute (e.g. the wishlist Heart icon) and prose like "fallback
// fill" that a naive `\bfill\b` match would also catch.
const FILL_PROP_RE = /(?<![\w-])fill(?![\w=-])/g;

// Confirms a `fill` match at `idx` is really a prop on an OPEN `<Image`
// element — the nearest preceding "<Image" with no self-closing "/>" in
// between (otherwise the nearest "<Image" could be a long-closed,
// unrelated element earlier in the file, e.g. a Recharts `fill="..."`
// color attribute appearing after some other, already-closed <Image />).
// Returns the element's start index, or -1 if `fill` isn't inside one.
function findEnclosingImageStart(content, idx) {
  const elementStart = content.lastIndexOf("<Image", idx);
  if (elementStart === -1) return -1;
  const closeBetween = content.indexOf("/>", elementStart);
  if (closeBetween !== -1 && closeBetween < idx) return -1;
  return elementStart;
}

// As of the Phase 9 checkpoint, there are ZERO raw <img> exceptions: the
// three former ones (branding-logo picker, user avatar, review-author
// avatar) turned out not to need a raw <img> at all — proxy.js's
// production CSP img-src ('self' https://res.cloudinary.com data: blob:)
// already blocks the browser from loading any OTHER host directly,
// whether the site used next/image or a raw <img>, so "arbitrary origin"
// was never a working case to begin with. lib/approvedImageSource.js now
// classifies each URL; an approved one renders via next/image exactly
// like every other image, and an unapproved one renders the existing
// initials/icon fallback (see describe block below) instead of a raw
// <img> that was always going to be invisible in production anyway.

describe("Phase 9 — every live normal image uses next/image (zero raw <img> exceptions remain)", () => {
  for (const file of jsxFiles) {
    const rel = path.relative(ROOT, file);
    test(`${rel}: contains no raw <img>`, () => {
      const content = stripComments(fs.readFileSync(file, "utf8"));
      assert.ok(!RAW_IMG_RE.test(content), `${rel} contains a raw <img>, but the Phase 9 checkpoint allowlist is empty`);
    });
  }
});

describe("Phase 9 checkpoint — arbitrary-origin avatar/logo sources are classified, not raw-<img> exceptions", () => {
  test("lib/approvedImageSource.js approves res.cloudinary.com, placehold.co, and same-origin paths — and nothing else", async () => {
    const { isApprovedImageSource } = await import(abs("lib/approvedImageSource.js"));
    assert.equal(isApprovedImageSource("https://res.cloudinary.com/demo/image/upload/x.jpg"), true);
    assert.equal(isApprovedImageSource("https://placehold.co/400x400"), true);
    assert.equal(isApprovedImageSource("/images/logo.webp"), true);
    assert.equal(isApprovedImageSource("https://evil.example/tracker.png"), false);
    assert.equal(isApprovedImageSource("http://res.cloudinary.com/demo/x.jpg"), false, "must require https, not just the right host");
    assert.equal(isApprovedImageSource(""), false);
    assert.equal(isApprovedImageSource(null), false);
    assert.equal(isApprovedImageSource("not a url"), false);
  });

  test("the classifier's approved hosts are a subset of both next.config.mjs's remotePatterns and — for res.cloudinary.com specifically — CSP img-src", () => {
    const classifierSrc = read("lib/approvedImageSource.js");
    const configSrc = read("next.config.mjs");
    const cspSrc = read("proxy.js");
    for (const host of ["res.cloudinary.com", "placehold.co"]) {
      assert.ok(classifierSrc.includes(host), `classifier must reference ${host}`);
      assert.ok(configSrc.includes(host), `next.config.mjs must declare ${host} as a remotePattern`);
    }
    assert.ok(cspSrc.includes("res.cloudinary.com"), "CSP img-src must allow res.cloudinary.com directly (the one host the classifier approves that a raw request could ever hit)");
  });

  for (const [rel, fieldDesc] of [
    ["views/admin/SettingsPage.jsx", "the branding-logo picker"],
    ["views/admin/UsersPage.jsx", "user.avatar"],
    ["components/review/ReviewList.jsx", "review.user.avatar"],
  ]) {
    test(`${rel}: ${fieldDesc} renders via next/image when approved, and never falls back to a raw <img>`, () => {
      const content = read(rel);
      assert.match(content, /from ["'].*lib\/approvedImageSource\.js["']/, `${rel} must import the shared classifier`);
      assert.match(content, /isApprovedImageSource\(/, `${rel} must gate its <Image> render on the classifier`);
      assert.ok(!RAW_IMG_RE.test(stripComments(content)), `${rel} must not contain a raw <img> fallback`);
    });
  }
});

describe("Phase 9 — no normal Cloudinary image is marked unoptimized", () => {
  test("no source file passes the `unoptimized` prop to next/image", () => {
    const offenders = jsxFiles.filter((f) => /\bunoptimized\b/.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), []);
  });
});

describe("Phase 9 — responsive/fill images declare sizes, and never an empty src", () => {
  test("every `fill` next/image usage has a `sizes` prop within the same JSX element", () => {
    const offenders = [];
    for (const file of jsxFiles) {
      const content = stripComments(fs.readFileSync(file, "utf8"));
      // Each occurrence of a bare boolean `fill` prop — find the
      // enclosing `<Image ... />` block by scanning forward/back from the
      // `fill` token to the nearest `<Image` and its matching `/>`.
      for (const m of content.matchAll(FILL_PROP_RE)) {
        const idx = m.index;
        const elementStart = findEnclosingImageStart(content, idx);
        if (elementStart === -1) continue; // not a next/image `fill` prop
        const elementEnd = content.indexOf("/>", idx);
        const element = content.slice(elementStart, elementEnd === -1 ? idx + 400 : elementEnd);
        if (!/\bsizes=/.test(element)) offenders.push(`${path.relative(ROOT, file)} (near offset ${idx})`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  test("no next/image (or raw <img>) src is a literal empty string", () => {
    const offenders = [];
    for (const file of jsxFiles) {
      const content = fs.readFileSync(file, "utf8");
      if (/src=""/.test(content) || /src=\{``\}/.test(content) || /src=\{""\}/.test(content)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    assert.deepEqual(offenders, []);
  });
});

describe("Phase 9 — fill images sit inside a positioned, stable-layout container", () => {
  test("every `fill` Image element's nearest ancestor container is `relative`, `absolute`, or `fixed` positioned", () => {
    // A pragmatic, non-brittle proxy for "has a positioned ancestor":
    // scan backwards from each `fill` usage for the nearest preceding
    // className containing relative/absolute/fixed within a bounded
    // window — generous enough to reach an outer container past a long
    // `cn(...)`-built className block, which this codebase's UI
    // components commonly have.
    const offenders = [];
    for (const file of jsxFiles) {
      const content = stripComments(fs.readFileSync(file, "utf8"));
      for (const m of content.matchAll(FILL_PROP_RE)) {
        const idx = m.index;
        const elementStart = findEnclosingImageStart(content, idx);
        if (elementStart === -1) continue; // not a next/image `fill` prop
        const window = content.slice(Math.max(0, idx - 1500), idx);
        if (!/\b(relative|absolute|fixed)\b/.test(window)) {
          offenders.push(`${path.relative(ROOT, file)} (near offset ${idx})`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });
});

describe("Phase 9 — image-origin configuration stays HTTPS-only and minimally scoped", () => {
  test("next.config.mjs's images.remotePatterns is HTTPS-only with no hostname wildcard", () => {
    const content = read("next.config.mjs");
    const block = content.match(/remotePatterns:\s*\[([\s\S]*?)\]/)[1];
    const entries = [...block.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
    assert.ok(entries.length >= 1, "expected at least one remotePattern entry");
    for (const entry of entries) {
      assert.match(entry, /protocol:\s*"https"/, "every remote image pattern must be HTTPS-only");
      assert.ok(!/hostname:\s*"\*"/.test(entry), "no hostname wildcard is allowed");
      assert.ok(!entry.includes("**"), "no path/hostname wildcard is allowed");
    }
  });

  test("dangerouslyAllowSVG remains absent (SVG optimization stays disabled)", () => {
    const content = read("next.config.mjs");
    assert.ok(!content.includes("dangerouslyAllowSVG"));
  });

  test("images.unsplash.com, where configured, is only ever referenced from scripts/seedCatalog.mjs — never hardcoded into live app request-handling code", () => {
    // Phase 9 originally kept this hostname OUT of remotePatterns entirely
    // (confirmed zero references anywhere). The Cosmetics seed products
    // (Lipstick/Foundation) now use real Unsplash stock photos instead of
    // placehold.co text placeholders, so the hostname is allowlisted again
    // — this test keeps the original scoping guarantee narrowed instead:
    // the only place that ever names this host is the seed script itself,
    // never a live app/views/components/lib/services/models code path.
    const content = read("next.config.mjs");
    const block = content.match(/remotePatterns:\s*\[([\s\S]*?)\]/)[1];
    const unsplashConfigured = block.includes("images.unsplash.com");

    const dirs = ["app", "views", "components", "lib", "services", "models"].map((d) => abs(d));
    const offenders = [];
    for (const dir of dirs) {
      for (const file of findFiles(dir, { extRe: /\.(js|jsx|mjs)$/ })) {
        if (fs.readFileSync(file, "utf8").includes("images.unsplash.com")) offenders.push(file);
      }
    }
    assert.deepEqual(offenders, [], "images.unsplash.com must never be hardcoded into live app code — seed data only");

    if (!unsplashConfigured) return; // fine either way — just never in live code
    const seedContent = read("scripts/seedCatalog.mjs");
    assert.ok(seedContent.includes("images.unsplash.com"), "if allowlisted, expected scripts/seedCatalog.mjs to be the one real user");
  });

  test("no general-purpose external-image proxy route was introduced", () => {
    const apiDir = abs("app/api");
    const offenders = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/route\.js$/.test(entry.name) && /image-proxy|img-proxy|proxy-image/i.test(entry.name)) offenders.push(full);
      }
    };
    walk(apiDir);
    assert.deepEqual(offenders, []);
  });
});

describe("Phase 9 — the six Phase 7 Server Component shells remain server-owned", () => {
  const SHELLS = [
    "views/HomePage.jsx",
    "views/ShopPage.jsx",
    "views/ProductDetailPage.jsx",
    "views/OrdersPage.jsx",
    "views/OrderDetailPage.jsx",
    "views/admin/OverviewPage.jsx",
  ];

  for (const rel of SHELLS) {
    test(`${rel} has no "use client" directive`, () => {
      const content = read(rel);
      assert.ok(!/^\s*["']use client["'];?\s*$/m.test(content), `${rel} must stay a Server Component`);
    });
  }
});

describe("Phase 9 — loading priority is scoped to genuine LCP images only", () => {
  // A literal, unconditional fetchPriority="high" is this codebase's
  // signal for "this is the one genuine LCP candidate for this render" —
  // ProductCard.jsx's own use is conditional
  // (`fetchPriority={index === 0 ? "high" : "auto"}`) and deliberately
  // doesn't match this literal-string count, since only rendering it for
  // a single card (index 0) is exactly the point being proved below.
  const UNCONDITIONAL_HIGH_RE = /fetchPriority="high"/g;

  test("home hero: the desktop/mobile/tablet breakpoint variants (3) are each fetchPriority high, but NONE is loading=\"eager\" — CSS-hidden variants must not be unconditionally downloaded", () => {
    // Next's own docs (the CSS-toggled light/dark-image guidance) are
    // explicit: "You cannot use ... loading='eager' because that would
    // cause both images to load. Instead, you can use
    // fetchPriority='high'." This file renders three breakpoint variants
    // of the same hero photo inside CSS-media-query-toggled sections
    // (never more than one visible at once) — each may carry
    // fetchPriority="high" (only the visible one ever actually fetches),
    // but a literal `loading="eager"` on any of them would force an
    // unconditional fetch regardless of visibility. Thumbnail selectors
    // and the decorative blur backdrop must stay non-priority.
    const content = stripComments(read("views/home/HeroCarousel.jsx"));
    const highMatches = [...content.matchAll(UNCONDITIONAL_HIGH_RE)];
    assert.equal(highMatches.length, 3, "expected exactly three fetchPriority=\"high\" images — one per breakpoint variant");
    assert.ok(!content.includes('loading="eager"'), "no image in the hero carousel may be loading=\"eager\" — that would force all breakpoint variants to download regardless of which is visible");
  });

  test("home page category tiles and hero thumbnail selectors are never fetchPriority high", () => {
    assert.ok(!stripComments(read("views/HomePage.jsx")).includes('fetchPriority="high"'));
  });

  test("product-detail main image may be fetchPriority high; its thumbnail strip must not be", () => {
    const content = stripComments(read("views/product/ProductDetailInteractive.jsx"));
    const matches = [...content.matchAll(UNCONDITIONAL_HIGH_RE)];
    assert.equal(matches.length, 1, "expected exactly one fetchPriority=\"high\" image (the main gallery image)");
    // The thumbnail <Image> (width={80} height={80}) must carry loading="lazy",
    // never a priority/eager hint.
    const thumbMatch = content.match(/<Image\s+src=\{resolveImage\(src, 160\)\}[\s\S]*?\/>/);
    assert.ok(thumbMatch, "expected to find the thumbnail <Image> element");
    assert.match(thumbMatch[0], /loading="lazy"/);
    assert.ok(!thumbMatch[0].includes("fetchPriority"));
  });

  test("product-card grid: at most one card can render fetchPriority high per render, and it is index-conditional, never unconditional", () => {
    const content = stripComments(read("components/product/ProductCard.jsx"));
    assert.equal([...content.matchAll(UNCONDITIONAL_HIGH_RE)].length, 0, "ProductCard must never hardcode fetchPriority=\"high\" unconditionally");
    assert.match(content, /fetchPriority=\{priority && index === 0 \? "high" : "auto"\}/);
  });

  test("only /shop's own grid opts ProductCard into priority — every other call site (home sections, related/recently-viewed rails, wishlist) omits it and stays plain lazy/auto regardless of local index", () => {
    const CALL_SITES = {
      "views/shop/ShopPageClient.jsx": true,
      "views/home/ProductTabsSection.jsx": false,
      "components/product/ProductRail.jsx": false,
      "views/WishlistPage.jsx": false,
    };
    for (const [rel, expectPriority] of Object.entries(CALL_SITES)) {
      const content = stripComments(read(rel));
      const calls = [...content.matchAll(/<ProductCard\b[^>]*\/?>/gs)];
      assert.ok(calls.length >= 1, `expected to find a <ProductCard> usage in ${rel}`);
      for (const call of calls) {
        const hasPriority = /\bpriority\b/.test(call[0]);
        assert.equal(hasPriority, expectPriority, `${rel}: <ProductCard priority> expectation mismatch`);
      }
    }
  });

  test("no other scanned file introduces an unconditional fetchPriority=\"high\" image (at most the two genuine per-route LCP candidates: home hero, product-detail main image)", () => {
    const offenders = [];
    for (const file of jsxFiles) {
      const rel = path.relative(ROOT, file);
      if (rel === "views/home/HeroCarousel.jsx" || rel === "views/product/ProductDetailInteractive.jsx") continue;
      const content = stripComments(fs.readFileSync(file, "utf8"));
      if (UNCONDITIONAL_HIGH_RE.test(content)) offenders.push(rel);
    }
    assert.deepEqual(offenders, []);
  });
});
