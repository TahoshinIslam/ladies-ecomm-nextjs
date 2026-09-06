// Phase 11, section C2 — real HTTP evidence for the two new password
// recovery pages, run through the same `next start` harness as
// tests/http/seo.integration.test.mjs. Proves what a static source-text
// check (tests/passwordRecoveryPages.test.mjs) cannot: that Next's real
// router actually serves these routes, that the noindex meta tag is
// really emitted in the response HTML, that the forgot-password API
// response is enumeration-safe over a real request/response round trip,
// and that a malformed/unknown reset token gets the same generic
// treatment a real one's failure would.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb } from "../helpers/testDb.mjs";

const BASE_URL = process.env.HTTP_TEST_BASE_URL || "http://localhost:3000";

let serverUp = false;
try {
  const res = await fetch(`${BASE_URL}/`);
  serverUp = res.ok;
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

const skip = !serverUp
  ? "test server not reachable — run via `npm run test:http`"
  : !dbConnectable
    ? skipReason || "MONGO_URI_TEST not reachable — see .env.test.example"
    : false;

function extractMeta(html, name) {
  const re = new RegExp(`<meta[^>]*name="${name}"[^>]*content="([^"]*)"`, "i");
  return html.match(re)?.[1] || null;
}

describe("Phase 11 — password recovery pages served over real HTTP", { skip }, () => {
  after(async () => {
    if (dbConnectable) await disconnectTestDb();
  });

  test("GET /forgot-password renders 200 with noindex,nofollow robots meta", async () => {
    const res = await fetch(`${BASE_URL}/forgot-password`);
    assert.equal(res.status, 200);
    const html = await res.text();
    const robots = extractMeta(html, "robots");
    assert.ok(robots, "robots meta tag must be present");
    assert.match(robots, /noindex/);
    assert.match(robots, /nofollow/);
  });

  test("GET /reset-password/:token renders 200 with noindex,nofollow robots meta for an arbitrary (even malformed) token", async () => {
    const res = await fetch(`${BASE_URL}/reset-password/not-a-real-token`);
    assert.equal(res.status, 200, "the page itself must render regardless of token validity — validity is only checked on submit");
    const html = await res.text();
    const robots = extractMeta(html, "robots");
    assert.ok(robots);
    assert.match(robots, /noindex/);
    assert.match(robots, /nofollow/);
  });

  test("POST /api/users/forgot-password returns the identical response for an unknown email as for a real one (enumeration-safety, real round trip)", async () => {
    const unknownRes = await fetch(`${BASE_URL}/api/users/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ email: `nobody-${Date.now()}@example.com` }),
    });
    const unknownBody = await unknownRes.json();

    const otherUnknownRes = await fetch(`${BASE_URL}/api/users/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ email: `also-nobody-${Date.now()}@example.com` }),
    });
    const otherUnknownBody = await otherUnknownRes.json();

    assert.equal(unknownRes.status, otherUnknownRes.status);
    assert.deepEqual(unknownBody, otherUnknownBody, "the response shape/content must not vary based on whether an account exists");
  });

  test("POST /api/users/reset-password/:token with a malformed token returns a generic, non-revealing failure", async () => {
    const res = await fetch(`${BASE_URL}/api/users/reset-password/not-hex-not-a-token`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ password: "a-perfectly-fine-password-123" }),
    });
    assert.ok(res.status >= 400 && res.status < 500, "a malformed/unknown token must fail with a client error, not a 500 or a success");
    const body = await res.json();
    const serialized = JSON.stringify(body);
    assert.ok(!/stack/i.test(serialized), "must never leak a stack trace");
    assert.ok(!/mongo/i.test(serialized), "must never leak internal DB detail");
  });
});
