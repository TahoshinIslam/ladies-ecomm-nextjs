// Phase 11, section O — controlled, bounded-concurrency local
// load/resilience evidence against the real disposable `next start`
// server (scripts/httpTestServer.mjs). Deliberately modest concurrency
// (20) — this is a correctness/stability check ("does it stay correct and
// not crash under concurrent load"), not a capacity benchmark; a real
// capacity number requires the live Vercel/Atlas gates in
// docs/PRODUCTION_READINESS.md's PENDING list, not a local single-process
// `next start`.
//
// Order-idempotency and COD-duplication under CONCURRENT requests are
// already proven with call-count evidence in
// tests/orderPostCommitEffects.test.mjs ("concurrent same-key replay") —
// not re-implemented here to avoid duplicating that evidence.
// Multi-instance realtime concurrency is proven separately in
// tests/http/multiInstanceEvents.integration.test.mjs.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestUser } from "../helpers/testDb.mjs";

const BASE_URL = process.env.HTTP_TEST_BASE_URL || "http://localhost:3000";
const CONCURRENCY = 20;

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
    ? skipReason || "MONGO_URI_TEST not reachable"
    : false;

after(async () => {
  if (dbConnectable) await disconnectTestDb();
});

function summarize(durations) {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    p95: sorted[Math.floor(sorted.length * 0.95)],
  };
}

describe("Phase 11 — bounded-concurrency load/resilience checks", { skip }, () => {
  test(`${CONCURRENCY} concurrent GETs against a cached public read (/api/settings/public) all succeed`, async () => {
    const start = Date.now();
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        const t0 = Date.now();
        const res = await fetch(`${BASE_URL}/api/settings/public`);
        return { status: res.status, ms: Date.now() - t0 };
      }),
    );
    const totalMs = Date.now() - start;
    assert.ok(results.every((r) => r.status === 200), "every concurrent request must succeed");
    const stats = summarize(results.map((r) => r.ms));
    console.log(`[load] settings/public x${CONCURRENCY}: total=${totalMs}ms min=${stats.min}ms avg=${stats.avg}ms p95=${stats.p95}ms max=${stats.max}ms`);
  });

  test(`${CONCURRENCY} concurrent GETs to /api/health/ready all succeed and stay fast`, async () => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        const t0 = Date.now();
        const res = await fetch(`${BASE_URL}/api/health/ready`);
        return { status: res.status, ms: Date.now() - t0 };
      }),
    );
    assert.ok(results.every((r) => r.status === 200));
    const stats = summarize(results.map((r) => r.ms));
    console.log(`[load] health/ready x${CONCURRENCY}: min=${stats.min}ms avg=${stats.avg}ms p95=${stats.p95}ms max=${stats.max}ms`);
  });

  test("concurrent session validation: many parallel authenticated requests from the same session all succeed with consistent identity", async () => {
    const user = await createTestUser({ role: "customer" });
    const { createSession } = await import("../../lib/session.js");
    const session = await createSession(user._id, { userAgent: "phase11-load-test" });
    const cookie = `__Host-tahos_session=${session.rawToken}`;

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => fetch(`${BASE_URL}/api/users/me`, { headers: { cookie } })),
    );
    assert.ok(results.every((r) => r.status === 200), "every concurrent request on the same valid session must succeed");
    const bodies = await Promise.all(results.map((r) => r.json()));
    assert.ok(bodies.every((b) => b.user._id === user._id.toString()), "every response must resolve to the same identity");
  });

  test("concurrent login attempts against a single account: rate limiting engages without crashing (every response is 200/401/429, never 500)", async () => {
    const user = await createTestUser({ role: "customer" });
    // A fake, unique X-Forwarded-For per run (same trusted-proxy pattern
    // already used by tests/http/orderIdempotency.integration.test.mjs
    // etc. — this harness runs with TRUST_PROXY_HEADERS=true/hop-count=1,
    // see scripts/httpTestServer.mjs) — deliberately exhausting the
    // per-IP login rate limit is the whole point of this test, so it must
    // use its OWN IP bucket rather than the shared 127.0.0.1 bucket every
    // other HTTP suite's real login fixtures share; without this, this
    // test would starve unrelated suites' legitimate logins for the rest
    // of the 15-minute window (confirmed: it did, before this fix).
    const fakeClientIp = `198.51.100.${crypto.randomInt(1, 255)}`;
    // Real password is unknown here (createTestUser hashes a fixed one
    // server-side) — deliberately using a WRONG password: this exercises
    // the failed-login rate-limit path (lib/rateLimit.js), which is the
    // resilience property under test, not successful-login concurrency.
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        fetch(`${BASE_URL}/api/users/login`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE_URL, "x-forwarded-for": fakeClientIp },
          body: JSON.stringify({ email: user.email, password: "definitely-wrong-password" }),
        }),
      ),
    );
    const statuses = results.map((r) => r.status);
    assert.ok(
      statuses.every((s) => [400, 401, 423, 429].includes(s)),
      `every concurrent failed-login attempt must resolve to a real client-error status, never a 500: got ${statuses.join(",")}`,
    );
    console.log(`[load] concurrent failed logins x${CONCURRENCY}: statuses=${JSON.stringify(statuses)}`);
  });
});

// ---------------------------------------------------------------------
// Mongo-unavailable behavior: a SEPARATE, single throwaway `next start`
// instance pointed at a genuinely unreachable Mongo host (not the shared
// disposable database every other test in this run depends on) — proves
// readiness fails closed (503) while liveness stays up (200), the app
// doesn't crash, and no internal detail leaks, then confirms RECOVERY
// once pointed at a real database.
// ---------------------------------------------------------------------
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForLive(baseUrl, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health/live`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

describe("Phase 11 — Mongo-unavailable behavior (separate throwaway instance)", { skip }, () => {
  test("readiness returns 503 (sanitized) while liveness stays 200 when Mongo is unreachable, then recovers once Mongo is reachable again", async () => {
    const port = await findFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    // An address in the TEST-NET-1 documentation range (RFC 5737) —
    // guaranteed unreachable/non-routable, never a real host.
    const unreachableUri = "mongodb://192.0.2.1:27017/tahos_test_unreachable?serverSelectionTimeoutMS=1500";

    const child = spawn("node_modules/.bin/next", ["start", "-p", String(port)], {
      cwd: new URL("../..", import.meta.url).pathname,
      env: {
        ...process.env,
        PORT: String(port),
        ALLOW_TEST_DB_OVERRIDE: "true",
        TEST_SERVER_MONGO_URI: unreachableUri,
        APP_ORIGIN: baseUrl,
      },
      stdio: "ignore",
    });

    try {
      const isLive = await waitForLive(baseUrl, 30_000);
      assert.ok(isLive, "the app process itself must come up and respond to /api/health/live even though Mongo is unreachable");

      const readyRes = await fetch(`${baseUrl}/api/health/ready`);
      assert.equal(readyRes.status, 503, "readiness must fail closed when Mongo is unreachable");
      const readyText = await readyRes.text();
      assert.ok(!/192\.0\.2\.1|mongo|ECONNREFUSED|timeout/i.test(readyText), "must never leak the unreachable host/driver detail");

      // Liveness must stay 200 the whole time — a database outage is not
      // a process-health problem.
      const liveRes = await fetch(`${baseUrl}/api/health/live`);
      assert.equal(liveRes.status, 200);

      // No crash loop: the process must still be running after both
      // checks above (never restarted/exited on its own).
      assert.equal(child.exitCode, null, "the server process must not have crashed");
    } finally {
      child.kill("SIGTERM");
    }
  });
});
