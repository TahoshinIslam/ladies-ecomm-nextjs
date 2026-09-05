// Phase 10 — static error/loading-boundary architecture checks. Same
// house style as tests/imageOptimization.test.mjs: proves concrete,
// executable invariants via source-text inspection, comments stripped
// first so a prose mention can't false-positive.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const abs = (...parts) => path.join(ROOT, ...parts);
const read = (relPath) => fs.readFileSync(abs(relPath), "utf8");
const exists = (relPath) => fs.existsSync(abs(relPath));

function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("Phase 10 — required error/not-found boundary files exist", () => {
  for (const rel of ["app/error.jsx", "app/global-error.jsx", "app/not-found.jsx", "app/admin/error.jsx"]) {
    test(`${rel} exists`, () => {
      assert.ok(exists(rel), `${rel} must exist`);
    });
  }
});

describe("Phase 10 — error.jsx / global-error.jsx / admin/error.jsx use the installed Next 16.3.4 contract", () => {
  for (const rel of ["app/error.jsx", "app/global-error.jsx", "app/admin/error.jsx"]) {
    test(`${rel} is a Client Component with the { error, retry } contract`, () => {
      const content = read(rel);
      assert.ok(/^\s*["']use client["'];?\s*$/m.test(content), `${rel} must be a Client Component (Next requires this for error boundaries)`);
      assert.match(content, /\{\s*error,\s*retry\s*\}/, `${rel} must destructure { error, retry } — this Next version's real contract (confirmed against node_modules/next/dist/docs), not the older { error, reset } shape alone`);
      assert.match(content, /retry\(\)/, `${rel} must actually call retry()`);
    });

    test(`${rel} never renders error.message or error.stack`, () => {
      const content = stripComments(read(rel));
      assert.ok(!/\{error\.message\}/.test(content) && !/\{error\?\.message\}/.test(content), `${rel} must never render error.message`);
      assert.ok(!/\{error\.stack\}/.test(content) && !/\{error\?\.stack\}/.test(content), `${rel} must never render error.stack`);
    });

    test(`${rel} follows the checkpoint's digest-display policy: error.digest is logged to the console for engineering correlation but never rendered in the page itself (no documented "quote this reference" support workflow exists)`, () => {
      const content = stripComments(read(rel));
      const jsxReturnStart = content.indexOf("return (");
      const jsxOnward = jsxReturnStart === -1 ? content : content.slice(jsxReturnStart);
      assert.ok(!/\{error\.digest\}|\{error\?\.digest\}/.test(jsxOnward), `${rel} must not render error.digest in the JSX it returns`);
      assert.match(content, /console\.error\(.*error\?\.digest/, `${rel} must still log the digest to the console for correlation`);
    });
  }

  test("global-error.jsx defines its own <html> and <body> (required when it replaces the root layout)", () => {
    const content = read("app/global-error.jsx");
    assert.match(content, /<html\b/);
    assert.match(content, /<body\b/);
  });
});

describe("Phase 10 — not-found.jsx is safe and branded", () => {
  test("app/not-found.jsx renders exactly one <h1> and links to Home and Shop", () => {
    const content = read("app/not-found.jsx");
    const h1Matches = [...content.matchAll(/<h1\b/g)];
    assert.equal(h1Matches.length, 1, "not-found.jsx must contain exactly one <h1>");
    assert.match(content, /href="\/"/, "must offer a Home link");
    assert.match(content, /href="\/shop"/, "must offer a Shop link");
  });

  test("app/not-found.jsx never names a specific private resource (order/product) — it must stay generic since it also backs concealed-resource 404s", () => {
    const content = stripComments(read("app/not-found.jsx"));
    // Word-boundary match: className strings like "border-line" contain
    // "order" as a substring but are obviously not the word "order".
    assert.ok(!/\border\b/i.test(content), "not-found.jsx text must not mention orders specifically");
  });
});

describe("Phase 10 — no test-only error-triggering backdoor was added", () => {
  test("no route/API file exposes a debug/test error trigger", () => {
    const dirs = ["app"].map((d) => abs(d));
    const offenders = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/route\.js$/.test(entry.name)) {
          const content = fs.readFileSync(full, "utf8");
          if (/throw new Error\(["'`]?test/i.test(content) || /\bdebugThrow\b|\btestError\b/i.test(content)) {
            offenders.push(full);
          }
        }
      }
    };
    walk(dirs[0]);
    assert.deepEqual(offenders, []);
  });
});

describe("Phase 10 — loading boundaries never sit above a known auth/authorization or notFound() gate", () => {
  // Historical, documented finding (see app/(routes)/orders/[id]/page.jsx
  // and app/admin/layout.jsx's own comments): a <Suspense>/loading.jsx
  // boundary above a notFound()/redirect() call lets the fallback shell
  // flush first (status 200), then swap in the real not-found/redirect
  // UI client-side — leaving the WRONG 200 status on the actual HTTP
  // response. This suite proves that constraint still holds after Phase
  // 10's changes.
  test("no loading.jsx exists for the orders/[id] or admin route segments", () => {
    assert.ok(!exists("app/(routes)/orders/[id]/loading.jsx"));
    assert.ok(!exists("app/admin/loading.jsx"));
  });

  test("app/(routes)/orders/[id]/page.jsx still renders its page directly, with no <Suspense> wrapping it", () => {
    const content = stripComments(read("app/(routes)/orders/[id]/page.jsx"));
    assert.ok(!/<Suspense/.test(content), "orders/[id]/page.jsx must not introduce a Suspense boundary above its notFound()-calling body");
  });

  test("app/admin/layout.jsx's staff-role gate still calls redirect() directly in a Server Component layout, not behind a client-rendered loading shell", () => {
    const content = read("app/admin/layout.jsx");
    assert.ok(!/^\s*["']use client["'];?\s*$/m.test(content), "app/admin/layout.jsx must remain a Server Component");
    assert.match(content, /redirect\(/, "the staff-role gate must still call redirect()");
  });

  test("views/OrderDetailPage.jsx and views/ProductDetailPage.jsx still call notFound() directly (not deferred inside a client-only branch)", () => {
    for (const rel of ["views/OrderDetailPage.jsx", "views/ProductDetailPage.jsx"]) {
      const content = read(rel);
      assert.match(content, /notFound\(\)/, `${rel} must still call notFound()`);
      assert.ok(!/^\s*["']use client["'];?\s*$/m.test(content), `${rel} must remain a Server Component`);
    }
  });
});
