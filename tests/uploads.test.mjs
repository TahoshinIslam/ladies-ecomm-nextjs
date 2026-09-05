// Phase 5 rewrite — file upload validation is now signature-verified.
//
// services/uploadService.js and the real POST /api/upload,
// /api/upload/multiple Route Handlers, against a real replica-set MongoDB
// (for the admin/user fixtures) with Cloudinary fully mocked. NO real
// Cloudinary credentials are ever set, and no real network call to
// Cloudinary occurs anywhere in this file — see the mock.module calls
// below, registered before any route/service module is imported.
//
// Previously (Phase 1) this file characterized two known defects: a
// zero-byte file passed validation, and MIME-type validation trusted only
// the client-supplied Content-Type with no check of the file's actual
// bytes. Phase 5's lib/fileSignature.js fixes both — this file now asserts
// the CORRECTED behavior and adds real, non-placeholder image bytes (a
// zero-filled buffer is not a valid image of any format, so every fixture
// below that should succeed now carries a genuine magic number).
//
// tests/uploadUnconfigured.test.mjs covers the "Cloudinary not configured"
// 503 path separately (can't coexist with this file's "configured" mock in
// the same process — see that file's header).

import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestSession, sessionCookieHeader, createTestUser } from "./helpers/testDb.mjs";

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
// re-register the mock. `calls` records every real (mocked) Cloudinary
// invocation, so a test can assert Cloudinary was never reached for a
// rejected file.
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

const canRun = moduleMockUsable && dbReady;
const reason = !moduleMockUsable
  ? "node:test module mocking unavailable — run with --experimental-test-module-mocks"
  : skipReason;

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

  // Real magic numbers for each format this app accepts — a zero/one-
  // filled buffer (the old fixture) is not a valid image of ANY format,
  // so every "this should succeed" test needs a genuine signature now.
  function realImageBytes(format, totalSize = 1024) {
    const buf = new Uint8Array(totalSize).fill(0x2a); // arbitrary non-zero filler past the header
    if (format === "png") {
      buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    } else if (format === "jpeg") {
      buf.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46], 0);
    } else if (format === "webp") {
      buf.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
      buf.set([0x00, 0x00, 0x00, 0x00], 4); // size (unchecked by our detector)
      buf.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
    } else if (format === "avif") {
      buf.set([0x00, 0x00, 0x00, 0x1c], 0); // box size (unchecked)
      buf.set([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
      buf.set([0x61, 0x76, 0x69, 0x66], 8); // "avif" major brand
    }
    return buf;
  }

  function uploadRequest({ session, fileName = "photo.png", mimeType = "image/png", bytes = realImageBytes("png"), field = "image", noFile = false } = {}) {
    const fd = new FormData();
    if (!noFile) fd.append(field, new File([bytes], fileName, { type: mimeType }));
    const headers = {};
    const cookie = sessionCookieHeader(session);
    if (cookie) headers.cookie = cookie;
    if (session) headers["x-csrf-token"] = session.rawCsrfToken;
    // Origin validation (lib/csrf.js Layer 1) applies to this POST too.
    headers.origin = "http://test";
    return new Request("http://test/api/upload", { method: "POST", headers, body: fd });
  }

  test("unauthenticated request is rejected (401)", async () => {
    const res = await uploadPOST(uploadRequest({}));
    assert.equal(res.status, 401);
  });

  test("authenticated customer WITHOUT admin role is rejected (403)", async () => {
    const customer = await createTestUser({ role: "customer" });
    try {
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(customer._id) }));
      assert.equal(res.status, 403);
    } finally {
      await User.deleteOne({ _id: customer._id });
    }
  });

  test("a properly authorized admin succeeds (201) with the mocked Cloudinary URL, using a real PNG signature", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id) }));
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
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), noFile: true }));
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.match(json.message, /No file uploaded/i);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("FIXED: a zero-byte file is now rejected (400), not silently accepted", async () => {
    const admin = await createTestUser({ role: "admin" });
    const before = cloudinaryMockState.calls.length;
    try {
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), bytes: new Uint8Array(0) }));
      assert.equal(res.status, 400);
      assert.equal(cloudinaryMockState.calls.length, before, "Cloudinary must never be reached for a rejected file");
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("a valid allowed MIME type (image/webp) with a real WebP signature succeeds", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), mimeType: "image/webp", fileName: "photo.webp", bytes: realImageBytes("webp") }));
      assert.equal(res.status, 201);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("a valid JPEG signature with declared type image/jpeg succeeds", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), mimeType: "image/jpeg", fileName: "photo.jpg", bytes: realImageBytes("jpeg") }));
      assert.equal(res.status, 201);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("a valid AVIF signature with declared type image/avif succeeds", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), mimeType: "image/avif", fileName: "photo.avif", bytes: realImageBytes("avif") }));
      assert.equal(res.status, 201);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("an unsupported MIME type is rejected (415)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), mimeType: "application/pdf", fileName: "doc.pdf" }));
      assert.equal(res.status, 415);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("a file exceeding 5 MB is rejected (413)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), bytes: realImageBytes("png", 5 * 1024 * 1024 + 1) }));
      assert.equal(res.status, 413);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("a file at EXACTLY the 5 MB boundary is accepted — the check is strictly-greater-than, not greater-or-equal", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), bytes: realImageBytes("png", 5 * 1024 * 1024) }));
      assert.equal(res.status, 201, "services/uploadService.js: `file.size > MAX_BYTES` — exactly MAX_BYTES is not rejected");
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("multiple-file upload: several valid files succeed together", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const fd = new FormData();
      fd.append("images", new File([realImageBytes("png")], "a.png", { type: "image/png" }));
      fd.append("images", new File([realImageBytes("jpeg")], "b.jpg", { type: "image/jpeg" }));
      const session = await createTestSession(admin._id);
      const req = new Request("http://test/api/upload/multiple", {
        method: "POST",
        headers: { cookie: sessionCookieHeader(session), "x-csrf-token": session.rawCsrfToken, origin: "http://test" },
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
      for (let i = 0; i < 9; i++) fd.append("images", new File([realImageBytes("png")], `f${i}.png`, { type: "image/png" }));
      const session = await createTestSession(admin._id);
      const req = new Request("http://test/api/upload/multiple", {
        method: "POST",
        headers: { cookie: sessionCookieHeader(session), "x-csrf-token": session.rawCsrfToken, origin: "http://test" },
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
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id) }));
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
      const okRes = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id) }));
      const okJson = await okRes.json();
      assert.equal(okJson.success, true);

      const badRes = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), mimeType: "text/plain", fileName: "x.txt" }));
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
        uploadRequest({ session: await createTestSession(admin._id), fileName: '../../etc/passwd<script>alert(1)</script>.png' }),
      );
      // services/uploadService.js's validateAndBuffer() never reads or
      // validates `file.name` for path-traversal/HTML shape — only
      // `file.type`/`file.size`/the real signature. The original filename
      // is discarded entirely (Cloudinary generates its own public_id), so
      // there is no path-traversal or stored-XSS risk from the filename
      // specifically — confirmed here, not assumed. The bytes are still a
      // real PNG, so this succeeds purely on the filename being irrelevant.
      assert.equal(res.status, 201, "the filename itself is never inspected, so a hostile filename doesn't even reach a validation branch");
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("a filename with no extension at all is still validated purely by content, and succeeds", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), fileName: "no_extension_at_all" }));
      assert.equal(res.status, 201);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("an uppercase file extension (.PNG) does not affect validation, which never reads the extension", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), fileName: "PHOTO.PNG" }));
      assert.equal(res.status, 201);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("FIXED: MIME-type validation now verifies the actual file signature — a spoofed MIME type on plain-text bytes is rejected (415), and Cloudinary is never called", async () => {
    const admin = await createTestUser({ role: "admin" });
    const before = cloudinaryMockState.calls.length;
    try {
      const notReallyAnImage = new TextEncoder().encode("this is not image data at all");
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), bytes: notReallyAnImage, mimeType: "image/png" }));
      assert.equal(res.status, 415, "a spoofed declared MIME type on non-image bytes is now rejected by the real signature check");
      assert.equal(cloudinaryMockState.calls.length, before, "Cloudinary must never be reached for a rejected file");
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("FIXED: an HTML file renamed to .jpg with a spoofed image/jpeg Content-Type is rejected (415)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const before = cloudinaryMockState.calls.length;
    try {
      const html = new TextEncoder().encode("<html><body><script>alert(document.cookie)</script></body></html>");
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), bytes: html, mimeType: "image/jpeg", fileName: "photo.jpg" }));
      assert.equal(res.status, 415);
      assert.equal(cloudinaryMockState.calls.length, before);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("FIXED: a script file renamed to .png with a spoofed image/png Content-Type is rejected (415)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const before = cloudinaryMockState.calls.length;
    try {
      const script = new TextEncoder().encode("#!/bin/sh\nrm -rf /\n");
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), bytes: script, mimeType: "image/png", fileName: "photo.png" }));
      assert.equal(res.status, 415);
      assert.equal(cloudinaryMockState.calls.length, before);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("FIXED: an SVG file (XML text, no binary image signature) is rejected — it was never on the allowed-type list, and now also fails signature detection", async () => {
    const admin = await createTestUser({ role: "admin" });
    const before = cloudinaryMockState.calls.length;
    try {
      const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), bytes: svg, mimeType: "image/svg+xml", fileName: "photo.svg" }));
      assert.equal(res.status, 415, "image/svg+xml was never in ALLOWED_TYPES to begin with");
      assert.equal(cloudinaryMockState.calls.length, before);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("FIXED: a truncated PNG signature (fewer bytes than the real 8-byte magic number) is rejected (415)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const before = cloudinaryMockState.calls.length;
    try {
      const truncated = new Uint8Array([0x89, 0x50, 0x4e]); // only 3 of PNG's 8 magic bytes
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), bytes: truncated, mimeType: "image/png" }));
      assert.equal(res.status, 415);
      assert.equal(cloudinaryMockState.calls.length, before);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("FIXED: random bytes with a plausible-looking declared type are rejected (415)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const before = cloudinaryMockState.calls.length;
    try {
      const random = new Uint8Array(256);
      for (let i = 0; i < random.length; i++) random[i] = (i * 37 + 11) % 256;
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), bytes: random, mimeType: "image/png" }));
      assert.equal(res.status, 415);
      assert.equal(cloudinaryMockState.calls.length, before);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("FIXED: a real PNG's bytes declared as image/jpeg (signature/declared-type mismatch) is rejected (415)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const before = cloudinaryMockState.calls.length;
    try {
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), bytes: realImageBytes("png"), mimeType: "image/jpeg", fileName: "photo.jpg" }));
      assert.equal(res.status, 415, "a real image whose declared type doesn't match its actual signature must still be rejected");
      assert.equal(cloudinaryMockState.calls.length, before);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("declared image/jpg (non-standard alias) is treated as equivalent to image/jpeg for a real JPEG signature", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await uploadPOST(uploadRequest({ session: await createTestSession(admin._id), bytes: realImageBytes("jpeg"), mimeType: "image/jpg", fileName: "photo.jpg" }));
      assert.equal(res.status, 201);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });
});
