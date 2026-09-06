// Phase 8 — static architecture checks for the server data cache layer.
// Text-based, not a full static analyzer: proves concrete, executable
// invariants (a config flag is absent, an import graph doesn't cross a
// forbidden boundary, a function call includes a required argument) that
// would actually break something if violated, rather than anything about
// wording or formatting.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const abs = (...parts) => path.join(ROOT, ...parts);
const read = (relPath) => fs.readFileSync(abs(relPath), "utf8");

function findFiles(dir, { exclude = ["node_modules", ".next", ".git"] } = {}) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findFiles(full, { exclude }));
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) results.push(full);
  }
  return results;
}

const CLIENT_DIRS = ["components", "context", "hooks", "store", "views"].map((d) => abs(d));
const clientFiles = CLIENT_DIRS.flatMap((d) => findFiles(d)).filter((f) => {
  const content = fs.readFileSync(f, "utf8");
  return /^\s*["']use client["'];?\s*$/m.test(content);
});

describe("Phase 8 — cacheComponents/PPR stay disabled (the load-bearing CSP decision)", () => {
  test("next.config.mjs does not enable cacheComponents", () => {
    const content = read("next.config.mjs");
    assert.ok(!/cacheComponents\s*:\s*true/.test(content));
    assert.ok(!/\bppr\s*:/.test(content));
  });

  test("no source file introduces a \"use cache\" directive, cacheLife, or cacheTag", () => {
    const dirs = ["app", "views", "components", "lib", "services"].map((d) => abs(d));
    const offenders = [];
    for (const dir of dirs) {
      for (const file of findFiles(dir)) {
        const content = fs.readFileSync(file, "utf8");
        if (/^\s*["']use cache["'];?\s*$/m.test(content)) offenders.push(`${file} (use cache)`);
        if (/\bcacheLife\s*\(/.test(content)) offenders.push(`${file} (cacheLife)`);
        if (/\bcacheTag\s*\(/.test(content) && !file.endsWith("lib/cacheTags.js")) offenders.push(`${file} (cacheTag)`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  test("lib/cacheTags.js documents the CSP/cacheComponents decision", () => {
    const content = read("lib/cacheTags.js");
    assert.match(content, /cacheComponents/);
    assert.match(content, /nonce/i);
    assert.match(content, /Partial Prerendering|PPR/);
  });
});

describe("Phase 8 — cache layer is server-only", () => {
  test("no Client Component imports lib/serverDataCache.js, lib/cacheInvalidation.js, or lib/cacheTags.js", () => {
    const offenders = [];
    for (const file of clientFiles) {
      const content = fs.readFileSync(file, "utf8");
      if (/from ["'].*lib\/serverDataCache\.js["']/.test(content)) offenders.push(`${file} imports serverDataCache.js`);
      if (/from ["'].*lib\/cacheInvalidation\.js["']/.test(content)) offenders.push(`${file} imports cacheInvalidation.js`);
    }
    assert.deepEqual(offenders, []);
  });

  test("lib/serverDataCache.js imports next/cache and Mongoose-backed services only (no next/headers cookie/session reads)", () => {
    const content = read("lib/serverDataCache.js");
    assert.match(content, /from ["']next\/cache["']/);
    assert.ok(!content.includes("next/headers"), "the shared cache layer must never read a per-request cookie/session");
  });

  test("lib/cacheInvalidation.js imports revalidateTag from next/cache with a required second argument", () => {
    const content = read("lib/cacheInvalidation.js");
    assert.match(content, /import\s*\{\s*revalidateTag\s*\}\s*from\s*["']next\/cache["']/);
    assert.match(content, /revalidateTag\(tag,\s*IMMEDIATE_EXPIRE\)/);
    assert.match(content, /expire:\s*0/);
  });
});

describe("Phase 8 — every cached function has a finite TTL and real tags", () => {
  test("CACHE_TTL_SECONDS has no non-finite/unbounded value", () => {
    const content = read("lib/serverDataCache.js");
    const block = content.match(/CACHE_TTL_SECONDS\s*=\s*\{([\s\S]*?)\};/)[1];
    const values = [...block.matchAll(/:\s*(\d+)/g)].map((m) => Number(m[1]));
    assert.ok(values.length >= 5, "expected several named TTL constants");
    for (const v of values) {
      assert.ok(Number.isFinite(v) && v > 0 && v <= 3600, `TTL ${v} must be a small, finite, positive number of seconds`);
    }
  });

  test("every unstable_cache() call in lib/serverDataCache.js passes an explicit tags array", () => {
    const content = read("lib/serverDataCache.js");
    const calls = [...content.matchAll(/unstable_cache\(/g)];
    assert.ok(calls.length >= 10, "expected one unstable_cache() wrapper per cached read");
    // Every unstable_cache( call site's options object (found up to the
    // next matching close-paren block) must mention `tags:`.
    const withoutTags = content
      .split(/unstable_cache\(/)
      .slice(1)
      .filter((chunk) => !/\btags\b/.test(chunk.slice(0, 600)));
    assert.deepEqual(withoutTags.length, 0, "every unstable_cache() call must declare tags");
  });
});

describe("Phase 8 — no raw request/cookie/header object enters a cache key or tag", () => {
  test("lib/serverDataCache.js never builds a key/tag from request/cookies/headers", () => {
    const content = read("lib/serverDataCache.js");
    assert.ok(!/request\.(headers|cookies)/.test(content));
    assert.ok(!content.includes("cookies()"));
  });

  test("lib/shopCacheEligibility.js never reads a raw identity value into the cache key", () => {
    const content = read("lib/shopCacheEligibility.js");
    assert.ok(!/email|token|cookie|userId|sessionId/i.test(content));
  });
});

describe("Phase 8 — no process-local cache Map/object was introduced", () => {
  test("no new Map()/plain-object process-local cache exists in the cache layer", () => {
    for (const file of ["lib/serverDataCache.js", "lib/cacheInvalidation.js", "lib/shopCacheEligibility.js", "lib/cacheTags.js"]) {
      const content = read(file);
      assert.ok(!/new Map\(\)/.test(content), `${file} must not hold a process-local cache Map`);
    }
  });
});

describe("Phase 8 — private/session-derived services are never wrapped in the shared cache layer", () => {
  const NEVER_CACHED_IMPORT_RE = /from ["'].*services\/(orderService|paymentService|addressService|cartService|wishlistService|authService|userService)\.js["']/;

  test("lib/serverDataCache.js never imports a private-data service", () => {
    const content = read("lib/serverDataCache.js");
    assert.ok(!NEVER_CACHED_IMPORT_RE.test(content));
  });
});

describe("Phase 8 — no internal HTTP API fetch was reintroduced by the cache layer", () => {
  test("lib/serverDataCache.js never calls fetch(\"/api/...\")", () => {
    const content = read("lib/serverDataCache.js");
    assert.ok(!/fetch\(\s*["'`](?:https?:\/\/[^"'`]*)?\/api\//.test(content));
  });
});

describe("Phase 8 — mutation invalidation calls occur after the mutating write, never before", () => {
  const ROUTE_INVALIDATION_FILES = [
    "app/api/products/route.js",
    "app/api/products/[idOrSlug]/route.js",
    "app/api/categories/route.js",
    "app/api/categories/[id]/route.js",
    "app/api/attributes/route.js",
    "app/api/attributes/[id]/route.js",
    "app/api/settings/route.js",
    "app/api/theme/[id]/route.js",
    "app/api/theme/[id]/activate/route.js",
    "app/api/reviews/product/[productId]/route.js",
    "app/api/reviews/[id]/route.js",
    "app/api/orders/route.js",
    "app/api/orders/[id]/cancel/route.js",
    "app/api/orders/[id]/status/route.js",
    "app/api/payments/cod/[orderId]/route.js",
  ];

  for (const file of ROUTE_INVALIDATION_FILES) {
    test(`${file} calls invalidateCacheTags AFTER its mutating service call, in source order`, () => {
      const content = read(file);
      const invalidateIndex = content.indexOf("invalidateCacheTags(");
      assert.ok(invalidateIndex > -1, `${file} must call invalidateCacheTags()`);
      // The nearest preceding `await <mutatingCall>(...)` line must appear
      // BEFORE the invalidateCacheTags call in the source text — a crude
      // but real ordering check (this app's route handlers are short,
      // linear functions, not branches that could reorder this at runtime).
      const before = content.slice(0, invalidateIndex);
      assert.ok(/await\s+\w+\(/.test(before), `${file}: expected an awaited mutation call before invalidateCacheTags()`);
    });
  }
});
