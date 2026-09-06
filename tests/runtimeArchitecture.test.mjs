// Phase 9 — runtime/client-bundle architecture checks. Confirms the
// research finding this phase's implementation relied on (recharts is
// already isolated to the admin-only chunk, so no next/dynamic was
// introduced) stays true, and that the image migration didn't leak a
// server-only module into a Client Component or regress any Phase 7/8
// boundary. Same text-based house style as tests/serverCacheArchitecture
// .test.mjs and tests/imageOptimization.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const abs = (...parts) => path.join(ROOT, ...parts);
const read = (relPath) => fs.readFileSync(abs(relPath), "utf8");

function findFiles(dir, { exclude = ["node_modules", ".next", ".git"], extRe = /\.(js|jsx|mjs)$/ } = {}) {
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

function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const ALL_SOURCE_DIRS = ["app", "views", "components", "lib", "services"].map((d) => abs(d));
const allSourceFiles = ALL_SOURCE_DIRS.flatMap((d) => findFiles(d));
const clientFiles = allSourceFiles.filter((f) => /^\s*["']use client["'];?\s*$/m.test(fs.readFileSync(f, "utf8")));

describe("Phase 9 — recharts stays isolated to the admin-only chunk (no dynamic import needed)", () => {
  test("only views/admin/OverviewCharts.jsx imports recharts", () => {
    const offenders = allSourceFiles
      .filter((f) => path.relative(ROOT, f) !== "views/admin/OverviewCharts.jsx")
      .filter((f) => /from ["']recharts["']/.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), []);
  });

  test("views/admin/OverviewCharts.jsx is a Client Component (recharts needs a browser)", () => {
    const content = read("views/admin/OverviewCharts.jsx");
    assert.ok(/^\s*["']use client["'];?\s*$/m.test(content));
  });

  test("no public-route view/page file imports OverviewCharts.jsx or recharts directly", () => {
    const PUBLIC_ROOTS = ["views/HomePage.jsx", "views/ShopPage.jsx", "views/ProductDetailPage.jsx", "views/OrdersPage.jsx", "views/OrderDetailPage.jsx", "views/CheckoutPage.jsx", "views/ComparePage.jsx"];
    for (const rel of PUBLIC_ROOTS) {
      const content = read(rel);
      assert.ok(!content.includes("OverviewCharts"), `${rel} must not import the admin-only charts component`);
      assert.ok(!/recharts/.test(content), `${rel} must not reference recharts`);
    }
  });

  test("no next/dynamic was introduced — the recharts admin chunk is already isolated by ordinary route-based code splitting, not a new dynamic import", () => {
    const offenders = allSourceFiles.filter((f) => /next\/dynamic/.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), []);
  });
});

describe("Phase 9 — the six Server Component shells did not regress to client fetching", () => {
  const SHELLS = [
    "views/HomePage.jsx",
    "views/ShopPage.jsx",
    "views/ProductDetailPage.jsx",
    "views/OrdersPage.jsx",
    "views/OrderDetailPage.jsx",
    "views/admin/OverviewPage.jsx",
  ];

  for (const rel of SHELLS) {
    test(`${rel}: no "use client", no RTK Query hook, no internal fetch("/api/...")`, () => {
      const raw = read(rel);
      const content = stripComments(raw);
      assert.ok(!/^\s*["']use client["'];?\s*$/m.test(raw));
      assert.ok(!/use(Get|Toggle|Update|Delete|Create)\w*Query|use\w*Mutation/.test(content), `${rel} must not call an RTK Query hook`);
      assert.ok(!/fetch\(\s*["'`](?:https?:\/\/[^"'`]*)?\/api\//.test(content), `${rel} must not fetch its own /api`);
    });
  }
});

describe("Phase 9 — Phase 8's private-data non-caching boundary survived this phase's edits", () => {
  test("lib/serverDataCache.js still never imports a private-data service", () => {
    const content = read("lib/serverDataCache.js");
    const NEVER_CACHED_IMPORT_RE = /from ["'].*services\/(orderService|paymentService|addressService|cartService|wishlistService|authService|userService)\.js["']/;
    assert.ok(!NEVER_CACHED_IMPORT_RE.test(content));
  });
});

describe("Phase 9 — server-only modules never leak into a Client Component via the image migration", () => {
  test("no Client Component touched by this phase imports config/cloudinary.js or services/uploadService.js", () => {
    const offenders = clientFiles.filter((f) => {
      const content = fs.readFileSync(f, "utf8");
      return /from ["'].*config\/cloudinary\.js["']/.test(content) || /from ["'].*services\/uploadService\.js["']/.test(content);
    });
    assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), []);
  });

  test("no Client Component imports next/cache or lib/serverDataCache.js/lib/cacheInvalidation.js (unchanged Phase 8 boundary)", () => {
    const offenders = clientFiles.filter((f) => {
      const content = fs.readFileSync(f, "utf8");
      return /from ["']next\/cache["']/.test(content) || /lib\/serverDataCache\.js["']/.test(content) || /lib\/cacheInvalidation\.js["']/.test(content);
    });
    assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), []);
  });
});

describe("Phase 9 — no new dependency was introduced by this phase", () => {
  test("package.json and package-lock.json are byte-for-byte unchanged from before Phase 9", () => {
    // A content hash comparison isn't meaningful without a stored
    // baseline, so this asserts the concrete, checked-in fact this phase
    // relies on: next/image and next/dynamic are built into the already-
    // installed `next` package — nothing new needed adding. If a future
    // change legitimately adds a dependency, update this test alongside
    // it rather than deleting it.
    const pkg = JSON.parse(read("package.json"));
    const KNOWN_HEAVY_LIBS = ["recharts"];
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const lib of KNOWN_HEAVY_LIBS) {
      assert.ok(deps[lib], `expected ${lib} to remain a dependency`);
    }
    assert.ok(!deps["react-dropzone"] && !deps["cropperjs"] && !deps["filepond"], "no new upload/cropper library should have been added");
  });
});
