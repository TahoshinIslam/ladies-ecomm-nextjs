// Confirmed audit finding (72/100 whole-project audit + independent
// migration-focused audit, reconciled): models/userModel.js's rowToUser()
// puts `password` (the bcrypt hash) and `resetPasswordToken` (the SHA-256
// hash of an active password-reset token) on every user object as plain
// enumerable fields. services/userService.js's listUsers()/getUserById()/
// updateUser() previously returned that object straight into
// NextResponse.json() with no sanitization — unlike the self-service paths
// (register/login/getMe/updateMe), which already only ever return a
// hand-picked safe shape. Fixed via userService.js's toAdminSafeUser()
// allowlist. This test proves the fix at the real HTTP-route level (not
// just a unit check of the allowlist function) so a future change to any
// of these three routes can't silently regress past it.

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
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

// Every key that must NEVER appear anywhere in an admin-facing user
// response — checked recursively so a future refactor that nests the user
// object differently still gets caught.
const FORBIDDEN_KEYS = ["password", "resetPasswordToken", "resetPasswordExpires"];

function assertNoForbiddenKeys(value, path = "") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenKeys(item, `${path}[${i}]`));
    return;
  }
  for (const [key, val] of Object.entries(value)) {
    assert.ok(
      !FORBIDDEN_KEYS.includes(key),
      `Found forbidden key "${key}" at "${path}.${key}" in admin API response — must never expose password/reset-token fields`,
    );
    assertNoForbiddenKeys(val, `${path}.${key}`);
  }
}

describe("Admin user endpoints never expose password/reset-token fields", { skip: !canRun && reason }, () => {
  let listRoute, detailRoute;
  let admin, adminSession, target;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    listRoute = await import("../app/api/users/route.js");
    detailRoute = await import("../app/api/users/[id]/route.js");

    admin = await createTestUser({ role: "admin" });
    adminSession = await createTestSession(admin._id);
    target = await createTestUser({ role: "customer" });

    // Give the target user an active password-reset token, exactly the
    // sensitive state this fix must never leak.
    const { default: User } = await import("../models/userModel.js");
    const targetDoc = await User.findById(target._id);
    targetDoc.resetPasswordToken = "deadbeef".repeat(8); // fixture hash, never a real one
    targetDoc.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await targetDoc.save();
  });

  after(async () => {
    await disconnectTestDb();
  });

  test("GET /api/users (admin list) response contains no password/reset-token fields", async () => {
    const req = requestAs({ method: "GET", url: "http://localhost/api/users", session: adminSession });
    const res = await listRoute.GET(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(Array.isArray(json.users) && json.users.length >= 2);
    assertNoForbiddenKeys(json, "body");
    // Sanity check: the fixture reset-token hash value itself never appears
    // anywhere in the serialized response, not just under its usual key.
    assert.ok(!JSON.stringify(json).includes("deadbeef"), "reset-token hash value leaked under some other key");
  });

  test("GET /api/users/[id] (admin detail) response contains no password/reset-token fields", async () => {
    const req = requestAs({ method: "GET", url: `http://localhost/api/users/${target._id}`, session: adminSession });
    const res = await detailRoute.GET(req, { params: Promise.resolve({ id: String(target._id) }) });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.user._id, String(target._id));
    assertNoForbiddenKeys(json, "body");
    assert.ok(!JSON.stringify(json).includes("deadbeef"));
  });

  test("PUT /api/users/[id] (admin update) response contains no password/reset-token fields", async () => {
    const req = requestAs({
      method: "PUT",
      url: `http://localhost/api/users/${target._id}`,
      session: adminSession,
      body: { name: "Updated Name" },
    });
    const res = await detailRoute.PUT(req, { params: Promise.resolve({ id: String(target._id) }) });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.user.name, "Updated Name");
    assertNoForbiddenKeys(json, "body");
    assert.ok(!JSON.stringify(json).includes("deadbeef"));
  });

  test("admin detail response still carries the legitimately-needed admin fields", async () => {
    // The fix must not overcorrect into stripping fields admins genuinely
    // need (role, permissions, verification/lock state, phone, timestamps).
    const req = requestAs({ method: "GET", url: `http://localhost/api/users/${target._id}`, session: adminSession });
    const res = await detailRoute.GET(req, { params: Promise.resolve({ id: String(target._id) }) });
    const json = await res.json();
    for (const field of ["_id", "name", "email", "role", "permissions", "isVerified", "createdAt"]) {
      assert.ok(field in json.user, `expected admin-safe user shape to still include "${field}"`);
    }
  });
});
