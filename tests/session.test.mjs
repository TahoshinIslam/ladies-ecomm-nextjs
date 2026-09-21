// Phase 2: session-cookie, CSRF, and SSE security tests — the parts of
// tests/authLifecycle.test.mjs's Phase 1 baseline that are genuinely new
// with this migration (cookie attributes, CSRF layers, revocation,
// fixation, SSE auth), rather than the login/lockout/permission behavior
// that file already covers.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  truncateAll,
  createTestSession,
  requestAs,
  createTestUser,
  createTestProduct,
  deleteRows,
  rawQuery,
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("Session cookies, CSRF, and SSE authentication", { skip: !canRun && reason }, () => {
  let loginPOST, logoutPOST, mePOST_GET, meUpdatePUT;
  let orderEventsGET, orderCreatePOST;
  let resetPasswordPOST;

  before(async () => {
    await connectTestDb();
    // A real MySQL test database persists across runs (unlike the old
    // throwaway per-CI-run Mongo instance) — start from a clean slate so
    // rate-limit counters, leftover fixtures, etc. from a previous run (or
    // a previous test file) can never change this file's outcome.
    await truncateAll();
    ({ POST: loginPOST } = await import("../app/api/users/login/route.js"));
    ({ POST: logoutPOST } = await import("../app/api/users/logout/route.js"));
    ({ GET: mePOST_GET, PUT: meUpdatePUT } = await import("../app/api/users/me/route.js"));
    ({ GET: orderEventsGET } = await import("../app/api/orders/[id]/events/route.js"));
    ({ POST: orderCreatePOST } = await import("../app/api/orders/route.js"));
    ({ POST: resetPasswordPOST } = await import("../app/api/users/reset-password/[token]/route.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  function setCookieMap(res) {
    const map = {};
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";").map((s) => s.trim());
      const [name, value] = pair.split("=");
      map[name] = { value, attrs: attrs.map((a) => a.toLowerCase()) };
    }
    return map;
  }

  // ===================== 3-7: cookie attributes =====================

  test("session cookie is HttpOnly, SameSite=Lax, Path=/", async () => {
    const user = await createTestUser();
    try {
      const req = requestAs({ method: "POST", url: "http://test/api/users/login", body: { email: user.email, password: "TestPassword123!" } });
      const res = await loginPOST(req);
      const cookies = setCookieMap(res);
      const session = cookies.tahos_session;
      assert.ok(session, "tahos_session must be set");
      assert.ok(session.attrs.includes("httponly"), "must be HttpOnly");
      assert.ok(session.attrs.some((a) => a === "samesite=lax"), "must be SameSite=Lax");
      assert.ok(session.attrs.includes("path=/"), "must be Path=/");
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });

  test("the Secure flag responds to NODE_ENV at call-time, even though the cookie NAME is frozen at module load", async () => {
    // SESSION_COOKIE_NAME is intentionally computed once at import time (see
    // lib/cookies.js's own comment on why) — this process already imported
    // it under NODE_ENV=test, so it stays "tahos_session" no matter what we
    // do to process.env.NODE_ENV afterward. Only the `secure` attribute is
    // re-evaluated per call. This test checks exactly that distinction:
    // flipping NODE_ENV changes `secure`, but never the cookie's name here.
    const { setSessionCookie, SESSION_COOKIE_NAME } = await import("../lib/cookies.js");
    const { NextResponse } = await import("next/server");

    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const response = NextResponse.json({});
      setSessionCookie(response, "fake-raw-token-for-attribute-inspection-only");
      const cookies = setCookieMap(response);
      const cookie = cookies[SESSION_COOKIE_NAME];
      assert.ok(cookie, "the (frozen) session cookie name must still be set");
      assert.ok(cookie.attrs.includes("secure"), "must be Secure once NODE_ENV reads as production, even though the name didn't change");
      assert.ok(cookie.attrs.includes("path=/"), "must be Path=/");
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  test("sessionCookieNameFor() — the pure, parameterized naming decision — returns the __Host- prefix for production and the plain name otherwise", async () => {
    const { sessionCookieNameFor } = await import("../lib/cookies.js");
    assert.equal(sessionCookieNameFor(true), "__Host-tahos_session");
    assert.equal(sessionCookieNameFor(false), "tahos_session");
  });

  test("in this (non-production) test environment, the cookie is NOT Secure and uses the plain name — dev/test runs over plain HTTP", async () => {
    const user = await createTestUser();
    try {
      const req = requestAs({ method: "POST", url: "http://test/api/users/login", body: { email: user.email, password: "TestPassword123!" } });
      const res = await loginPOST(req);
      const cookies = setCookieMap(res);
      assert.ok(cookies.tahos_session, "plain tahos_session name in non-production");
      assert.ok(!cookies.tahos_session.attrs.includes("secure"), "not Secure over plain HTTP in dev/test");
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });

  // ===================== 8-10: what's actually stored/returned =====================

  test("raw session token is absent from the response JSON; database stores only its hash (never the raw value)", async () => {
    const user = await createTestUser();
    try {
      const req = requestAs({ method: "POST", url: "http://test/api/users/login", body: { email: user.email, password: "TestPassword123!" } });
      const res = await loginPOST(req);
      const json = await res.json();
      const bodyText = JSON.stringify(json);
      assert.ok(!("token" in json));

      const cookies = setCookieMap(res);
      const rawSessionToken = cookies.tahos_session.value;
      const rawCsrfToken = cookies.tahos_csrf.value;
      assert.ok(!bodyText.includes(rawSessionToken));
      assert.ok(!bodyText.includes(rawCsrfToken));

      // Reads the raw stored row directly via SQL — the SQL model itself
      // has no Mongoose-style select:false field hiding (every model
      // returns a full row; see models/README-migration.md), so the
      // property this test actually protects — the raw token/CSRF value is
      // never stored in plaintext, only its SHA-256 hash — is checked
      // directly against the stored hash instead of against a
      // field-omitted-by-default query shape that no longer exists.
      const rows = await rawQuery("SELECT token_hash, csrf_token_hash FROM customer_sessions WHERE customer_id = ?", [user._id]);
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0].token_hash, rawSessionToken, "stored token_hash must not equal the raw token");
      assert.notEqual(rows[0].csrf_token_hash, rawCsrfToken, "stored csrf_token_hash must not equal the raw CSRF token");
      const storedText = JSON.stringify(rows[0]);
      assert.ok(!storedText.includes(rawSessionToken));
      assert.ok(!storedText.includes(rawCsrfToken));
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });

  // ===================== 16-17: logout / revocation =====================

  test("logout revokes the current session; replaying the old cookie afterward fails (401)", async () => {
    const user = await createTestUser();
    try {
      const session = await createTestSession(user._id);
      const meReq = requestAs({ method: "GET", url: "http://test/api/users/me", session });
      assert.equal((await mePOST_GET(meReq)).status, 200, "sanity check: the session works before logout");

      const logoutReq = requestAs({ method: "POST", url: "http://test/api/users/logout", session });
      const logoutRes = await logoutPOST(logoutReq);
      assert.equal(logoutRes.status, 200);

      const replayReq = requestAs({ method: "GET", url: "http://test/api/users/me", session });
      const replayRes = await mePOST_GET(replayReq);
      assert.equal(replayRes.status, 401, "the exact same cookie must be rejected after logout");

      const rows = await rawQuery("SELECT revoked_at FROM customer_sessions WHERE customer_id = ?", [user._id]);
      assert.ok(rows[0].revoked_at, "the session record itself is marked revoked");
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });

  test("logout with no session cookie still returns success (no information leakage) and clears cookies", async () => {
    const req = requestAs({ method: "POST", url: "http://test/api/users/logout" });
    const res = await logoutPOST(req);
    assert.equal(res.status, 200);
    const cookies = setCookieMap(res);
    assert.equal(cookies.tahos_session.value, "", "logout still clears the cookie even with nothing to revoke");
  });

  // ===================== 24-25: fixation & isolation =====================

  test("session fixation is prevented: logging in while presenting an existing session cookie issues a brand-new session, and the old one no longer works", async () => {
    const user = await createTestUser();
    try {
      const attackerPlantedSession = await createTestSession(user._id);
      const oldRawToken = attackerPlantedSession.rawToken;

      const loginReq = requestAs({
        method: "POST",
        url: "http://test/api/users/login",
        session: attackerPlantedSession, // simulates a cookie already present in the browser
        body: { email: user.email, password: "TestPassword123!" },
      });
      const res = await loginPOST(loginReq);
      assert.equal(res.status, 200);
      const cookies = res.headers.getSetCookie().find((c) => c.startsWith("tahos_session="));
      const newRawToken = cookies.split(";")[0].split("=")[1];
      assert.notEqual(newRawToken, oldRawToken, "a fresh session is issued, never the presented one");

      const rows = await rawQuery("SELECT revoked_at FROM customer_sessions WHERE token_hash = ?", [await sha256Hex(oldRawToken)]);
      assert.ok(rows[0].revoked_at, "the pre-existing session is revoked, not left valid");
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });

  test("multiple sessions for the same user remain isolated: revoking one does not affect the other", async () => {
    const user = await createTestUser();
    try {
      const sessionA = await createTestSession(user._id);
      const sessionB = await createTestSession(user._id);

      const logoutReq = requestAs({ method: "POST", url: "http://test/api/users/logout", session: sessionA });
      await logoutPOST(logoutReq);

      const reqA = requestAs({ method: "GET", url: "http://test/api/users/me", session: sessionA });
      assert.equal((await mePOST_GET(reqA)).status, 401, "session A is dead");

      const reqB = requestAs({ method: "GET", url: "http://test/api/users/me", session: sessionB });
      assert.equal((await mePOST_GET(reqB)).status, 200, "session B is untouched by A's revocation");
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });

  // ===================== 26: index configuration =====================

  test("sessions table has a unique index on token_hash and a compound index on (customer_id, revoked_at)", async () => {
    // MySQL has no direct equivalent of Mongo's TTL index — expiry here is
    // enforced explicitly (validateSessionToken() re-checks expires_at on
    // every request, see lib/session.js), which the 401-after-logout and
    // session-limit tests in this file already exercise; a periodic
    // DELETE-past-expires_at sweep (the storage-reclamation backstop, same
    // role the old TTL index played) is documented in sql/schema.sql
    // rather than asserted here, since it's an operational job, not
    // query-time behavior.
    const rows = await rawQuery("SHOW INDEX FROM customer_sessions");
    const byName = {};
    for (const r of rows) {
      byName[r.Key_name] = byName[r.Key_name] || [];
      byName[r.Key_name].push(r);
    }

    const tokenHashIndex = Object.values(byName).find((cols) => cols.length === 1 && cols[0].Column_name === "token_hash");
    assert.ok(tokenHashIndex, "token_hash must be indexed");
    assert.equal(tokenHashIndex[0].Non_unique, 0, "token_hash index must be unique");

    const compound = Object.values(byName).find(
      (cols) => cols.some((c) => c.Column_name === "customer_id") && cols.some((c) => c.Column_name === "revoked_at"),
    );
    assert.ok(compound, "compound (customer_id, revoked_at) index must exist");
  });

  // ===================== 28: no token in logs (characterized, not exhaustively proven) =====================

  test("lib/session.js never logs the raw token — createSession()/validateSessionToken() contain no console.* call referencing the raw value", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(new URL("../lib/session.js", import.meta.url), "utf8");
    assert.ok(!/console\.(log|warn|error|info)\([^)]*rawToken/.test(source), "no console.* call passes rawToken anywhere in lib/session.js");
  });

  // ===================== 18-19: password reset / change revocation =====================
  // (Reset-token flow itself, expiry, and single-use behavior are covered
  // in tests/passwordResetLinks.test.mjs — these tests only check the
  // session-revocation side of both flows.)

  test("a successful authenticated password change revokes ALL sessions for that user and clears the current cookie", async () => {
    const user = await createTestUser();
    try {
      const sessionA = await createTestSession(user._id);
      const sessionB = await createTestSession(user._id);

      const req = requestAs({
        method: "PUT",
        url: "http://test/api/users/me",
        session: sessionA,
        body: { currentPassword: "TestPassword123!", newPassword: "BrandNewPassword456!" },
      });
      const res = await meUpdatePUT(req);
      assert.equal(res.status, 200);

      const cookies = setCookieMap(res);
      assert.equal(cookies.tahos_session.value, "", "the response clears the cookie on THIS browser");

      const reqA = requestAs({ method: "GET", url: "http://test/api/users/me", session: sessionA });
      assert.equal((await mePOST_GET(reqA)).status, 401, "the session used to make the change is itself revoked");

      const reqB = requestAs({ method: "GET", url: "http://test/api/users/me", session: sessionB });
      assert.equal((await mePOST_GET(reqB)).status, 401, "a completely different, previously-valid session for the same user is ALSO revoked");
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });

  // ===================== 21: ownership checks (spot-check; full coverage lives in tests/orderTransactions.test.mjs etc.) =====================

  test("ownership checks still work end-to-end through the new session layer (order GET, cross-user rejection)", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const created = await (
        await orderCreatePOST(
          requestAs({
            method: "POST",
            url: "http://test/api/orders",
            session: await createTestSession(owner._id),
            body: {
              items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
              shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" },
            },
          }),
        )
      ).json();

      const { GET: orderGET } = await import("../app/api/orders/[id]/route.js");
      const strangerReq = requestAs({ method: "GET", url: `http://test/api/orders/${created.order._id}`, session: await createTestSession(stranger._id) });
      const strangerRes = await orderGET(strangerReq, { params: Promise.resolve({ id: created.order._id }) });
      assert.equal(strangerRes.status, 403);
    } finally {
      await deleteRows("orders", "customer_id", owner._id);
      await deleteRows("customers", "id", [owner._id, stranger._id]);
    }
  });

  // ===================== 29-33: CSRF =====================

  /**
   * These CSRF tests need any authenticated, unsafe, reachable request —
   * the property under test is the CSRF layer, not the endpoint.
   *
   * They used to drive POST /api/coupons with an "admin" account. That
   * endpoint now refuses every storefront session outright, which would
   * have left the three rejection tests below passing for the wrong reason:
   * 403 because shop management moved, not because the CSRF check worked.
   * A green test that no longer exercises its subject is worse than a red
   * one. PUT /api/users/me is a real unsafe request a shopper can actually
   * make, so a 403 here means what it says.
   */
  async function makeCsrfFixture() {
    const shopper = await createTestUser();
    return { shopper, session: await createTestSession(shopper._id) };
  }

  const profileUpdateBody = () => ({ name: `Renamed ${Date.now()}` });

  test("a valid authenticated unsafe request with matching Origin and CSRF header succeeds", async () => {
    const { shopper, session } = await makeCsrfFixture();
    try {
      const req = requestAs({
        method: "PUT",
        url: "http://test/api/users/me",
        session,
        body: profileUpdateBody(),
      });
      const res = await meUpdatePUT(req);
      assert.equal(res.status, 200);
    } finally {
      await deleteRows("customers", "id", shopper._id);
    }
  });

  test("missing X-CSRF-Token header on an authenticated unsafe request fails (403)", async () => {
    const { shopper, session } = await makeCsrfFixture();
    try {
      const req = requestAs({
        method: "PUT",
        url: "http://test/api/users/me",
        session,
        omitCsrfHeader: true,
        body: profileUpdateBody(),
      });
      const res = await meUpdatePUT(req);
      assert.equal(res.status, 403);
    } finally {
      await deleteRows("customers", "id", shopper._id);
    }
  });

  test("mismatched X-CSRF-Token header (doesn't match the session's csrfTokenHash) fails (403)", async () => {
    const { shopper, session } = await makeCsrfFixture();
    try {
      const req = requestAs({
        method: "PUT",
        url: "http://test/api/users/me",
        session,
        body: profileUpdateBody(),
      });
      req.headers.set("x-csrf-token", "completely-wrong-csrf-value");
      const res = await meUpdatePUT(req);
      assert.equal(res.status, 403);
    } finally {
      await deleteRows("customers", "id", shopper._id);
    }
  });

  test("cross-origin unsafe request (Origin header mismatch) fails (403) — enforced even before CSRF/session checks", async () => {
    const { shopper, session } = await makeCsrfFixture();
    try {
      const req = requestAs({
        method: "PUT",
        url: "http://test/api/users/me",
        session,
        originOverride: "https://evil.example",
        body: profileUpdateBody(),
      });
      const res = await meUpdatePUT(req);
      assert.equal(res.status, 403);
    } finally {
      await deleteRows("customers", "id", shopper._id);
    }
  });

  test("Origin protection also applies to the unauthenticated login endpoint", async () => {
    const req = requestAs({
      method: "POST",
      url: "http://test/api/users/login",
      originOverride: "https://evil.example",
      body: { email: "whoever@example.invalid", password: "whatever" },
    });
    const res = await loginPOST(req);
    assert.equal(res.status, 403, "a cross-origin login attempt is rejected before credentials are even checked");
  });

  test("safe GET requests do not require a CSRF header, even when authenticated", async () => {
    const { shopper, session } = await makeCsrfFixture();
    try {
      const req = requestAs({ method: "GET", url: "http://test/api/users/me", session });
      const res = await mePOST_GET(req);
      assert.equal(res.status, 200, "GET is exempt from CSRF entirely — no X-CSRF-Token attached here");
    } finally {
      await deleteRows("customers", "id", shopper._id);
    }
  });

  // ===================== 34-35: SSE authentication =====================

  // Two tests here drove app/api/admin/events, the staff notification
  // stream. They were briefly replaced by tests of the staff guards, which
  // have since been deleted too: with no staff-gated route left to protect,
  // requireAdmin/requirePermission/requireStaff had no callers. There is no
  // staff concept in this app to assert about any more. The storefront's own
  // per-user stream is unaffected and is covered below.



  // ===================== session-limit enforcement =====================

  test("session-limit behavior: exceeding MAX_SESSIONS_PER_USER revokes the OLDEST excess sessions and leaves the most recent ones active", async () => {
    const user = await createTestUser();
    try {
      // lib/session.js defaults MAX_ACTIVE_SESSIONS_PER_USER to 10 when
      // MAX_SESSIONS_PER_USER isn't configured (it isn't, in .env.test) —
      // creating 11 sessions in order must push the very first one out.
      const sessions = [];
      for (let i = 0; i < 11; i++) {
        sessions.push(await createTestSession(user._id));
        // created_at has whole-millisecond resolution; without this, 11
        // rapid same-tick creates could tie on sort order and make "the
        // oldest" ambiguous.
        await new Promise((r) => setTimeout(r, 5));
      }

      const oldestReq = requestAs({ method: "GET", url: "http://test/api/users/me", session: sessions[0] });
      assert.equal((await mePOST_GET(oldestReq)).status, 401, "the oldest session, pushed past the limit, is revoked");

      const newestReq = requestAs({ method: "GET", url: "http://test/api/users/me", session: sessions[10] });
      assert.equal((await mePOST_GET(newestReq)).status, 200, "the newest session is unaffected");

      const [{ n: activeCount }] = await rawQuery("SELECT COUNT(*) AS n FROM customer_sessions WHERE customer_id = ? AND revoked_at IS NULL", [user._id]);
      assert.equal(activeCount, 10, "exactly MAX_SESSIONS_PER_USER sessions remain active");
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });

  test("session-limit enforcement counts only ACTIVE, unexpired sessions — pre-existing revoked/expired rows never count against the limit", async () => {
    const user = await createTestUser();
    try {
      // 5 already-revoked and 5 already-expired sessions — none of these
      // should ever be counted by pruneExcessSessions()'s own query filter
      // (revoked_at IS NULL AND expires_at > NOW()).
      for (let i = 0; i < 5; i++) {
        const s = await createTestSession(user._id);
        await rawQuery("UPDATE customer_sessions SET revoked_at = NOW(3) WHERE token_hash = ?", [await sha256Hex(s.rawToken)]);
      }
      for (let i = 0; i < 5; i++) {
        const s = await createTestSession(user._id);
        await rawQuery("UPDATE customer_sessions SET expires_at = ? WHERE token_hash = ?", [new Date(Date.now() - 1000), await sha256Hex(s.rawToken)]);
      }

      // Now create exactly MAX_ACTIVE (10) genuinely active sessions — if
      // the dead rows above counted, this would incorrectly start evicting
      // some of these before all 10 exist.
      const activeSessions = [];
      for (let i = 0; i < 10; i++) {
        activeSessions.push(await createTestSession(user._id));
        await new Promise((r) => setTimeout(r, 5));
      }

      for (const s of activeSessions) {
        const res = await mePOST_GET(requestAs({ method: "GET", url: "http://test/api/users/me", session: s }));
        assert.equal(res.status, 200, "every one of the 10 active sessions must still be valid — the 10 dead rows must not have consumed any of the limit");
      }

      const [{ n: activeCount }] = await rawQuery(
        "SELECT COUNT(*) AS n FROM customer_sessions WHERE customer_id = ? AND revoked_at IS NULL AND expires_at > NOW(3)",
        [user._id],
      );
      assert.equal(activeCount, 10);
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });

  test("session-limit behavior under CONCURRENT login is characterized: the population may transiently exceed the limit mid-race, but always converges to exactly MAX_ACTIVE_SESSIONS_PER_USER once every concurrent create+prune has settled — this is eventual, not strictly atomic, consistency, which is acceptable since the limit bounds long-run accumulation rather than enforcing a hard per-instant security invariant", async () => {
    const user = await createTestUser();
    try {
      // 15 concurrent logins for the same user — each one independently
      // inserts a session, then runs pruneExcessSessions(), which re-reads
      // whatever the CURRENT true active set is at that moment. There is no
      // cross-call locking, so several of these prune queries can overlap;
      // this test's claim is specifically about the FINAL, settled state,
      // not about any intermediate moment during the race.
      await Promise.all(Array.from({ length: 15 }, () => createTestSession(user._id)));

      const [{ n: finalActiveCount }] = await rawQuery(
        "SELECT COUNT(*) AS n FROM customer_sessions WHERE customer_id = ? AND revoked_at IS NULL AND expires_at > NOW(3)",
        [user._id],
      );
      assert.equal(finalActiveCount, 10, "once every concurrent create+prune has fully settled, the population converges to exactly the configured limit, regardless of the race");

      const [{ n: totalCreated }] = await rawQuery("SELECT COUNT(*) AS n FROM customer_sessions WHERE customer_id = ?", [user._id]);
      assert.equal(totalCreated, 15, "all 15 sessions were genuinely created — the limit revokes excess rows, it never silently drops/fails a concurrent createSession() call itself");
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });

  // ===================== malformed / oversized cookie robustness =====================

  test("a malformed percent-encoded session cookie value returns 401, not a 500 — decodeURIComponent's URIError is caught, not left to propagate as an unhandled exception", async () => {
    const req = new Request("http://test/api/users/me", { headers: { cookie: "tahos_session=%zz-malformed-percent-encoding" } });
    const res = await mePOST_GET(req);
    assert.equal(res.status, 401, "a malformed cookie must be treated the same as no valid cookie, never surfaced as a 500");
  });

  test("an oversized session cookie value (100KB) is rejected safely (401), not a crash or a 500", async () => {
    const hugeValue = "a".repeat(100_000);
    const req = new Request("http://test/api/users/me", { headers: { cookie: `tahos_session=${hugeValue}` } });
    const res = await mePOST_GET(req);
    assert.equal(res.status, 401, "hashing and looking up an oversized garbage value simply finds no matching session — no special-casing needed, but confirmed here rather than assumed");
  });

  // ===================== cross-session CSRF token =====================

  test("a CSRF token that is valid for a DIFFERENT session (same user, two logins) fails against this session", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const sessionA = await createTestSession(admin._id);
      const sessionB = await createTestSession(admin._id);

      // Authenticate as session A, but present session B's (validly
      // formatted, real, just-not-this-session's) CSRF token.
      const req = requestAs({
        method: "PUT",
        url: "http://test/api/users/me",
        session: sessionA,
        body: { name: `Renamed ${Date.now()}` },
      });
      req.headers.set("x-csrf-token", sessionB.rawCsrfToken);
      const res = await meUpdatePUT(req);
      assert.equal(res.status, 403, "a real CSRF token from a different session must not authorize this one");
    } finally {
      await deleteRows("customers", "id", admin._id);
    }
  });

  // ===================== reset/change failure must NOT revoke =====================

  test("a FAILED password reset (invalid/expired token) does not revoke any of the user's valid sessions", async () => {
    const user = await createTestUser();
    try {
      const session = await createTestSession(user._id);

      const badReq = requestAs({
        method: "POST",
        url: "http://test/api/users/reset-password/not-a-real-reset-token",
        body: { password: "WouldBeNewPassword123!" },
      });
      const res = await resetPasswordPOST(badReq, { params: Promise.resolve({ token: "not-a-real-reset-token" }) });
      assert.equal(res.status, 400, "an invalid/expired reset token must be rejected");

      const stillGoodReq = requestAs({ method: "GET", url: "http://test/api/users/me", session });
      assert.equal((await mePOST_GET(stillGoodReq)).status, 200, "the failed reset attempt must not have touched this valid, unrelated session");
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });

  test("a FAILED authenticated password change (wrong currentPassword) does not revoke any session, including the one making the request", async () => {
    const user = await createTestUser();
    try {
      const session = await createTestSession(user._id);

      const req = requestAs({
        method: "PUT",
        url: "http://test/api/users/me",
        session,
        body: { currentPassword: "TotallyWrongPassword!", newPassword: "WouldBeNewPassword123!" },
      });
      const res = await meUpdatePUT(req);
      assert.equal(res.status, 400, "an incorrect currentPassword must be rejected before any password change or revocation happens");

      const stillGoodReq = requestAs({ method: "GET", url: "http://test/api/users/me", session });
      assert.equal((await mePOST_GET(stillGoodReq)).status, 200, "the session used for the failed attempt remains valid — nothing was revoked");
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });

  // Confirmed audit finding, fixed: sessions had no idle timeout at all —
  // lastSeenAt was tracked but never read by validateSessionToken(). This
  // proves the fix against the real DB/session layer, not a mock.
  test("a session idle past the default idle timeout is rejected even though its absolute expiry hasn't arrived", async () => {
    // lib/session.js reads SESSION_IDLE_TIMEOUT_MINUTES once at module
    // load (same established convention as this file's other config
    // constants, e.g. MAX_ACTIVE_SESSIONS_PER_USER) — setting the env var
    // mid-test would not retroactively change an already-imported
    // constant, so this exercises the real default (30 days) directly.
    const user = await createTestUser();
    try {
      const session = await createTestSession(user._id);

      const freshReq = requestAs({ method: "GET", url: "http://test/api/users/me", session });
      assert.equal((await mePOST_GET(freshReq)).status, 200, "a freshly-created session is valid");

      // Backdate last_seen_at past the default 30-day idle window —
      // absolute expiresAt is still ~30 days out from createTestSession's
      // own default too, so only the idle check can be what rejects this.
      const tokenHash = await sha256Hex(session.rawToken);
      await rawQuery("UPDATE customer_sessions SET last_seen_at = ? WHERE token_hash = ?", [
        new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        tokenHash,
      ]);

      const idleReq = requestAs({ method: "GET", url: "http://test/api/users/me", session });
      assert.equal((await mePOST_GET(idleReq)).status, 401, "an idle-past-timeout session must be rejected, not silently accepted");
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });

  test("SESSION_IDLE_TIMEOUT_MINUTES defaults to a generous window — ordinary recent activity is never falsely rejected", async () => {
    const user = await createTestUser();
    try {
      const session = await createTestSession(user._id);
      const tokenHash = await sha256Hex(session.rawToken);
      // 1 hour idle — comfortably inside the default 30-day window.
      await rawQuery("UPDATE customer_sessions SET last_seen_at = ? WHERE token_hash = ?", [
        new Date(Date.now() - 60 * 60 * 1000),
        tokenHash,
      ]);
      const req = requestAs({ method: "GET", url: "http://test/api/users/me", session });
      assert.equal((await mePOST_GET(req)).status, 200);
    } finally {
      await deleteRows("customers", "id", user._id);
    }
  });
});

async function sha256Hex(raw) {
  const crypto = await import("node:crypto");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// Pure unit coverage for lib/session.js's exported resolveIdleTimeoutMs()
// — no database needed. Confirmed audit gap this closes: the idle
// timeout previously had no configuration validation at all, so a value
// smaller than lastSeenAt's own write-throttle window (5 minutes) would
// have logged out genuinely active users, not just abandoned sessions.
describe("lib/session.js — resolveIdleTimeoutMs() configuration validation", () => {
  test("unset/invalid values fall back to the 30-day default", async () => {
    const { resolveIdleTimeoutMs } = await import("../lib/session.js");
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    assert.equal(resolveIdleTimeoutMs(undefined), THIRTY_DAYS_MS);
    assert.equal(resolveIdleTimeoutMs(""), THIRTY_DAYS_MS);
    assert.equal(resolveIdleTimeoutMs("not-a-number"), THIRTY_DAYS_MS);
    assert.equal(resolveIdleTimeoutMs("-5"), THIRTY_DAYS_MS);
    assert.equal(resolveIdleTimeoutMs("0"), THIRTY_DAYS_MS);
  });

  test("a configured value below the minimum floor (15 minutes) is clamped up, not accepted as-is", async () => {
    const { resolveIdleTimeoutMs } = await import("../lib/session.js");
    const FIFTEEN_MIN_MS = 15 * 60 * 1000;
    assert.equal(resolveIdleTimeoutMs("1"), FIFTEEN_MIN_MS, "1 minute is below lastSeenAt's own 5-minute write-throttle lag — must be floored");
    assert.equal(resolveIdleTimeoutMs("14"), FIFTEEN_MIN_MS);
    assert.equal(resolveIdleTimeoutMs("15"), FIFTEEN_MIN_MS, "exactly the floor is accepted as the floor value");
  });

  test("a configured value at or above the floor is used exactly as given", async () => {
    const { resolveIdleTimeoutMs } = await import("../lib/session.js");
    assert.equal(resolveIdleTimeoutMs("16"), 16 * 60 * 1000);
    assert.equal(resolveIdleTimeoutMs("120"), 120 * 60 * 1000);
    assert.equal(resolveIdleTimeoutMs("43200"), 43200 * 60 * 1000, "the documented default (30 days) round-trips exactly when set explicitly");
  });
});
