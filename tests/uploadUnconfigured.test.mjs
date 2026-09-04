// Phase 1: upload behavior when Cloudinary is unconfigured.
//
// Isolated into its own file because config/cloudinary.js's
// `cloudinaryConfigured` export is computed once, at module load time, and
// cannot be flipped mid-process — this file mocks it to `false` before
// anything imports the real module; tests/uploads.test.mjs mocks it to
// `true` in a separate process/file. Neither ever touches real Cloudinary
// credentials or makes a real network call — no CLOUDINARY_* env var is
// ever set in either file.

import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, signTestToken, createTestUser } from "./helpers/testDb.mjs";

let moduleMockUsable = false;
try {
  const probe = await mock.module("node:os", { namedExports: { hostname: () => "probe" } });
  probe.restore();
  moduleMockUsable = true;
} catch {
  moduleMockUsable = false;
}

if (moduleMockUsable) {
  await mock.module("../config/cloudinary.js", {
    namedExports: { cloudinaryConfigured: false },
    defaultExport: { uploader: {} }, // never reached — uploadService's own 503 short-circuit fires first
  });
}

const canRun = moduleMockUsable && dbReady && !!process.env.JWT_SECRET;
const reason = !moduleMockUsable
  ? "node:test module mocking unavailable — run with --experimental-test-module-mocks"
  : skipReason || (dbReady ? undefined : "JWT_SECRET not set");

describe("POST /api/upload — Cloudinary unconfigured (503, no credential/stack leakage)", { skip: !canRun && reason }, () => {
  let uploadPOST, User;

  before(async () => {
    await connectTestDb();
    ({ POST: uploadPOST } = await import("../app/api/upload/route.js"));
    ({ default: User } = await import("../models/userModel.js"));
  });

  after(async () => {
    mock.reset();
    await disconnectTestDb();
  });

  test("an admin's otherwise-valid upload fails with a safe 503, no credentials or paths leaked", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const fd = new FormData();
      fd.append("image", new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" }));
      const req = new Request("http://test/api/upload", {
        method: "POST",
        headers: { authorization: `Bearer ${signTestToken(admin._id)}` },
        body: fd,
      });
      const res = await uploadPOST(req);
      assert.equal(res.status, 503);
      const json = await res.json();
      assert.match(json.message, /not configured/i);
      // Safety: the message NAMES the missing env vars (by design, for an
      // admin's own troubleshooting — see services/uploadService.js:39-44)
      // but must never contain an actual secret VALUE, a stack trace, or a
      // filesystem path.
      assert.ok(!/[A-Za-z0-9+/]{20,}={0,2}/.test(json.message), "no base64-shaped secret-looking value in the response");
      assert.ok(!json.message.includes("/Users/"), "no filesystem path leaked");
      assert.ok(!("stack" in json), "no stack trace field in the response body");
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });
});
