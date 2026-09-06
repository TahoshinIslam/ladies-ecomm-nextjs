// Phase 3B closure: REAL HTTP proof of the client-IP trust fix for
// register/reset-password — the two routes whose ONLY rate-limit
// dimension is IP, and which Phase 3's first pass left completely
// unprotected whenever no trusted IP was available (see lib/clientIp.js's
// header comment for the full history).
//
// This harness's real server (scripts/httpTestServer.mjs) runs WITH
// TRUST_PROXY_HEADERS=true / TRUSTED_PROXY_HOP_COUNT=1 — matching a real
// deployment that HAS completed the required proxy-trust configuration —
// so this file can prove correct IP selection, per-IP isolation, and
// spoofing resistance against an ACTUAL running server, not a direct
// function call. The complementary "no trust configured in production ->
// 503" path is proven directly in tests/rateLimit.test.mjs (forcing
// NODE_ENV=production in-process is the exact same code path a real
// unconfigured deployment hits; spinning up a SECOND real server here
// just to re-prove that specific branch would add real cost for no
// additional evidence beyond what the direct test already gives).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { dbReady, skipReason, connectTestDb, disconnectTestDb } from "../helpers/testDb.mjs";

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

describe("Phase 3B closure — real HTTP: client-IP trust for register/reset-password", { skip }, () => {
  let User, RateLimitCounter;

  before(async () => {
    ({ default: User } = await import("../../models/userModel.js"));
    ({ default: RateLimitCounter } = await import("../../models/rateLimitModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  function registerReq({ email, xff }) {
    const headers = { "content-type": "application/json", origin: BASE_URL };
    if (xff !== undefined) headers["x-forwarded-for"] = xff;
    return fetch(`${BASE_URL}/api/users/register`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "HTTP Trust Test", email, password: "HttpTrustTest123!" }),
    });
  }

  const freshEmail = () => `httptrust-${crypto.randomBytes(5).toString("hex")}@example.invalid`;

  test("register: a genuinely invalid IP shape in the trusted position is rejected as untrusted, and since register has no other dimension, this harness's production-mode server fails closed (503) — real, wired-through-the-real-stack proof of the Phase 3B fix, not a direct handler call", async () => {
    const email = freshEmail();
    const res = await registerReq({ email, xff: "not-an-ip-address-at-all" });
    assert.equal(res.status, 503, "an unresolvable/invalid trusted IP must fail closed on this route, never silently proceed unprotected");
    const json = await res.json();
    assert.equal(json.success, false);
    assert.doesNotMatch(json.message, /proxy|forwarded|hop|mongo|internal/i, "no internal proxy-configuration detail leaks to the client");

    // Confirm the fail-closed response genuinely prevented account
    // creation — not just an unrelated coincidental error.
    const created = await User.findOne({ email });
    assert.equal(created, null);
  });

  test("register: two different real client IPs get independent rate-limit buckets", async () => {
    const ipA = `203.0.113.${Math.floor(Math.random() * 50) + 1}`;
    const ipB = `203.0.113.${Math.floor(Math.random() * 50) + 100}`;

    const resA = await registerReq({ email: freshEmail(), xff: ipA });
    assert.equal(resA.status, 201, "the first request from IP A must succeed");
    const resB = await registerReq({ email: freshEmail(), xff: ipB });
    assert.equal(resB.status, 201, "a completely different IP must not share IP A's bucket");
  });

  test("register: a client-prepended fake entry in X-Forwarded-For cannot change which IP is selected — two requests differing only in their prepended junk still land in the SAME bucket as each other, proving only the trusted (rightmost, hop-count=1) position is ever read", async () => {
    const realIp = `203.0.113.${Math.floor(Math.random() * 50) + 150}`;
    const first = await registerReq({ email: freshEmail(), xff: `attacker-injected-1, ${realIp}` });
    assert.equal(first.status, 201);

    // A second request with COMPLETELY DIFFERENT prepended junk, but the
    // SAME real trailing IP — if the prepended value had any influence at
    // all, this would land in a different bucket than the first request
    // and both would trivially succeed; instead, confirm both really did
    // land in the SAME counter document (proving the prepended part is
    // fully ignored), by checking the underlying stored count directly.
    const second = await registerReq({ email: freshEmail(), xff: `totally-different-attacker-value-xyz, ${realIp}` });
    assert.equal(second.status, 201);

    const keyHash = crypto.createHash("sha256").update(realIp).digest("hex");
    const doc = await RateLimitCounter.findOne({ keyHash, action: "register:ip" });
    assert.ok(doc, "a counter document keyed by the REAL (trusted-position) IP alone must exist");
    assert.equal(doc.count, 2, "both requests incremented the SAME bucket — the prepended junk had zero effect on identity");
  });

  test("register: exceeding the configured IP limit returns a real 429 with a valid Retry-After header, over the actual network stack", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 50) + 200}`;
    let lastRes;
    // REGISTER_IP_LIMIT defaults to 5/hour (lib/rateLimitConfig.js).
    for (let i = 0; i < 6; i++) {
      lastRes = await registerReq({ email: freshEmail(), xff: ip });
    }
    assert.equal(lastRes.status, 429);
    const retryAfter = Number(lastRes.headers.get("retry-after"));
    assert.ok(Number.isInteger(retryAfter) && retryAfter > 0);
  });

  test("reset-password: an invalid IP shape fails closed (503) over real HTTP, and a valid trusted IP is genuinely rate-limited to a real 429", async () => {
    const invalidRes = await fetch(`${BASE_URL}/api/users/reset-password/bad-token-http-trust-test`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL, "x-forwarded-for": "definitely-not-an-ip" },
      body: JSON.stringify({ password: "WhateverPassword123!" }),
    });
    assert.equal(invalidRes.status, 503);

    const ip = `203.0.113.${Math.floor(Math.random() * 5) + 250}`;
    let lastRes;
    // RESET_PASSWORD_IP_LIMIT defaults to 10/15min.
    for (let i = 0; i < 11; i++) {
      lastRes = await fetch(`${BASE_URL}/api/users/reset-password/bad-token-${i}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE_URL, "x-forwarded-for": ip },
        body: JSON.stringify({ password: "WhateverPassword123!" }),
      });
    }
    assert.equal(lastRes.status, 429, "the 11th attempt from the same real IP must be rate-limited");
  });
});
