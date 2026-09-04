// Phase 1: authentication lifecycle — the CURRENT bearer-token system only.
// No migration to cookie-based auth happens here or is implied by these
// tests passing; they exist to lock in today's behavior as a regression
// baseline before any future auth work touches it.
//
// Traced directly from services/authService.js (register/login),
// lib/auth.js (getSessionUser/requireUser/requirePermission),
// lib/http.js (JWT error → HTTP status mapping), and
// models/userModel.js (lockout fields/methods) — see the Phase 0B/0
// investigation for the file:line citations behind each assertion below.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  signTestToken,
  requestAs,
  createTestUser,
} from "./helpers/testDb.mjs";

const canRun = dbReady && !!process.env.JWT_SECRET;
const reason = skipReason || (canRun ? undefined : "JWT_SECRET not set in the test environment");

describe("Authentication lifecycle (bearer-token system, unchanged)", { skip: !canRun && reason }, () => {
  let registerPOST, loginPOST, mePOST_GET, couponsGET;
  let User;

  before(async () => {
    await connectTestDb();
    ({ POST: registerPOST } = await import("../app/api/users/register/route.js"));
    ({ POST: loginPOST } = await import("../app/api/users/login/route.js"));
    ({ GET: mePOST_GET } = await import("../app/api/users/me/route.js"));
    ({ GET: couponsGET } = await import("../app/api/coupons/route.js"));
    ({ default: User } = await import("../models/userModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  // ===================== Registration & login =====================

  test("successful registration returns a token and a public (password-free) user object", async () => {
    const email = `authtest-${Date.now()}@example.invalid`;
    const req = requestAs({
      method: "POST",
      url: "http://test/api/users/register",
      body: { name: "Auth Test User", email, password: "CorrectHorse123!" },
    });
    const res = await registerPOST(req);
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.ok(json.token);
    assert.equal(json.user.email, email);
    assert.equal(json.user.password, undefined, "password must never appear in the response");
    await User.deleteOne({ email });
  });

  test("successful login returns a token", async () => {
    const user = await createTestUser({ role: "customer" });
    try {
      // createTestUser sets the raw password "TestPassword123!" before the
      // pre-save hash hook runs — see tests/helpers/testDb.mjs.
      const req = requestAs({ method: "POST", url: "http://test/api/users/login", body: { email: user.email, password: "TestPassword123!" } });
      const res = await loginPOST(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(json.token);
      assert.equal(json.user.email, user.email);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("incorrect password is rejected with a generic message (401)", async () => {
    const user = await createTestUser({ role: "customer" });
    try {
      const req = requestAs({ method: "POST", url: "http://test/api/users/login", body: { email: user.email, password: "WrongPassword!" } });
      const res = await loginPOST(req);
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.message, "Invalid credentials");
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

  // ===================== Account lockout =====================

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

  // ===================== Token validation =====================

  test("missing token is rejected (401) on a protected route", async () => {
    const req = requestAs({ method: "GET", url: "http://test/api/users/me" });
    const res = await mePOST_GET(req);
    assert.equal(res.status, 401);
  });

  test("malformed token is rejected (401), mapped from JsonWebTokenError", async () => {
    const req = requestAs({ method: "GET", url: "http://test/api/users/me", token: "not-a-real-jwt-at-all" });
    const res = await mePOST_GET(req);
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.equal(json.message, "Invalid token");
  });

  test("expired token is rejected (401), mapped from TokenExpiredError with a distinct message", async () => {
    const user = await createTestUser({ role: "customer" });
    try {
      const expiredToken = jwt.sign({ id: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: -10 });
      const req = requestAs({ method: "GET", url: "http://test/api/users/me", token: expiredToken });
      const res = await mePOST_GET(req);
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.message, "Session expired, please log in again");
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("a token signed for a user that no longer exists is rejected (401) — no server-side session to fall back on", async () => {
    const user = await createTestUser({ role: "customer" });
    const token = signTestToken(user._id);
    await User.deleteOne({ _id: user._id }); // delete AFTER signing — the token itself is still validly signed
    const req = requestAs({ method: "GET", url: "http://test/api/users/me", token });
    const res = await mePOST_GET(req);
    assert.equal(res.status, 401, "lib/auth.js's userFromToken() returns null when User.findById() finds nothing, even for a well-formed, unexpired, correctly-signed token");
  });

  // ===================== Authorization on a permission-gated route =====================
  // Using GET /api/coupons (requirePermission(COUPONS_MANAGE)) as the
  // representative admin/staff-gated endpoint.

  test("admin permission enforcement: an admin (bypasses granular permissions entirely) can access a permission-gated route", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const req = requestAs({ method: "GET", url: "http://test/api/coupons", token: signTestToken(admin._id) });
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
      const okReq = requestAs({ method: "GET", url: "http://test/api/coupons", token: signTestToken(withPerm._id) });
      assert.equal((await couponsGET(okReq)).status, 200);

      const forbiddenReq = requestAs({ method: "GET", url: "http://test/api/coupons", token: signTestToken(withoutPerm._id) });
      assert.equal((await couponsGET(forbiddenReq)).status, 403);
    } finally {
      await User.deleteMany({ _id: { $in: [withPerm._id, withoutPerm._id] } });
    }
  });

  test("a normal customer is rejected (403) from a permission-gated admin endpoint, regardless of the permission checked", async () => {
    const customer = await createTestUser({ role: "customer" });
    try {
      const req = requestAs({ method: "GET", url: "http://test/api/coupons", token: signTestToken(customer._id) });
      const res = await couponsGET(req);
      assert.equal(res.status, 403);
    } finally {
      await User.deleteOne({ _id: customer._id });
    }
  });
});
