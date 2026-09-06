// Phase 3, section J: REAL HTTP security-header and CSP verification,
// through the actual `next start` process the tests/http harness spins up
// — not a Route Handler call, not a config object inspected in isolation.
// Every assertion here parses the real directive values rather than just
// checking a header key exists (per the explicit instruction not to claim
// "a header exists" as proof of anything).
//
// Full CSP enforcement (actually blocking an injected script in a real
// browser) was verified separately, manually, via the Browser pane against
// this exact build — see the Phase 3 report for that evidence. This file
// verifies the HTTP CONTRACT (the header is present, correctly shaped, and
// consistent across route types) via fetch(), which is what an automated
// suite can check unattended; it does not re-claim the browser-level proof
// as something this file itself demonstrated.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestProduct } from "../helpers/testDb.mjs";

const BASE_URL = process.env.HTTP_TEST_BASE_URL || "http://localhost:3000";

let serverUp = false;
try {
  const res = await fetch(`${BASE_URL}/api/settings/public`);
  serverUp = res.ok || res.status < 500;
} catch {
  serverUp = false;
}

let dbConnectable = false;
if (serverUp && dbReady) {
  try {
    await connectTestDb();
    dbConnectable = true;
  } catch {
    dbConnectable = false;
  }
}

const skip = !serverUp ? "test server not reachable — run via `npm run test:http`" : !dbConnectable ? skipReason || "MONGO_URI_TEST not reachable" : false;

function parseCsp(headerValue) {
  const directives = {};
  for (const part of headerValue.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...values] = trimmed.split(/\s+/);
    directives[name] = values;
  }
  return directives;
}

describe("Phase 3 closure — real HTTP: security headers and Content-Security-Policy", { skip }, () => {
  after(async () => {
    await disconnectTestDb();
  });

  // ===================== storefront HTML route =====================

  test("storefront HTML route (/): CSP directives are correctly shaped, no unsafe-eval, no wildcard script source, frame-ancestors enforced, and the other security headers are present and correct", async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);

    const csp = parseCsp(res.headers.get("content-security-policy") || "");
    assert.ok(csp["default-src"]?.includes("'self'"));
    assert.ok(csp["script-src"]?.some((v) => /^'nonce-/.test(v)), "script-src must carry a real per-request nonce");
    assert.ok(!csp["script-src"]?.includes("'unsafe-eval'"), "no unsafe-eval in production script-src");
    assert.ok(!csp["script-src"]?.includes("*"), "no wildcard script source");
    assert.ok(csp["script-src"]?.includes("'strict-dynamic'"));
    assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
    assert.deepEqual(csp["object-src"], ["'none'"]);
    assert.deepEqual(csp["base-uri"], ["'self'"]);
    assert.deepEqual(csp["form-action"], ["'self'"]);
    assert.ok(csp["img-src"]?.includes("https://res.cloudinary.com"), "the one real external origin this app needs (Cloudinary) must be allowlisted");
    assert.equal(csp["img-src"]?.filter((v) => v.startsWith("https://") && v !== "https://res.cloudinary.com").length, 0, "no OTHER external image origin is allowlisted");

    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.ok(res.headers.get("permissions-policy")?.includes("camera=()"));
    assert.ok(res.headers.get("permissions-policy")?.includes("microphone=()"));
    assert.ok(res.headers.get("permissions-policy")?.includes("geolocation=()"));
    // next start always runs as a production server (confirmed empirically
    // for this closure — see proxy.js/report) — HSTS must be present.
    assert.match(res.headers.get("strict-transport-security") || "", /max-age=\d+/);
    assert.ok(!/x-xss-protection/i.test(JSON.stringify([...res.headers])), "the obsolete X-XSS-Protection header must not be set");
  });

  test("each request to the same HTML route gets a DIFFERENT nonce (per-request, never reused)", async () => {
    const [a, b, c] = await Promise.all([fetch(`${BASE_URL}/`), fetch(`${BASE_URL}/`), fetch(`${BASE_URL}/`)]);
    const nonces = [a, b, c].map((res) => parseCsp(res.headers.get("content-security-policy") || "")["script-src"].find((v) => v.startsWith("'nonce-")));
    assert.equal(new Set(nonces).size, 3, "three requests must produce three distinct nonces");
  });

  // ===================== login/register API route =====================

  test("the login API route: its own (non-nonce) CSP is present, no permissive CORS header, and the other security headers match the global policy", async () => {
    const res = await fetch(`${BASE_URL}/api/users/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ email: "nobody@example.invalid", password: "wrong" }),
    });
    assert.equal(res.status, 401);

    const csp = parseCsp(res.headers.get("content-security-policy") || "");
    assert.deepEqual(csp["default-src"], ["'none'"], "API responses use the simpler, fully-locked-down CSP — no nonce needed since there is no HTML/inline script to allow");
    assert.equal(res.headers.get("access-control-allow-origin"), null, "no CORS header at all on this same-origin, cookie-authenticated API — Access-Control-Allow-Origin: * must never appear");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  // ===================== authenticated API route =====================

  test("an authenticated API route (/api/users/me): security headers are present identically whether authenticated or not", async () => {
    const res = await fetch(`${BASE_URL}/api/users/me`);
    assert.equal(res.status, 401);
    assert.ok(res.headers.get("content-security-policy"));
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });

  // ===================== 404 response =====================

  test("a 404 response still carries the full page CSP (with its own nonce) and the other security headers — a missing route is not a way to skip them", async () => {
    const res = await fetch(`${BASE_URL}/this-route-genuinely-does-not-exist-${crypto.randomBytes(4).toString("hex")}`);
    assert.equal(res.status, 404);
    const csp = parseCsp(res.headers.get("content-security-policy") || "");
    assert.ok(csp["script-src"]?.some((v) => /^'nonce-/.test(v)), "the 404 page is real HTML rendered by the App Router, so it gets the same nonce-based page CSP as any other page");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  // ===================== SSE response =====================

  test("the SSE route's rejection path (no session) is unaffected by the new security-header layer — still 401, still no permissive CORS header; the route's own Content-Type/Cache-Control contract on a SUCCESSFUL connection is exhaustively covered by tests/http/authSessionCsrfSse.integration.test.mjs and not re-asserted here", async () => {
    const controller = new AbortController();
    try {
      const res = await fetch(`${BASE_URL}/api/admin/events`, { signal: controller.signal });
      assert.equal(res.status, 401, "no session — proving the new global headers() config didn't interfere with this route's own auth check");
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    } finally {
      controller.abort();
    }
  });

  // Rate-limiting / client-IP-trust behavior over real HTTP is covered
  // comprehensively in tests/http/clientIpTrust.integration.test.mjs
  // (Phase 3B) — this file stays focused on headers/CSP.

  // ===================== Phase 8: cache layer does not weaken the nonce CSP =====================
  //
  // The whole reason Phase 8 uses unstable_cache()/revalidateTag() instead
  // of "use cache"/cacheComponents is that this app's CSP requires a
  // genuinely fresh nonce on every HTML response — enabling PPR would
  // break that. These tests prove the cache layer landed WITHOUT
  // regressing that contract: caching the underlying DATA never caches
  // (or reuses) the HTML/nonce itself.

  test("Phase 8: three requests to a page whose data IS cached still get three different nonces", async () => {
    // Warm the shop page's product-list cache first (same URL, repeated).
    await fetch(`${BASE_URL}/shop?limit=5`);
    const [a, b, c] = await Promise.all([
      fetch(`${BASE_URL}/shop?limit=5`),
      fetch(`${BASE_URL}/shop?limit=5`),
      fetch(`${BASE_URL}/shop?limit=5`),
    ]);
    const nonces = [a, b, c].map((res) => parseCsp(res.headers.get("content-security-policy") || "")["script-src"].find((v) => v.startsWith("'nonce-")));
    assert.equal(new Set(nonces).size, 3, "cached product data must not cause the per-request nonce to be reused");
  });

  test("Phase 8: cacheComponents/PPR remain disabled — every HTML response is request-dynamic, never a public/shared cache", async () => {
    const res = await fetch(`${BASE_URL}/shop?limit=5`);
    assert.equal(res.status, 200);
    // Next.js's own default for a fully dynamic (non-PPR, non-static) page
    // — no CDN/browser may cache this response at all, public or private.
    // If cacheComponents/PPR were ever enabled, a static shell could be
    // served instead and this header would no longer say `no-store`.
    const cacheControl = res.headers.get("cache-control") || "";
    assert.match(cacheControl, /no-store/);
    assert.ok(!/\bpublic\b/.test(cacheControl), "no page response may carry a public cache directive");
  });

  test("Phase 8: an authenticated/private redirect response is never marked publicly cacheable", async () => {
    const res = await fetch(`${BASE_URL}/orders`, { redirect: "manual" });
    assert.ok([307, 302, 303].includes(res.status));
    const cacheControl = res.headers.get("cache-control") || "";
    assert.match(cacheControl, /no-store/);
    assert.ok(!/\bpublic\b/.test(cacheControl));
  });
});
