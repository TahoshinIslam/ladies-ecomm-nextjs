// Phase 1: file upload — services/uploadService.js and the real
// POST /api/upload, /api/upload/multiple Route Handlers, against a real
// replica-set MongoDB (for the admin/user fixtures) with Cloudinary fully
// mocked. NO real Cloudinary credentials are ever set, and no real network
// call to Cloudinary occurs anywhere in this file — see the mock.module
// calls below, registered before any route/service module is imported.
//
// tests/uploadUnconfigured.test.mjs covers the "Cloudinary not configured"
// 503 path separately (can't coexist with this file's "configured" mock in
// the same process — see that file's header).

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

// Controllable per-test via this mutable object — read fresh on every call,
// so individual tests can flip `shouldReject` without needing to
// re-register the mock.
const cloudinaryMockState = { shouldReject: false, calls: [] };

if (moduleMockUsable) {
  await mock.module("../config/cloudinary.js", {
    namedExports: { cloudinaryConfigured: true },
    defaultExport: { uploader: {} }, // never actually called — utlis/cloudinaryUpload.js is mocked directly below
  });

  await mock.module("../utlis/cloudinaryUpload.js", {
    namedExports: {
      uploadBuffer: async (buffer, folder) => {
        cloudinaryMockState.calls.push({ size: buffer.length, folder });
        if (cloudinaryMockState.shouldReject) {
          const err = new Error("Simulated Cloudinary failure");
          err.http_code = 500;
          throw err;
        }
        return {
          secure_url: "https://res.cloudinary.com/mock/image/upload/mock-id.png",
          public_id: "mock-id",
          width: 100,
          height: 100,
        };
      },
      deleteImage: async () => ({ result: "ok" }),
    },
  });
}

const canRun = moduleMockUsable && dbReady && !!process.env.JWT_SECRET;
const reason = !moduleMockUsable
  ? "node:test module mocking unavailable — run with --experimental-test-module-mocks"
  : skipReason || (dbReady ? undefined : "JWT_SECRET not set");

describe("Upload: POST /api/upload, POST /api/upload/multiple (Cloudinary mocked)", { skip: !canRun && reason }, () => {
  let uploadPOST, uploadMultiplePOST, User;

  before(async () => {
    await connectTestDb();
    ({ POST: uploadPOST } = await import("../app/api/upload/route.js"));
    ({ POST: uploadMultiplePOST } = await import("../app/api/upload/multiple/route.js"));
    ({ default: User } = await import("../models/userModel.js"));
  });

  after(async () => {
    mock.reset();
    await disconnectTestDb();
  });

  const png = (bytes = 1024) => new Uint8Array(bytes).fill(1);

  function uploadRequest({ token, fileName = "photo.png", mimeType = "image/png", bytes = png(), field = "image", noFile = false } = {}) {
    const fd = new FormData();
    if (!noFile) fd.append(field, new File([bytes], fileName, { type: mimeType }));
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    return new Request("http://test/api/upload", { method: "POST", headers, body: fd });
  }

  test("unauthenticated request is rejected (401)", async () => {
    const res = await uploadPOST(uploadRequest({}));
    assert.equal(res.status, 401);
  });

  test("authenticated customer WITHOUT admin role is rejected (403)", async () => {
    const customer = await createTestUser({ role: "customer" });
    try {
      const res = await uploadPOST(uploadRequest({ token: signTestToken(customer._id) }));
      assert.equal(res.status, 403);
    } finally {
      await User.deleteOne({ _id: customer._id });
    }
  });

  test("a properly authorized admin succeeds (201) with the mocked Cloudinary URL", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ token: signTestToken(admin._id) }));
      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.url, "https://res.cloudinary.com/mock/image/upload/mock-id.png");
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("missing file is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ token: signTestToken(admin._id), noFile: true }));
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.match(json.message, /No file uploaded/i);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("DOCUMENTED LIMITATION: a zero-byte file passes validation (no minimum-size check exists)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ token: signTestToken(admin._id), bytes: new Uint8Array(0) }));
      assert.equal(
        res.status,
        201,
        "confirmed: services/uploadService.js's validateAndBuffer() only checks `file.size > MAX_BYTES` — there is no lower bound, so an empty file is accepted and 'uploaded'",
      );
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("a valid allowed MIME type (image/webp) succeeds", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ token: signTestToken(admin._id), mimeType: "image/webp", fileName: "photo.webp" }));
      assert.equal(res.status, 201);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("an unsupported MIME type is rejected (415)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ token: signTestToken(admin._id), mimeType: "application/pdf", fileName: "doc.pdf" }));
      assert.equal(res.status, 415);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("a file exceeding 5 MB is rejected (413)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ token: signTestToken(admin._id), bytes: png(5 * 1024 * 1024 + 1) }));
      assert.equal(res.status, 413);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("a file at EXACTLY the 5 MB boundary is accepted — the check is strictly-greater-than, not greater-or-equal", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ token: signTestToken(admin._id), bytes: png(5 * 1024 * 1024) }));
      assert.equal(res.status, 201, "services/uploadService.js: `file.size > MAX_BYTES` — exactly MAX_BYTES is not rejected");
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("multiple-file upload: several valid files succeed together", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const fd = new FormData();
      fd.append("images", new File([png()], "a.png", { type: "image/png" }));
      fd.append("images", new File([png()], "b.jpg", { type: "image/jpeg" }));
      const req = new Request("http://test/api/upload/multiple", {
        method: "POST",
        headers: { authorization: `Bearer ${signTestToken(admin._id)}` },
        body: fd,
      });
      const res = await uploadMultiplePOST(req);
      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.files.length, 2);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("multiple-file upload: more than 8 files is rejected (400) — services/uploadService.js's uploadMany() hard limit", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const fd = new FormData();
      for (let i = 0; i < 9; i++) fd.append("images", new File([png()], `f${i}.png`, { type: "image/png" }));
      const req = new Request("http://test/api/upload/multiple", {
        method: "POST",
        headers: { authorization: `Bearer ${signTestToken(admin._id)}` },
        body: fd,
      });
      const res = await uploadMultiplePOST(req);
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("mocked Cloudinary REJECTION: a gateway failure surfaces as a safe 502, not a 500 or a leaked stack", async () => {
    const admin = await createTestUser({ role: "admin" });
    cloudinaryMockState.shouldReject = true;
    try {
      const res = await uploadPOST(uploadRequest({ token: signTestToken(admin._id) }));
      assert.equal(res.status, 502, "services/uploadService.js's formatCloudinaryError() maps an unrecognized gateway error to 502");
      const json = await res.json();
      assert.match(json.message, /Cloudinary upload failed/i);
      assert.ok(!("stack" in json));
    } finally {
      cloudinaryMockState.shouldReject = false;
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("safe generic error response contract: no stack trace, no filesystem path, consistent JSON shape on both success and failure", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const okRes = await uploadPOST(uploadRequest({ token: signTestToken(admin._id) }));
      const okJson = await okRes.json();
      assert.equal(okJson.success, true);

      const badRes = await uploadPOST(uploadRequest({ token: signTestToken(admin._id), mimeType: "text/plain", fileName: "x.txt" }));
      const badJson = await badRes.json();
      assert.equal(badJson.success, false);
      assert.ok(!("stack" in badJson));
      assert.ok(!badJson.message.includes("/Users/") && !badJson.message.includes("/app/"), "no filesystem path in the error message");
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("a filename containing HTML/path-traversal-shaped characters is accepted as-is by validation (no filename sanitization at this layer)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(
        uploadRequest({ token: signTestToken(admin._id), fileName: '../../etc/passwd<script>alert(1)</script>.png' }),
      );
      // services/uploadService.js's validateAndBuffer() never reads or
      // validates `file.name` at all — only `file.type` and `file.size`.
      // The original filename is discarded entirely (Cloudinary generates
      // its own public_id), so there is no path-traversal or stored-XSS
      // risk from the filename specifically — but this is worth confirming
      // by direct observation, not assumption.
      assert.equal(res.status, 201, "the filename itself is never inspected, so a hostile filename doesn't even reach a validation branch");
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("DOCUMENTED LIMITATION: MIME-type validation trusts the browser-supplied Content-Type only — no file-signature (magic-byte) check exists", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      // A file whose actual bytes are plain text, but whose declared MIME
      // type is image/png. services/uploadService.js's validateAndBuffer()
      // checks only `file.type` (the client-supplied Content-Type on the
      // FormData part) against ALLOWED_TYPES — it never inspects the
      // buffer's actual magic bytes/signature.
      const notReallyAnImage = new TextEncoder().encode("this is not image data at all");
      const res = await uploadPOST(uploadRequest({ token: signTestToken(admin._id), bytes: notReallyAnImage, mimeType: "image/png" }));
      assert.equal(
        res.status,
        201,
        "CONFIRMED LIMITATION: a spoofed MIME type on non-image bytes is accepted — the app trusts the declared Content-Type, not the actual file content. Real Cloudinary would likely reject this upstream, but that safety net is external to this codebase, not enforced by it.",
      );
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });
});
