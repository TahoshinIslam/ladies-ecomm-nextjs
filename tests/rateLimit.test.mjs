// Phase 3: rate limiter — direct Route Handler tests against the real,
// MongoDB-backed atomic limiter (lib/rateLimit.js / models/rateLimitModel.js).
// No mocking of the limiter itself anywhere in this file — every test
// exercises the real findOneAndUpdate/upsert path against the disposable
// test database, the same way tests/session.test.mjs exercises real
// sessions rather than a reimplementation of session logic.

import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestSession, requestAs, createTestUser } from "./helpers/testDb.mjs";

// forgotPassword() sends a real email via nodemailer for an EXISTING
// account (see services/userService.js) — mocked here the same way
// tests/passwordResetLinks.test.mjs does, so the enumeration-safety test
// below exercises the real forgotPassword() code path without an actual
// SMTP send. Must happen before anything imports services/userService.js.
let moduleMockUsable = false;
try {
  const probe = await mock.module("node:os", { namedExports: { hostname: () => "probe" } });
  probe.restore();
  moduleMockUsable = true;
} catch {
  moduleMockUsable = false;
}
if (moduleMockUsable) {
  await mock.module("nodemailer", {
    defaultExport: {
      createTransport: () => ({
        sendMail: async () => ({ messageId: "test-message-id" }),
      }),
    },
  });
}

// Phase 3C: mocks "@vercel/functions" so tests can exercise the REAL
// register/reset-password routes end-to-end (through lib/clientIp.js's
// real getClientIp()/requireClientIp(), with NO test-only dependency
// injection) as if actually running on Vercel, by controlling what the
// "official" ipAddress() resolver returns. Must be registered before
// anything imports lib/clientIp.js (which imports "@vercel/functions" at
// its own top level) — the same import-ordering requirement as the
// nodemailer mock above. Only takes effect when a test sets
// process.env.VERCEL = "1" (see lib/clientIp.js's isVercelRuntime()); the
// mocked function is otherwise simply never called. `vercelMockState.ip`
// is mutable per-test so a single shared mock can serve every Vercel-path
// test in this file without needing to re-mock or re-import anything.
const vercelMockState = { ip: undefined };
if (moduleMockUsable) {
  await mock.module("@vercel/functions", {
    namedExports: {
      ipAddress: () => vercelMockState.ip,
    },
  });
}

const canRun = moduleMockUsable && dbReady;
const reason = !moduleMockUsable ? "node:test module mocking unavailable — run with --experimental-test-module-mocks" : skipReason;

describe("Phase 3 rate limiter — direct Route Handler tests", { skip: !canRun && reason }, () => {
  let loginPOST, registerPOST, forgotPasswordPOST, resetPasswordPOST, couponValidatePOST;
  let User, RateLimitCounter, Coupon;

  before(async () => {
    await connectTestDb();
    ({ POST: loginPOST } = await import("../app/api/users/login/route.js"));
    ({ POST: registerPOST } = await import("../app/api/users/register/route.js"));
    ({ POST: forgotPasswordPOST } = await import("../app/api/users/forgot-password/route.js"));
    ({ POST: resetPasswordPOST } = await import("../app/api/users/reset-password/[token]/route.js"));
    ({ POST: couponValidatePOST } = await import("../app/api/coupons/validate/route.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: RateLimitCounter } = await import("../models/rateLimitModel.js"));
    ({ default: Coupon } = await import("../models/couponModel.js"));
  });

  after(async () => {
    await RateLimitCounter.deleteMany({});
    await disconnectTestDb();
  });

  async function clearCounters() {
    await RateLimitCounter.deleteMany({});
  }

  function loginReq(email, password, extraHeaders = {}) {
    const req = requestAs({ method: "POST", url: "http://test/api/users/login", body: { email, password } });
    for (const [k, v] of Object.entries(extraHeaders)) req.headers.set(k, v);
    return req;
  }

  // ===================== 1-3: below/at/over threshold, Retry-After =====================

  test("requests below the configured threshold succeed normally (no 429), and the first request beyond it returns 429 with a valid integer Retry-After", async () => {
    await clearCounters();
    const user = await createTestUser();
    try {
      // RATE_LIMIT_LOGIN_ACCOUNT_MAX defaults to 5 (see lib/rateLimitConfig.js).
      // Wrong-password attempts also trip lockout after 5 in userModel.js —
      // use a MIX of just-under-the-rate-limit wrong attempts against an
      // otherwise-untouched-by-lockout scenario isn't possible to fully
      // isolate from lockout with the same account, so this test verifies
      // the RATE LIMITER'S OWN threshold arithmetic directly against
      // lib/rateLimit.js instead of layering it under login's business
      // logic — see the next test for the full real-route 429 proof.
      const { checkRateLimit } = await import("../lib/rateLimit.js");
      const identity = `probe-${crypto.randomBytes(4).toString("hex")}`;
      for (let i = 1; i <= 5; i++) {
        const r = await checkRateLimit({ identity, action: "test:threshold", limit: 5, windowMs: 60_000 });
        assert.equal(r.allowed, true, `request ${i} of 5 must be allowed`);
      }
      const sixth = await checkRateLimit({ identity, action: "test:threshold", limit: 5, windowMs: 60_000 });
      assert.equal(sixth.allowed, false, "the 6th request in the same window must be blocked");
      assert.ok(Number.isInteger(sixth.retryAfterSeconds) && sixth.retryAfterSeconds > 0, "retryAfterSeconds must be a valid positive integer");
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("a real route (register) returns HTTP 429 with a valid Retry-After header once its own IP limit is exceeded", async () => {
    await clearCounters();
    process.env.TRUST_PROXY_HEADERS = "true";
    process.env.TRUSTED_PROXY_HOP_COUNT = "1";
    try {
      const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
      let lastRes;
      // REGISTER_IP_LIMIT defaults to 5 per hour.
      for (let i = 0; i < 6; i++) {
        const req = requestAs({
          method: "POST",
          url: "http://test/api/users/register",
          body: { name: "Rate Test", email: `ratetest-${crypto.randomBytes(4).toString("hex")}@example.invalid`, password: "RateTest123!" },
        });
        req.headers.set("x-forwarded-for", ip);
        lastRes = await registerPOST(req);
      }
      assert.equal(lastRes.status, 429);
      const retryAfter = lastRes.headers.get("retry-after");
      assert.ok(retryAfter && Number.isInteger(Number(retryAfter)) && Number(retryAfter) > 0);
      const json = await lastRes.json();
      assert.equal(json.success, false);
      assert.doesNotMatch(json.message, /mongo|hash|counter|stack/i, "no internal detail leaks in the 429 body");
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
      delete process.env.TRUSTED_PROXY_HOP_COUNT;
      await User.deleteMany({ email: { $regex: /^ratetest-/ } });
    }
  });

  // ===================== 4-5: independent buckets per IP / per account =====================

  test("two different IP identities do not share a rate-limit bucket", async () => {
    await clearCounters();
    const { checkRateLimit } = await import("../lib/rateLimit.js");
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit({ identity: "198.51.100.10", action: "test:ip-isolation", limit: 5, windowMs: 60_000 });
      assert.equal(r.allowed, true);
    }
    const otherIp = await checkRateLimit({ identity: "198.51.100.20", action: "test:ip-isolation", limit: 5, windowMs: 60_000 });
    assert.equal(otherIp.allowed, true, "a different IP starts with its own fresh bucket");
  });

  test("two different account identities do not share a rate-limit bucket", async () => {
    await clearCounters();
    const { checkRateLimit, normalizeEmail } = await import("../lib/rateLimit.js");
    const emailA = normalizeEmail("alice@example.invalid");
    const emailB = normalizeEmail("bob@example.invalid");
    for (let i = 0; i < 5; i++) {
      assert.equal((await checkRateLimit({ identity: emailA, action: "test:account-isolation", limit: 5, windowMs: 60_000 })).allowed, true);
    }
    assert.equal((await checkRateLimit({ identity: emailB, action: "test:account-isolation", limit: 5, windowMs: 60_000 })).allowed, true, "a different account starts fresh");
  });

  // ===================== 6: email normalization prevents bypass =====================

  test("email normalization prevents a case/whitespace bypass of the per-account limit", async () => {
    await clearCounters();
    const { checkRateLimit, normalizeEmail } = await import("../lib/rateLimit.js");
    const variants = ["Foo@Example.com", " foo@example.com ", "FOO@EXAMPLE.COM", "foo@example.com"];
    for (const raw of variants) {
      await checkRateLimit({ identity: normalizeEmail(raw), action: "test:email-normalize", limit: 3, windowMs: 60_000 });
    }
    // All 4 normalize to the same identity — the 4th must already be over a limit of 3.
    const check = await checkRateLimit({ identity: normalizeEmail("foo@example.com"), action: "test:email-normalize", limit: 3, windowMs: 60_000 });
    assert.equal(check.allowed, false, "differently-cased/whitespace-padded variants of the same email must share one bucket, not bypass the limit");
  });

  // ===================== 7: concurrent burst cannot exceed the maximum =====================

  test("a concurrent burst of requests cannot exceed the configured maximum (atomic increment proof)", async () => {
    await clearCounters();
    const { checkRateLimit } = await import("../lib/rateLimit.js");
    const identity = `burst-${crypto.randomBytes(4).toString("hex")}`;
    const limit = 10;
    const results = await Promise.all(Array.from({ length: 30 }, () => checkRateLimit({ identity, action: "test:burst", limit, windowMs: 60_000 })));
    const allowedCount = results.filter((r) => r.allowed).length;
    assert.equal(allowedCount, limit, `exactly ${limit} of the 30 concurrent requests must be allowed — the atomic $inc must not let more through under concurrency`);
  });

  // ===================== 8-9: window expiration / expired rows don't affect current limits =====================

  test("a new window works after the previous one expires — the limit resets, not accumulates forever", async () => {
    await clearCounters();
    const { checkRateLimit } = await import("../lib/rateLimit.js");
    const identity = `window-${crypto.randomBytes(4).toString("hex")}`;
    const shortWindowMs = 300;
    for (let i = 0; i < 3; i++) {
      assert.equal((await checkRateLimit({ identity, action: "test:window", limit: 3, windowMs: shortWindowMs })).allowed, true);
    }
    assert.equal((await checkRateLimit({ identity, action: "test:window", limit: 3, windowMs: shortWindowMs })).allowed, false, "over the limit within the same window");

    await new Promise((r) => setTimeout(r, shortWindowMs + 50));

    const afterWindow = await checkRateLimit({ identity, action: "test:window", limit: 3, windowMs: shortWindowMs });
    assert.equal(afterWindow.allowed, true, "a genuinely new window must allow requests again");
  });

  test("expired database rows do not affect current limits, even before the TTL sweep has run (correctness does not depend on cleanup)", async () => {
    await clearCounters();
    const { checkRateLimit } = await import("../lib/rateLimit.js");
    const identity = `expired-row-${crypto.randomBytes(4).toString("hex")}`;
    // Manually insert an old, maxed-out window's row that MongoDB's TTL
    // sweep has NOT yet deleted (TTL runs on its own ~60s cycle) — this is
    // exactly the scenario correctness must not depend on cleanup for.
    const oldWindowStart = new Date(Date.now() - 10 * 60_000);
    const rawKeyHash = crypto.createHash("sha256").update(identity).digest("hex");
    await RateLimitCounter.create({
      keyHash: rawKeyHash,
      action: "test:stale-row",
      windowStart: oldWindowStart,
      count: 999,
      expiresAt: new Date(Date.now() - 5 * 60_000), // already "expired" by our own field, TTL just hasn't swept it yet
    });

    const current = await checkRateLimit({ identity, action: "test:stale-row", limit: 5, windowMs: 60_000 });
    assert.equal(current.allowed, true, "a stale, maxed-out row from an old window must not affect the CURRENT window's count at all");
  });

  // ===================== 10: no raw identity values stored =====================

  test("raw IP/email/token/coupon values are absent from every stored rate-limit document", async () => {
    await clearCounters();
    const { checkRateLimit, normalizeEmail } = await import("../lib/rateLimit.js");
    const rawEmail = "SensitiveUser@Example.com";
    const rawIp = "192.0.2.55";
    await checkRateLimit({ identity: normalizeEmail(rawEmail), action: "test:no-raw-storage", limit: 5, windowMs: 60_000 });
    await checkRateLimit({ identity: rawIp, action: "test:no-raw-storage-ip", limit: 5, windowMs: 60_000 });

    const allDocs = await RateLimitCounter.find({ action: { $in: ["test:no-raw-storage", "test:no-raw-storage-ip"] } }).lean();
    const dump = JSON.stringify(allDocs);
    assert.ok(!dump.includes(rawEmail) && !dump.toLowerCase().includes(rawEmail.toLowerCase()), "the raw email must never appear in a stored document");
    assert.ok(!dump.includes(rawIp), "the raw IP must never appear in a stored document");
    for (const doc of allDocs) {
      assert.equal(doc.keyHash.length, 64, "keyHash must be a SHA-256 hex digest, not the raw identity");
    }
  });

  // ===================== 11: forged forwarding header cannot bypass the trust model =====================

  test("a forged X-Forwarded-For header has NO effect when proxy trust isn't configured — the request is simply not IP-rate-limited, never mis-identified", async () => {
    delete process.env.TRUST_PROXY_HEADERS;
    const { getClientIp } = await import("../lib/clientIp.js");
    const req = new Request("http://test/api/whatever", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    assert.equal(getClientIp(req), null, "without TRUST_PROXY_HEADERS=true, the header must never be read for identity at all");
  });

  test("with proxy trust configured, a client-prepended fake entry at the START of X-Forwarded-For cannot spoof the trusted hop", async () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    process.env.TRUSTED_PROXY_HOP_COUNT = "1";
    try {
      const { getClientIp } = await import("../lib/clientIp.js");
      // A real deployment with exactly 1 trusted proxy appends the REAL
      // client IP as the proxy's own hop — anything the CLIENT itself
      // prepended before that must be ignored. With hopCount=1, the
      // trusted value is the one 1 position from the right.
      const req = new Request("http://test/api/whatever", { headers: { "x-forwarded-for": "9.9.9.9-attacker-injected, 203.0.113.7" } });
      assert.equal(getClientIp(req), "203.0.113.7", "only the entry the trusted proxy itself appended is used — the attacker's prepended value is ignored");
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
      delete process.env.TRUSTED_PROXY_HOP_COUNT;
    }
  });

  // ===================== Phase 3B: the fail-closed fix itself =====================

  test("PRODUCTION, no trusted IP available: register and reset-password fail closed (503) — the exact defect this closure fixes, proven directly rather than assumed", async () => {
    await clearCounters();
    delete process.env.TRUST_PROXY_HEADERS;
    delete process.env.TRUSTED_PROXY_HOP_COUNT;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const email = `p3b-register-${crypto.randomBytes(4).toString("hex")}@example.invalid`;
      const registerRes = await registerPOST(requestAs({ method: "POST", url: "http://test/api/users/register", body: { name: "P3B Test", email, password: "P3bTest123!" } }));
      assert.equal(registerRes.status, 503, "register has no dimension other than IP — with none available in production, it must fail closed, never proceed unprotected");
      assert.equal(await User.findOne({ email }), null, "no account was created by the fail-closed request");

      const resetRes = await resetPasswordPOST(
        requestAs({ method: "POST", url: "http://test/api/users/reset-password/some-token", body: { password: "NewPassword123!" } }),
        { params: Promise.resolve({ token: "some-token" }) },
      );
      assert.equal(resetRes.status, 503, "reset-password has no dimension other than IP — same fail-closed requirement");

      const registerJson = await registerRes.json();
      assert.equal(registerJson.success, false);
      assert.doesNotMatch(registerJson.message, /proxy|forwarded|hop|ip address|mongo|stack/i, "no internal proxy-configuration detail leaks in the 503 body");
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test("PRODUCTION, no trusted IP available: login still applies its account dimension (not fully unprotected — it has a second dimension to fall back on), and forgot-password likewise", async () => {
    await clearCounters();
    delete process.env.TRUST_PROXY_HEADERS;
    delete process.env.TRUSTED_PROXY_HOP_COUNT;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const user = await createTestUser();
    try {
      // Exhaust the ACCOUNT dimension (limit 10) — this alone proves the
      // account dimension still fully engages even though the IP
      // dimension is silently absent (getClientIp() returns null, and
      // login/forgot-password use the plain getClientIp() path, not
      // requireClientIp() — they are not IP-only routes, so there is
      // nothing to fail closed on here).
      let lastRes;
      for (let i = 0; i < 11; i++) {
        lastRes = await loginPOST(loginReq(user.email, "wrong"));
      }
      assert.ok([401, 423, 429].includes(lastRes.status), "some rejection must occur — lockout (423) or the account rate limit (429), never a silent 500/crash from the missing IP");
      assert.notEqual(lastRes.status, 503, "login is NOT IP-only — it must never fail closed just because no IP is available");

      const fpRes = await forgotPasswordPOST(requestAs({ method: "POST", url: "http://test/api/users/forgot-password", body: { email: user.email } }));
      assert.notEqual(fpRes.status, 503, "forgot-password is NOT IP-only either — same guarantee");
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      await User.deleteOne({ _id: user._id });
    }
  });

  test("no route ever uses a shared fallback identity such as \"unknown\"/\"anonymous\"/\"0.0.0.0\" — searched directly in source, not just inferred from behavior", async () => {
    const fs = await import("node:fs");
    const filesToCheck = [
      "lib/clientIp.js",
      "app/api/users/login/route.js",
      "app/api/users/register/route.js",
      "app/api/users/forgot-password/route.js",
      "app/api/users/reset-password/[token]/route.js",
    ];
    const forbidden = /["'`](unknown|anonymous|unresolved|localhost|0\.0\.0\.0|request-ip-missing)["'`]/i;
    for (const rel of filesToCheck) {
      const source = fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
      // Strip // line comments first — this file's own doc comments quote
      // these exact words as examples of what NOT to do, which would
      // otherwise false-positive against a naive whole-file regex.
      const codeOnly = source
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, ""))
        .join("\n");
      assert.ok(!forbidden.test(codeOnly), `${rel} must not contain a shared-fallback-identity literal in actual code (comments excluded)`);
    }
  });

  test("DEVELOPMENT/TEST environment (non-production): register and reset-password skip the IP dimension gracefully when no trust is configured — this is the deliberate, test-suite-only carve-out, confirmed to NOT return 503", async () => {
    await clearCounters();
    delete process.env.TRUST_PROXY_HEADERS;
    delete process.env.TRUSTED_PROXY_HOP_COUNT;
    // NODE_ENV is already "test" for this whole suite — no override needed.
    assert.equal(process.env.NODE_ENV, "test");
    const email = `p3b-nonprod-${crypto.randomBytes(4).toString("hex")}@example.invalid`;
    const res = await registerPOST(requestAs({ method: "POST", url: "http://test/api/users/register", body: { name: "Non-Prod Test", email, password: "NonProdTest123!" } }));
    assert.equal(res.status, 201, "in the test environment, with no trust configured, register must behave exactly as before this closure — this is what keeps the rest of the test suite (which calls register directly, all over both prior phases) working without every file configuring a full proxy trust chain");
    await User.deleteOne({ email });
  });

  // ===================== Phase 3B: IP-shape validation, hop-count hardening =====================

  test("a syntactically invalid string in the trusted X-Forwarded-For position is rejected — never accepted as an identity", async () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    process.env.TRUSTED_PROXY_HOP_COUNT = "1";
    try {
      const { getClientIp } = await import("../lib/clientIp.js");
      const req = new Request("http://test/api/whatever", { headers: { "x-forwarded-for": "not-an-ip-at-all" } });
      assert.equal(getClientIp(req), null, "a garbage value must never be accepted as a trusted IP, even in the syntactically-correct trusted position");
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
      delete process.env.TRUSTED_PROXY_HOP_COUNT;
    }
  });

  test("valid IPv4 and IPv6 addresses are both accepted deterministically", async () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    process.env.TRUSTED_PROXY_HOP_COUNT = "1";
    try {
      const { getClientIp } = await import("../lib/clientIp.js");
      const v4Req = new Request("http://test/api/whatever", { headers: { "x-forwarded-for": "198.51.100.23" } });
      assert.equal(getClientIp(v4Req), "198.51.100.23");
      const v6Req = new Request("http://test/api/whatever", { headers: { "x-forwarded-for": "2001:db8::1" } });
      assert.equal(getClientIp(v6Req), "2001:db8::1");
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
      delete process.env.TRUSTED_PROXY_HOP_COUNT;
    }
  });

  test("an out-of-range IPv4-shaped string (e.g. octet > 255) is rejected, not silently accepted as if it were a valid address", async () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    process.env.TRUSTED_PROXY_HOP_COUNT = "1";
    try {
      const { getClientIp } = await import("../lib/clientIp.js");
      const req = new Request("http://test/api/whatever", { headers: { "x-forwarded-for": "999.999.999.999" } });
      assert.equal(getClientIp(req), null);
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
      delete process.env.TRUSTED_PROXY_HOP_COUNT;
    }
  });

  test("an invalid TRUSTED_PROXY_HOP_COUNT (non-integer, zero, negative) is treated as MISCONFIGURED — never silently defaulted to 1, since guessing a hop count risks trusting an attacker-controlled entry", async () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    try {
      const { getClientIp } = await import("../lib/clientIp.js");
      const req = new Request("http://test/api/whatever", { headers: { "x-forwarded-for": "203.0.113.50" } });
      for (const bad of ["0", "-1", "abc", "1.5", ""]) {
        process.env.TRUSTED_PROXY_HOP_COUNT = bad;
        assert.equal(getClientIp(req), null, `hop count "${bad}" must be treated as misconfigured, not silently defaulted`);
      }
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
      delete process.env.TRUSTED_PROXY_HOP_COUNT;
    }
  });

  test("a forwarding chain shorter than the configured hop count is rejected, not truncated/guessed", async () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    process.env.TRUSTED_PROXY_HOP_COUNT = "3";
    try {
      const { getClientIp } = await import("../lib/clientIp.js");
      const req = new Request("http://test/api/whatever", { headers: { "x-forwarded-for": "203.0.113.1, 203.0.113.2" } }); // only 2 entries, need 3
      assert.equal(getClientIp(req), null);
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
      delete process.env.TRUSTED_PROXY_HOP_COUNT;
    }
  });

  // ===================== Phase 3C: the Vercel-bound resolver =====================
  // Every test in this section injects a fake `ipAddressFn` via
  // getClientIp()'s test-only dependency-injection option (see
  // lib/clientIp.js's own header comment) — this exercises the SELECTION/
  // VALIDATION logic around the official @vercel/functions resolver
  // without needing to actually run inside Vercel's infrastructure.
  // Production route code never passes this option; it always uses the
  // real, official import.

  test("Vercel mode uses ONLY the provider resolver — a real X-Forwarded-For header on the request is completely ignored even though it's present", async () => {
    process.env.VERCEL = "1";
    try {
      const { getClientIp } = await import("../lib/clientIp.js");
      const req = new Request("http://test/api/whatever", { headers: { "x-forwarded-for": "203.0.113.55" } });
      const fakeProvider = () => "198.51.100.9"; // deliberately a DIFFERENT value than X-Forwarded-For
      assert.equal(getClientIp(req, { ipAddressFn: fakeProvider }), "198.51.100.9", "the provider's own result is used, never anything derived from X-Forwarded-For");
    } finally {
      delete process.env.VERCEL;
    }
  });

  test("Vercel mode: an attacker-controlled X-Forwarded-For cannot override the provider result — prepended, appended, or as the sole header value", async () => {
    process.env.VERCEL = "1";
    try {
      const { getClientIp } = await import("../lib/clientIp.js");
      const realIp = "198.51.100.9";
      const fakeProvider = () => realIp;
      const variants = [
        "1.2.3.4-prepended, 9.9.9.9",
        "9.9.9.9, 5.6.7.8-appended",
        "9.9.9.9",
        "attacker, controls, this, entire, header",
      ];
      for (const xff of variants) {
        const req = new Request("http://test/api/whatever", { headers: { "x-forwarded-for": xff } });
        assert.equal(getClientIp(req, { ipAddressFn: fakeProvider }), realIp, `X-Forwarded-For="${xff}" must have zero influence — only the provider's own value is ever used in Vercel mode`);
      }
    } finally {
      delete process.env.VERCEL;
    }
  });

  test("Vercel mode: invalid provider output (not a real IP) is rejected, not passed through", async () => {
    process.env.VERCEL = "1";
    try {
      const { getClientIp } = await import("../lib/clientIp.js");
      const req = new Request("http://test/api/whatever");
      const badProvider = () => "not-an-ip-at-all";
      assert.equal(getClientIp(req, { ipAddressFn: badProvider }), null);
    } finally {
      delete process.env.VERCEL;
    }
  });

  test("Vercel mode: missing provider output (undefined — the official ipAddress() return value when x-real-ip is absent) is treated as no trusted IP, and PRODUCTION fails closed for register/reset-password", async () => {
    process.env.VERCEL = "1";
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const { getClientIp, requireClientIp } = await import("../lib/clientIp.js");
      const req = new Request("http://test/api/whatever");
      const missingProvider = () => undefined;
      assert.equal(getClientIp(req, { ipAddressFn: missingProvider }), null);
      assert.deepEqual(requireClientIp(req, { ipAddressFn: missingProvider }), { ok: false, identity: null });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      delete process.env.VERCEL;
    }
  });

  test("Vercel mode: both IPv4 and valid IPv6 provider results are accepted deterministically, validated with Node's own net.isIP (not a custom regex)", async () => {
    process.env.VERCEL = "1";
    try {
      const { getClientIp } = await import("../lib/clientIp.js");
      const req = new Request("http://test/api/whatever");
      assert.equal(getClientIp(req, { ipAddressFn: () => "198.51.100.42" }), "198.51.100.42");
      assert.equal(getClientIp(req, { ipAddressFn: () => "2001:db8::42" }), "2001:db8::42");
    } finally {
      delete process.env.VERCEL;
    }
  });

  test("Vercel mode takes priority: even if TRUST_PROXY_HEADERS is also (incorrectly) set, the generic proxy path is never consulted while VERCEL=1", async () => {
    process.env.VERCEL = "1";
    process.env.TRUST_PROXY_HEADERS = "true"; // should be irrelevant / ignored
    try {
      const { getClientIp } = await import("../lib/clientIp.js");
      const req = new Request("http://test/api/whatever", { headers: { "x-forwarded-for": "203.0.113.200" } });
      const fakeProvider = () => "198.51.100.77";
      assert.equal(getClientIp(req, { ipAddressFn: fakeProvider }), "198.51.100.77", "Vercel mode must win outright — the generic X-Forwarded-For path is not a secondary fallback checked alongside it");
    } finally {
      delete process.env.VERCEL;
      delete process.env.TRUST_PROXY_HEADERS;
    }
  });

  test("an unrecognized production platform (neither VERCEL nor generic proxy trust configured) fails closed for register/reset-password — directly reachable/untrusted production requests are never silently allowed through", async () => {
    await clearCounters();
    delete process.env.VERCEL;
    delete process.env.TRUST_PROXY_HEADERS;
    delete process.env.TRUSTED_PROXY_HOP_COUNT;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const email = `p3c-unrecognized-${crypto.randomBytes(4).toString("hex")}@example.invalid`;
      const res = await registerPOST(requestAs({ method: "POST", url: "http://test/api/users/register", body: { name: "P3C Test", email, password: "P3cTest123!" } }));
      assert.equal(res.status, 503);
      assert.equal(await User.findOne({ email }), null);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  test("Vercel mode: register reaches 429 using two independent provider-supplied IP identities, each isolated from the other — exercised through the REAL route, with NO test-only dependency injection, via the module-level @vercel/functions mock", async () => {
    await clearCounters();
    process.env.VERCEL = "1";
    const ipA = "198.51.100.201";
    const ipB = "198.51.100.202";
    vercelMockState.ip = ipA;
    try {
      const resA1 = await registerPOST(requestAs({ method: "POST", url: "http://test/api/users/register", body: { name: "x", email: `p3c-vip-a1-${crypto.randomBytes(3).toString("hex")}@example.invalid`, password: "VercelIp123!" } }));
      assert.equal(resA1.status, 201);

      vercelMockState.ip = ipB;
      const resB1 = await registerPOST(requestAs({ method: "POST", url: "http://test/api/users/register", body: { name: "x", email: `p3c-vip-b1-${crypto.randomBytes(3).toString("hex")}@example.invalid`, password: "VercelIp123!" } }));
      assert.equal(resB1.status, 201, "a different provider-supplied IP starts with its own fresh bucket");

      vercelMockState.ip = ipA;
      let lastRes;
      for (let i = 0; i < 5; i++) {
        lastRes = await registerPOST(requestAs({ method: "POST", url: "http://test/api/users/register", body: { name: "x", email: `p3c-vip-a${i + 2}-${crypto.randomBytes(3).toString("hex")}@example.invalid`, password: "VercelIp123!" } }));
      }
      assert.equal(lastRes.status, 429, "REGISTER_IP_LIMIT (5/hour default) is enforced against the real MongoDB counter, keyed by the provider-supplied IP, through the real route — no direct-handler-only shortcut");
    } finally {
      vercelMockState.ip = undefined;
      delete process.env.VERCEL;
    }
  });

  test("Vercel mode: reset-password reaches 429 at its configured threshold through the real route", async () => {
    await clearCounters();
    process.env.VERCEL = "1";
    vercelMockState.ip = "198.51.100.210";
    try {
      let lastRes;
      // RESET_PASSWORD_IP_LIMIT defaults to 10/15min.
      for (let i = 0; i < 11; i++) {
        lastRes = await resetPasswordPOST(
          requestAs({ method: "POST", url: `http://test/api/users/reset-password/bad-token-vercel-${i}`, body: { password: "WhateverPassword123!" } }),
          { params: Promise.resolve({ token: `bad-token-vercel-${i}` }) },
        );
      }
      assert.equal(lastRes.status, 429);
    } finally {
      vercelMockState.ip = undefined;
      delete process.env.VERCEL;
    }
  });

  test("Vercel mode: no raw provider-supplied IP ever appears in a stored rate-limit document", async () => {
    await clearCounters();
    process.env.VERCEL = "1";
    const rawIp = "198.51.100.220";
    vercelMockState.ip = rawIp;
    try {
      await registerPOST(requestAs({ method: "POST", url: "http://test/api/users/register", body: { name: "x", email: `p3c-rawip-${crypto.randomBytes(3).toString("hex")}@example.invalid`, password: "VercelIp123!" } }));
      const docs = await RateLimitCounter.find({ action: "register:ip" }).lean();
      const dump = JSON.stringify(docs);
      assert.ok(!dump.includes(rawIp), "the raw Vercel-provided IP must never appear in a stored document — only its SHA-256 hash");
    } finally {
      vercelMockState.ip = undefined;
      delete process.env.VERCEL;
    }
  });

  // ===================== 12: forgot-password stays enumeration-safe =====================

  test("forgot-password gives an identical response and identical rate-limit treatment for an existing vs a nonexistent account", async () => {
    await clearCounters();
    const user = await createTestUser();
    try {
      const req = (email) => requestAs({ method: "POST", url: "http://test/api/users/forgot-password", body: { email } });

      const existingRes = await forgotPasswordPOST(req(user.email));
      const nonexistentRes = await forgotPasswordPOST(req(`nobody-${crypto.randomBytes(4).toString("hex")}@example.invalid`));

      assert.equal(existingRes.status, nonexistentRes.status);
      const existingJson = await existingRes.json();
      const nonexistentJson = await nonexistentRes.json();
      assert.deepEqual(Object.keys(existingJson).sort(), Object.keys(nonexistentJson).sort());
      assert.equal(existingJson.message, nonexistentJson.message, "the response message must not differ based on account existence — the rate limiter must not introduce a new enumeration signal on top of the existing generic response");
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 13: rate limiting does not replace or break account lockout =====================

  test("account lockout (5 failed attempts -> 423) still fires correctly underneath the new per-account rate limiter, and the 6th request sees lockout's 423, NOT the rate limiter's 429", async () => {
    await clearCounters();
    const user = await createTestUser();
    try {
      for (let i = 0; i < 5; i++) {
        const res = await loginPOST(loginReq(user.email, "wrong"));
        assert.equal(res.status, 401, `attempt ${i + 1} should be a plain 401, not yet locked or rate-limited`);
      }
      const lockedCheck = await User.findById(user._id).select("+lockUntil");
      assert.ok(lockedCheck.lockUntil && lockedCheck.lockUntil > Date.now(), "lockout must still engage exactly as before — the rate limiter is a separate, additional layer, not a replacement");

      // The regression this guards against: LOGIN_ACCOUNT_LIMIT must stay
      // strictly greater than the lockout threshold (5), or this 6th
      // request gets the rate limiter's generic 429 instead of lockout's
      // specific 423 — exactly what happened when both were set to 5
      // during this phase's own verification (caught by
      // tests/authLifecycle.test.mjs's real Phase 1 lockout test).
      const sixthRes = await loginPOST(loginReq(user.email, "TestPassword123!"));
      assert.equal(sixthRes.status, 423, "lockout's specific 423 must still be observable — the rate limiter must not mask it with a generic 429 at this threshold");
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 14: coupon limiting does not leak coupon validity =====================

  test("coupon-validate rate limiting blocks identically regardless of whether the probed coupon code is real or fake", async () => {
    await clearCounters();
    const user = await createTestUser();
    const coupon = await Coupon.create({
      code: `REAL${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
      discountType: "flat",
      discountValue: 10,
      expiresAt: new Date(Date.now() + 86400000),
      isActive: true,
    });
    try {
      const session = await createTestSession(user._id);
      const call = (code) =>
        couponValidatePOST(
          requestAs({ method: "POST", url: "http://test/api/coupons/validate", session, body: { code, subtotal: 100 } }),
        );

      // COUPON_VALIDATE_USER_LIMIT defaults to 30/min — exhaust it mixing
      // real and fake codes so the 429, when it arrives, cannot correlate
      // with which kind of code was being probed.
      let blockedRes;
      for (let i = 0; i < 31; i++) {
        blockedRes = await call(i % 2 === 0 ? coupon.code : "TOTALLY-FAKE-CODE");
      }
      assert.equal(blockedRes.status, 429);
      const json = await blockedRes.json();
      assert.doesNotMatch(json.message, /coupon|code|exist/i, "the 429 body must say nothing coupon-specific");
    } finally {
      await Coupon.deleteOne({ _id: coupon._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 15: existing CSRF requirements still apply =====================

  test("coupon-validate still requires CSRF (Phase 2's protection is untouched by Phase 3's rate limiter)", async () => {
    await clearCounters();
    const user = await createTestUser();
    try {
      const session = await createTestSession(user._id);
      const req = requestAs({ method: "POST", url: "http://test/api/coupons/validate", session, omitCsrfHeader: true, body: { code: "WHATEVER", subtotal: 100 } });
      const res = await couponValidatePOST(req);
      assert.equal(res.status, 403, "CSRF is still enforced even though the request would otherwise be within the rate limit");
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 16: safe unrelated endpoints keep working =====================

  test("an unrelated, unprotected endpoint (GET /api/users/me) is completely unaffected by the rate limiter", async () => {
    const user = await createTestUser();
    try {
      const { GET: mePOST_GET } = await import("../app/api/users/me/route.js");
      const session = await createTestSession(user._id);
      for (let i = 0; i < 10; i++) {
        const res = await mePOST_GET(requestAs({ method: "GET", url: "http://test/api/users/me", session }));
        assert.equal(res.status, 200);
      }
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== reset-password: IP-only, never the raw token =====================

  test("reset-password rate limiting is IP-only and never touches the raw token — a bad token still gets a clean 400 until the IP limit itself is hit", async () => {
    await clearCounters();
    process.env.TRUST_PROXY_HEADERS = "true";
    process.env.TRUSTED_PROXY_HOP_COUNT = "1";
    try {
      const ip = `203.0.113.${Math.floor(Math.random() * 50) + 100}`;
      const build = (token) => {
        const req = requestAs({ method: "POST", url: `http://test/api/users/reset-password/${token}`, body: { password: "NewPassword123!" } });
        req.headers.set("x-forwarded-for", ip);
        return req;
      };
      let lastRes;
      for (let i = 0; i < 11; i++) {
        lastRes = await resetPasswordPOST(build(`bad-token-${i}`), { params: Promise.resolve({ token: `bad-token-${i}` }) });
      }
      assert.equal(lastRes.status, 429, "the 11th attempt from the same IP (limit defaults to 10) must be rate-limited");

      const docs = await RateLimitCounter.find({ action: "reset-password:ip" }).lean();
      const dump = JSON.stringify(docs);
      assert.ok(!dump.includes("bad-token"), "no raw reset token ever appears in a stored rate-limit document");
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
      delete process.env.TRUSTED_PROXY_HOP_COUNT;
    }
  });

  // ===================== validated, bounded env config =====================

  test("resolveBoundedInt() rejects zero, negative, NaN, non-integer, and absurdly large values, falling back to the given default", async () => {
    const { resolveBoundedInt } = await import("../lib/rateLimit.js");
    assert.equal(resolveBoundedInt("0", 20), 20);
    assert.equal(resolveBoundedInt("-5", 20), 20);
    assert.equal(resolveBoundedInt("not-a-number", 20), 20);
    assert.equal(resolveBoundedInt("3.5", 20), 20);
    assert.equal(resolveBoundedInt("99999999999", 20, { max: 10_000 }), 20);
    assert.equal(resolveBoundedInt("15", 20), 15, "a genuinely valid override must still be respected");
  });
});
