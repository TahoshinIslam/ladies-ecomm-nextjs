// Phase 2: authentication lifecycle — opaque, server-side session cookies,
// replacing the Phase 1 bearer-JWT baseline this file used to test.
//
// Traced directly from services/authService.js (register/login),
// lib/auth.js (getSessionUser/requireUser/requirePermission), lib/session.js
// (create/validate/revoke), and models/userModel.js (lockout fields/methods).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  createTestSession,
  sessionCookieHeader,
  requestAs,
  createTestUser,
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("Authentication lifecycle (session-cookie system)", { skip: !canRun && reason }, () => {
  let registerPOST, loginPOST, mePOST_GET, couponsGET;
  let User, Session;

  before(async () => {
    await connectTestDb();
    ({ POST: registerPOST } = await import("../app/api/users/register/route.js"));
    ({ POST: loginPOST } = await import("../app/api/users/login/route.js"));
    ({ GET: mePOST_GET } = await import("../app/api/users/me/route.js"));
    ({ GET: couponsGET } = await import("../app/api/coupons/route.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Session } = await import("../models/sessionModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  function sessionCookieFromResponse(res) {
    // NextResponse can carry multiple Set-Cookie headers; getSetCookie()
    // (standard Fetch API on Headers) returns them all individually —
    // res.headers.get("set-cookie") would incorrectly join them with a comma.
    return res.headers.getSetCookie().find((c) => c.startsWith("tahos_session="));
  }

  // ===================== Registration & login =====================

  test("successful registration sets a session cookie, no token in the response body", async () => {
    const email = `authtest-${Date.now()}@example.invalid`;
    const req = requestAs({
      method: "POST",
      url: "http://test/api/users/register",
      body: { name: "Auth Test User", email, password: "CorrectHorse123!" },
    });
    const res = await registerPOST(req);
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.token, undefined, "no raw session token in the JSON body");
    assert.equal(json.rawToken, undefined);
    assert.equal(json.user.email, email);
    assert.equal(json.user.password, undefined, "password must never appear in the response");
    assert.ok(sessionCookieFromResponse(res), "Set-Cookie: tahos_session=... must be present");
    await User.deleteOne({ email });
  });

  test("successful login sets a session cookie, no token in the response body", async () => {
    const user = await createTestUser({ role: "customer" });
    try {
      // createTestUser sets the raw password "TestPassword123!" before the
      // pre-save hash hook runs — see tests/helpers/testDb.mjs.
      const req = requestAs({ method: "POST", url: "http://test/api/users/login", body: { email: user.email, password: "TestPassword123!" } });
      const res = await loginPOST(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.token, undefined);
      assert.equal(json.user.email, user.email);
      assert.ok(sessionCookieFromResponse(res));

      // The database stores only the hash — never the raw cookie value.
      const setCookie = sessionCookieFromResponse(res);
      const rawValue = setCookie.split(";")[0].split("=")[1];
      // tokenHash is select:false by default (models/sessionModel.js) — a
      // normal find() without this explicit opt-in confirms the field-level
      // protection itself, tested separately in tests/session.test.mjs;
      // here we opt in specifically to verify the STORED VALUE is a hash.
      const stored = await Session.findOne({ user: user._id }).select("+tokenHash");
      assert.notEqual(stored.tokenHash, rawValue, "the stored value must be a hash, not the raw token itself");
      assert.equal(stored.tokenHash.length, 64, "SHA-256 hex digest is 64 characters");
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("incorrect password is rejected with a generic message (401), no cookie set", async () => {
    const user = await createTestUser({ role: "customer" });
    try {
      const req = requestAs({ method: "POST", url: "http://test/api/users/login", body: { email: user.email, password: "WrongPassword!" } });
      const res = await loginPOST(req);
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.message, "Invalid credentials");
      assert.equal(sessionCookieFromResponse(res), undefined);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("nonexistent user gets the SAME generic 401 message as a wrong password (no account-existence leak)", async () => {
    const req = requestAs({
      method: "POST",
      url: "http://test/api/users/login",
      body: { email: `nobody-${Date.now()}@example.invalid`, password: "whatever123" },
    });
    const res = await loginPOST(req);
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.message, "Invalid credentials", "must be indistinguishable from the wrong-password case");
  });

  // ===================== Account lockout (unchanged by the session migration) =====================

  test("5 failed attempts locks the account; the 6th attempt is rejected with 423 even with the CORRECT password", async () => {
    const user = await createTestUser({ role: "customer" });
    try {
      for (let i = 0; i < 5; i++) {
        const req = requestAs({ method: "POST", url: "http://test/api/users/login", body: { email: user.email, password: "wrong" } });
        const res = await loginPOST(req);
        assert.equal(res.status, 401, `attempt ${i + 1} should still be a plain 401`);
      }

      const lockedCheck = await User.findById(user._id).select("+lockUntil");
      assert.ok(lockedCheck.lockUntil && lockedCheck.lockUntil > Date.now(), "account should be locked after 5 failed attempts");

      const correctReq = requestAs({ method: "POST", url: "http://test/api/users/login", body: { email: user.email, password: "TestPassword123!" } });
      const res = await loginPOST(correctReq);
      assert.equal(res.status, 423, "a locked account rejects even the correct password");
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("successful login resets the failed-attempt counter", async () => {
    const user = await createTestUser({ role: "customer" });
    try {
      for (let i = 0; i < 3; i++) {
        const req = requestAs({ method: "POST", url: "http://test/api/users/login", body: { email: user.email, password: "wrong" } });
        await loginPOST(req);
      }
      const midway = await User.findById(user._id).select("+loginAttempts");
      assert.equal(midway.loginAttempts, 3);

      const goodReq = requestAs({ method: "POST", url: "http://test/api/users/login", body: { email: user.email, password: "TestPassword123!" } });
      const res = await loginPOST(goodReq);
      assert.equal(res.status, 200);

      const after_ = await User.findById(user._id).select("+loginAttempts +lockUntil");
      assert.equal(after_.loginAttempts, 0, "a successful login must reset loginAttempts to 0");
      assert.equal(after_.lockUntil, undefined);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  // ===================== Session cookie validation =====================
  // Cookie-attribute assertions (HttpOnly/Secure/SameSite/__Host-/etc.) and
  // the full CSRF matrix live in tests/session.test.mjs — this section
  // covers the authentication OUTCOME (401 vs 200) for each session state.

  test("missing session cookie is rejected (401) on a protected route", async () => {
    const req = requestAs({ method: "GET", url: "http://test/api/users/me" });
    const res = await mePOST_GET(req);
    assert.equal(res.status, 401);
  });

  test("malformed/garbage session cookie value is rejected (401) — no bearer-header fallback exists", async () => {
    const req = new Request("http://test/api/users/me", { headers: { cookie: "tahos_session=not-a-real-session-token-at-all" } });
    const res = await mePOST_GET(req);
    assert.equal(res.status, 401);

    // Confirms there is no bearer-header fallback: an Authorization header
    // alone, with no cookie, must also be rejected.
    const bearerOnlyReq = new Request("http://test/api/users/me", { headers: { authorization: "Bearer some-old-jwt-shaped-string" } });
    const bearerRes = await mePOST_GET(bearerOnlyReq);
    assert.equal(bearerRes.status, 401, "confirmed: Authorization headers are never read anymore");
  });

  test("expired session is rejected (401)", async () => {
    const user = await createTestUser({ role: "customer" });
    try {
      const session = await createTestSession(user._id);
      // Force the stored session into the past directly — lib/session.js's
      // validateSessionToken() must catch this itself, not rely on the TTL
      // index's own background sweep (which runs on its own ~60s cycle).
      const crypto = await import("node:crypto");
      const tokenHash = crypto.createHash("sha256").update(session.rawToken).digest("hex");
      await Session.updateOne({ tokenHash }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

      const req = requestAs({ method: "GET", url: "http://test/api/users/me", session });
      const res = await mePOST_GET(req);
      assert.equal(res.status, 401);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("revoked session is rejected (401)", async () => {
    const user = await createTestUser({ role: "customer" });
    try {
      const { revokeSessionByToken } = await import("../lib/session.js");
      const session = await createTestSession(user._id);
      await revokeSessionByToken(session.rawToken);

      const req = requestAs({ method: "GET", url: "http://test/api/users/me", session });
      const res = await mePOST_GET(req);
      assert.equal(res.status, 401);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("a session for a user that no longer exists is rejected (401) — no server-side session to fall back on", async () => {
    const user = await createTestUser({ role: "customer" });
    const session = await createTestSession(user._id);
    await User.deleteOne({ _id: user._id }); // delete AFTER creating the session — the session record itself is still otherwise valid
    const req = requestAs({ method: "GET", url: "http://test/api/users/me", session });
    const res = await mePOST_GET(req);
    assert.equal(res.status, 401, "lib/session.js's validateSessionToken() returns null when the referenced user no longer exists, even for an otherwise well-formed, unexpired, unrevoked session");
  });

  // ===================== Authorization on a permission-gated route =====================
  // Using GET /api/coupons (requirePermission(COUPONS_MANAGE)) as the
  // representative admin/staff-gated endpoint.

  test("admin permission enforcement: an admin (bypasses granular permissions entirely) can access a permission-gated route", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const req = requestAs({ method: "GET", url: "http://test/api/coupons", session: await createTestSession(admin._id) });
      const res = await couponsGET(req);
      assert.equal(res.status, 200);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("staff permission enforcement: an employee WITH coupons.manage succeeds, WITHOUT it is rejected (403)", async () => {
    const withPerm = await createTestUser({ role: "employee", permissions: ["coupons.manage"] });
    const withoutPerm = await createTestUser({ role: "employee", permissions: [] });
    try {
      const okReq = requestAs({ method: "GET", url: "http://test/api/coupons", session: await createTestSession(withPerm._id) });
      assert.equal((await couponsGET(okReq)).status, 200);

      const forbiddenReq = requestAs({ method: "GET", url: "http://test/api/coupons", session: await createTestSession(withoutPerm._id) });
      assert.equal((await couponsGET(forbiddenReq)).status, 403);
    } finally {
      await User.deleteMany({ _id: { $in: [withPerm._id, withoutPerm._id] } });
    }
  });

  test("a normal customer is rejected (403) from a permission-gated admin endpoint, regardless of the permission checked", async () => {
    const customer = await createTestUser({ role: "customer" });
    try {
      const req = requestAs({ method: "GET", url: "http://test/api/coupons", session: await createTestSession(customer._id) });
      const res = await couponsGET(req);
      assert.equal(res.status, 403);
    } finally {
      await User.deleteOne({ _id: customer._id });
    }
  });
});
