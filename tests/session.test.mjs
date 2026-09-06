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
  createTestSession,
  requestAs,
  createTestUser,
  createTestProduct,
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("Session cookies, CSRF, and SSE authentication", { skip: !canRun && reason }, () => {
  let loginPOST, logoutPOST, mePOST_GET, meUpdatePUT, couponsGET, couponsPOST;
  let adminEventsGET, orderEventsGET, orderCreatePOST;
  let resetPasswordPOST;
  let User, Session, Coupon;

  before(async () => {
    await connectTestDb();
    ({ POST: loginPOST } = await import("../app/api/users/login/route.js"));
    ({ POST: logoutPOST } = await import("../app/api/users/logout/route.js"));
    ({ GET: mePOST_GET, PUT: meUpdatePUT } = await import("../app/api/users/me/route.js"));
    ({ GET: couponsGET, POST: couponsPOST } = await import("../app/api/coupons/route.js"));
    ({ GET: adminEventsGET } = await import("../app/api/admin/events/route.js"));
    ({ GET: orderEventsGET } = await import("../app/api/orders/[id]/events/route.js"));
    ({ POST: orderCreatePOST } = await import("../app/api/orders/route.js"));
    ({ POST: resetPasswordPOST } = await import("../app/api/users/reset-password/[token]/route.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Session } = await import("../models/sessionModel.js"));
    ({ default: Coupon } = await import("../models/couponModel.js"));
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
      await User.deleteOne({ _id: user._id });
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
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 8-10: what's actually stored/returned =====================

  test("raw session token is absent from the response JSON; database stores only its hash; CSRF raw value is not stored anywhere in the database", async () => {
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

      // A DEFAULT find (no explicit .select()) must not even return
      // tokenHash/csrfTokenHash at all — models/sessionModel.js marks both
      // select:false specifically so an unrelated future query elsewhere in
      // the codebase can't accidentally leak either hash by omission.
      const storedDefault = await Session.findOne({ user: user._id });
      assert.equal(storedDefault.tokenHash, undefined, "tokenHash must be excluded from a normal query by default");
      assert.equal(storedDefault.csrfTokenHash, undefined, "csrfTokenHash must be excluded from a normal query by default");
      const storedDefaultText = JSON.stringify(storedDefault.toObject());
      assert.ok(!storedDefaultText.includes(rawSessionToken));
      assert.ok(!storedDefaultText.includes(rawCsrfToken));

      // Opting in explicitly (as lib/session.js itself must, and does, for
      // csrfTokenHash) to verify the underlying stored values are actually
      // hashes, not the raw tokens.
      const stored = await Session.findOne({ user: user._id }).select("+tokenHash +csrfTokenHash");
      assert.notEqual(stored.tokenHash, rawSessionToken);
      assert.notEqual(stored.csrfTokenHash, rawCsrfToken);
      const storedText = JSON.stringify(stored.toObject());
      assert.ok(!storedText.includes(rawSessionToken));
      assert.ok(!storedText.includes(rawCsrfToken));
    } finally {
      await User.deleteOne({ _id: user._id });
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

      const stored = await Session.findOne({ user: user._id });
      assert.ok(stored.revokedAt, "the session record itself is marked revoked");
    } finally {
      await User.deleteOne({ _id: user._id });
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

      const oldSession = await Session.findOne({ tokenHash: await sha256Hex(oldRawToken) });
      assert.ok(oldSession.revokedAt, "the pre-existing session is revoked, not left valid");
    } finally {
      await User.deleteOne({ _id: user._id });
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
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== 26: TTL / index configuration =====================

  test("session schema declares a TTL index on expiresAt, a unique index on tokenHash, and a compound index on {user, revokedAt}", async () => {
    const indexes = await Session.collection.indexes();
    const byName = Object.fromEntries(indexes.map((i) => [JSON.stringify(i.key), i]));

    const ttl = indexes.find((i) => i.key.expiresAt === 1);
    assert.ok(ttl, "expiresAt index must exist");
    assert.equal(ttl.expireAfterSeconds, 0, "TTL index configured to expire exactly at the stored date");

    const tokenHashIndex = indexes.find((i) => i.key.tokenHash === 1);
    assert.ok(tokenHashIndex?.unique, "tokenHash must be uniquely indexed");

    assert.ok(byName[JSON.stringify({ user: 1, revokedAt: 1 })], "compound {user, revokedAt} index must exist");
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
      await User.deleteOne({ _id: user._id });
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
      const { default: Order } = await import("../models/orderModel.js");
      await Order.deleteMany({ user: owner._id });
      await User.deleteMany({ _id: { $in: [owner._id, stranger._id] } });
    }
  });

  // ===================== 29-33: CSRF =====================

  async function makeCouponFixture() {
    const admin = await createTestUser({ role: "admin" });
    return { admin, session: await createTestSession(admin._id) };
  }

  test("a valid authenticated POST with matching Origin and CSRF header succeeds", async () => {
    const { admin, session } = await makeCouponFixture();
    try {
      const req = requestAs({
        method: "POST",
        url: "http://test/api/coupons",
        session,
        body: { code: `CSRFOK${Date.now()}`, discountType: "flat", discountValue: 10, expiresAt: new Date(Date.now() + 86400000) },
      });
      const res = await couponsPOST(req);
      assert.equal(res.status, 201);
      await Coupon.deleteOne({ _id: (await res.json()).coupon._id });
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("missing X-CSRF-Token header on an authenticated unsafe request fails (403)", async () => {
    const { admin, session } = await makeCouponFixture();
    try {
      const req = requestAs({
        method: "POST",
        url: "http://test/api/coupons",
        session,
        omitCsrfHeader: true,
        body: { code: "SHOULDFAIL", discountType: "flat", discountValue: 10, expiresAt: new Date(Date.now() + 86400000) },
      });
      const res = await couponsPOST(req);
      assert.equal(res.status, 403);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("mismatched X-CSRF-Token header (doesn't match the session's csrfTokenHash) fails (403)", async () => {
    const { admin, session } = await makeCouponFixture();
    try {
      const req = requestAs({
        method: "POST",
        url: "http://test/api/coupons",
        session,
        body: { code: "SHOULDFAIL2", discountType: "flat", discountValue: 10, expiresAt: new Date(Date.now() + 86400000) },
      });
      req.headers.set("x-csrf-token", "completely-wrong-csrf-value");
      const res = await couponsPOST(req);
      assert.equal(res.status, 403);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("cross-origin unsafe request (Origin header mismatch) fails (403) — enforced even before CSRF/session checks", async () => {
    const { admin, session } = await makeCouponFixture();
    try {
      const req = requestAs({
        method: "POST",
        url: "http://test/api/coupons",
        session,
        originOverride: "https://evil.example",
        body: { code: "SHOULDFAIL3", discountType: "flat", discountValue: 10, expiresAt: new Date(Date.now() + 86400000) },
      });
      const res = await couponsPOST(req);
      assert.equal(res.status, 403);
    } finally {
      await User.deleteOne({ _id: admin._id });
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
    const { admin, session } = await makeCouponFixture();
    try {
      const req = requestAs({ method: "GET", url: "http://test/api/coupons", session });
      const res = await couponsGET(req);
      assert.equal(res.status, 200, "GET is exempt from CSRF entirely — no X-CSRF-Token attached here");
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  // ===================== 34-35: SSE authentication =====================

  test("SSE (admin events): missing session is rejected before the stream opens", async () => {
    const req = requestAs({ method: "GET", url: "http://test/api/admin/events" });
    const res = await adminEventsGET(req);
    assert.equal(res.status, 401);
  });

  test("SSE (admin events): a customer is rejected (403); an authorized staff member succeeds (200) via cookie only, no ?token= anywhere", async () => {
    const customer = await createTestUser({ role: "customer" });
    const employee = await createTestUser({ role: "employee" });
    try {
      const customerReq = requestAs({ method: "GET", url: "http://test/api/admin/events", session: await createTestSession(customer._id) });
      assert.equal((await adminEventsGET(customerReq)).status, 403);

      // The route's ReadableStream sets a 25s heartbeat setInterval that
      // only clears when request.signal fires "abort" — a real EventSource
      // disconnect does this naturally, but here we must trigger it
      // ourselves (via an AbortController) or the interval leaks and keeps
      // the Node process alive past the end of the test run.
      const staffController = new AbortController();
      const staffReq = requestAs({ method: "GET", url: "http://test/api/admin/events", session: await createTestSession(employee._id), signal: staffController.signal });
      const staffRes = await adminEventsGET(staffReq);
      try {
        assert.equal(staffRes.status, 200);
        assert.equal(staffRes.headers.get("content-type"), "text/event-stream");
        assert.match(staffRes.headers.get("cache-control") || "", /no-store|no-cache/);
      } finally {
        staffController.abort();
      }
    } finally {
      await User.deleteMany({ _id: { $in: [customer._id, employee._id] } });
    }
  });

  test("SSE (order events): the order's owner can open the stream; a different customer cannot (403); confirms no ?token= is read from the URL at all", async () => {
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
      const orderId = created.order._id;

      // A URL with NO ?token= query param at all — proving the route
      // authenticates purely from the cookie. Aborted afterward for the
      // same reason as the admin-events success case above: the route's
      // heartbeat setInterval only clears on request.signal "abort".
      const ownerController = new AbortController();
      const ownerReq = requestAs({ method: "GET", url: `http://test/api/orders/${orderId}/events`, session: await createTestSession(owner._id), signal: ownerController.signal });
      const ownerRes = await orderEventsGET(ownerReq, { params: Promise.resolve({ id: orderId }) });
      try {
        assert.equal(ownerRes.status, 200);
        assert.ok(!ownerReq.url.includes("token="), "sanity check on the request URL itself: no token query param was ever constructed");
      } finally {
        ownerController.abort();
      }

      const strangerReq = requestAs({ method: "GET", url: `http://test/api/orders/${orderId}/events`, session: await createTestSession(stranger._id) });
      const strangerRes = await orderEventsGET(strangerReq, { params: Promise.resolve({ id: orderId }) });
      assert.equal(strangerRes.status, 403);

      // A ?token= query param, even if present, is simply ignored — the
      // route never reads searchParams for auth at all anymore.
      const withStaleQueryParam = requestAs({
        method: "GET",
        url: `http://test/api/orders/${orderId}/events?token=some-old-jwt-shaped-string`,
      });
      const ignoredRes = await orderEventsGET(withStaleQueryParam, { params: Promise.resolve({ id: orderId }) });
      assert.equal(ignoredRes.status, 401, "no cookie was presented, so this is unauthenticated regardless of the query string");
    } finally {
      const { default: Order } = await import("../models/orderModel.js");
      await Order.deleteMany({ user: owner._id });
      await User.deleteMany({ _id: { $in: [owner._id, stranger._id] } });
    }
  });

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
        // createdAt has whole-millisecond resolution; without this, 11
        // rapid same-tick creates could tie on sort order and make "the
        // oldest" ambiguous.
        await new Promise((r) => setTimeout(r, 5));
      }

      const oldestReq = requestAs({ method: "GET", url: "http://test/api/users/me", session: sessions[0] });
      assert.equal((await mePOST_GET(oldestReq)).status, 401, "the oldest session, pushed past the limit, is revoked");

      const newestReq = requestAs({ method: "GET", url: "http://test/api/users/me", session: sessions[10] });
      assert.equal((await mePOST_GET(newestReq)).status, 200, "the newest session is unaffected");

      const activeCount = await Session.countDocuments({ user: user._id, revokedAt: null });
      assert.equal(activeCount, 10, "exactly MAX_SESSIONS_PER_USER sessions remain active");
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("session-limit enforcement counts only ACTIVE, unexpired sessions — pre-existing revoked/expired rows never count against the limit", async () => {
    const user = await createTestUser();
    try {
      // 5 already-revoked and 5 already-expired sessions — none of these
      // should ever be counted by pruneExcessSessions()'s own query filter
      // ({revokedAt: null, expiresAt: {$gt: new Date()}}).
      for (let i = 0; i < 5; i++) {
        const s = await createTestSession(user._id);
        await Session.updateOne({ tokenHash: await sha256Hex(s.rawToken) }, { $set: { revokedAt: new Date() } });
      }
      for (let i = 0; i < 5; i++) {
        const s = await createTestSession(user._id);
        await Session.updateOne({ tokenHash: await sha256Hex(s.rawToken) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
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

      const activeCount = await Session.countDocuments({ user: user._id, revokedAt: null, expiresAt: { $gt: new Date() } });
      assert.equal(activeCount, 10);
    } finally {
      await User.deleteOne({ _id: user._id });
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

      const finalActiveCount = await Session.countDocuments({ user: user._id, revokedAt: null, expiresAt: { $gt: new Date() } });
      assert.equal(finalActiveCount, 10, "once every concurrent create+prune has fully settled, the population converges to exactly the configured limit, regardless of the race");

      const totalCreated = await Session.countDocuments({ user: user._id });
      assert.equal(totalCreated, 15, "all 15 sessions were genuinely created — the limit revokes excess rows, it never silently drops/fails a concurrent createSession() call itself");
    } finally {
      await User.deleteOne({ _id: user._id });
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
        method: "POST",
        url: "http://test/api/coupons",
        session: sessionA,
        body: { code: `CROSSCSRF${Date.now()}`, discountType: "flat", discountValue: 10, expiresAt: new Date(Date.now() + 86400000) },
      });
      req.headers.set("x-csrf-token", sessionB.rawCsrfToken);
      const res = await couponsPOST(req);
      assert.equal(res.status, 403, "a real CSRF token from a different session must not authorize this one");
    } finally {
      await User.deleteOne({ _id: admin._id });
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
      await User.deleteOne({ _id: user._id });
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
      await User.deleteOne({ _id: user._id });
    }
  });
});

async function sha256Hex(raw) {
  const crypto = await import("node:crypto");
  return crypto.createHash("sha256").update(raw).digest("hex");
}
