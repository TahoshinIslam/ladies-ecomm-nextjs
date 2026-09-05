// Phase 5 rewrite — password-reset link construction is now FIXED, and the
// existing-vs-nonexistent-account enumeration gap is closed.
//
// services/userService.js used to build the reset link as a plain string
// concatenation (`${process.env.CLIENT_URL || ""}/reset-password/${rawToken}`)
// with no URL validation, no trailing-slash normalization, no scheme check
// — and, separately, a failed send (including CLIENT_URL being unset, once
// it started throwing) surfaced as a 500 for an EXISTING account while a
// NONEXISTENT account always got a 200, making account existence trivially
// detectable from the response alone.
//
// Phase 5 replaces the string concatenation with lib/appUrl.js's
// buildAppUrl() (real URL construction, validated origin), and
// forgotPassword() now swallows every failure (missing/malformed
// CLIENT_URL, send failure) behind the SAME generic response used for a
// nonexistent account.

import { test, describe, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestUser } from "./helpers/testDb.mjs";

let moduleMockUsable = false;
let moduleMockProbeError;
try {
  const probe = await mock.module("node:os", { namedExports: { hostname: () => "probe" } });
  probe.restore();
  moduleMockUsable = true;
} catch (err) {
  moduleMockProbeError = err;
}

const canRun = moduleMockUsable && dbReady;
const reason = !moduleMockUsable
  ? `node:test module mocking unavailable (${moduleMockProbeError?.message || "unknown error"}) — run with --experimental-test-module-mocks`
  : skipReason;

describe("services/userService.js forgotPassword() — reset link construction and enumeration safety", { skip: !canRun && reason }, () => {
  let User, forgotPassword;
  let sentMail;
  const originalClientUrl = process.env.CLIENT_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  before(async () => {
    await connectTestDb();
    await mock.module("nodemailer", {
      defaultExport: {
        createTransport: () => ({
          sendMail: async (mail) => {
            sentMail = mail;
            return { messageId: "test-message-id" };
          },
        }),
      },
    });
    ({ default: User } = await import("../models/userModel.js"));
    ({ forgotPassword } = await import("../services/userService.js"));
  });

  after(async () => {
    mock.reset();
    await disconnectTestDb();
    if (originalClientUrl === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = originalClientUrl;
    process.env.NODE_ENV = originalNodeEnv;
  });

  afterEach(async () => {
    sentMail = undefined;
  });

  function extractLink(html) {
    const match = html.match(/href="([^"]*)"/);
    return match?.[1];
  }

  async function triggerReset(email) {
    return forgotPassword(email);
  }

  async function triggerResetAndGetLink() {
    const user = await createTestUser({ role: "customer" });
    try {
      await forgotPassword(user.email);
      return extractLink(sentMail.html);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  }

  test("valid HTTPS origin (no trailing slash): produces a correct absolute link", async () => {
    process.env.CLIENT_URL = "https://tahos.store";
    const link = await triggerResetAndGetLink();
    assert.match(link, /^https:\/\/tahos\.store\/reset-password\/[0-9a-f]{64}$/, "expected a well-formed absolute reset URL");
  });

  test("FIXED: valid origin WITH a trailing slash produces no double slash", async () => {
    process.env.CLIENT_URL = "https://tahos.store/";
    const link = await triggerResetAndGetLink();
    assert.match(link, /^https:\/\/tahos\.store\/reset-password\/[0-9a-f]{64}$/, "a trailing slash on CLIENT_URL must never produce '//reset-password'");
  });

  test("FIXED: an unexpected path/query/fragment configured into CLIENT_URL is discarded — only the origin is used", async () => {
    process.env.CLIENT_URL = "https://tahos.store/some/old/path?q=1#frag";
    const link = await triggerResetAndGetLink();
    assert.match(link, /^https:\/\/tahos\.store\/reset-password\/[0-9a-f]{64}$/);
  });

  test("localhost HTTP origin is allowed outside production (dev)", async () => {
    process.env.NODE_ENV = "test";
    process.env.CLIENT_URL = "http://localhost:3000";
    const link = await triggerResetAndGetLink();
    assert.match(link, /^http:\/\/localhost:3000\/reset-password\/[0-9a-f]{64}$/);
  });

  test("FIXED: a localhost origin in production is rejected (fails safe, no email sent, generic response still returned)", async () => {
    process.env.NODE_ENV = "production";
    process.env.CLIENT_URL = "http://localhost:3000";
    try {
      const user = await createTestUser({ role: "customer" });
      try {
        const res = await triggerReset(user.email);
        assert.deepEqual(res, { message: "If that email exists, a link has been sent." });
        assert.equal(sentMail, undefined, "no email may be sent when the origin is rejected");
      } finally {
        await User.deleteOne({ _id: user._id });
      }
    } finally {
      process.env.NODE_ENV = "test";
    }
  });

  for (const bad of [
    { label: "missing CLIENT_URL", value: undefined },
    { label: "malformed (not a URL at all)", value: "this-is-not-a-url" },
    { label: "javascript: scheme", value: "javascript:alert(1)" },
    { label: "data: scheme", value: "data:text/html,<script>alert(1)</script>" },
    { label: "credentials embedded in the URL", value: "https://user:pass@tahos.store" },
  ]) {
    test(`FIXED: ${bad.label} fails safe — no email sent, and the PUBLIC response is unchanged`, async () => {
      if (bad.value === undefined) delete process.env.CLIENT_URL;
      else process.env.CLIENT_URL = bad.value;

      const user = await createTestUser({ role: "customer" });
      try {
        const res = await triggerReset(user.email);
        assert.deepEqual(res, { message: "If that email exists, a link has been sent." }, "the public response must be identical to the happy path");
        assert.equal(sentMail, undefined, "no email may be sent when the origin is invalid");
      } finally {
        await User.deleteOne({ _id: user._id });
      }
    });
  }

  test("FIXED: the token is placed as a single, real URL path segment (safe under encoding) — not string-concatenated", async () => {
    process.env.CLIENT_URL = "https://tahos.store";
    const link = await triggerResetAndGetLink();
    const url = new URL(link);
    assert.equal(url.pathname.split("/").filter(Boolean).length, 2, "exactly two path segments: reset-password/<token>");
    assert.match(url.pathname, /^\/reset-password\/[0-9a-f]{64}$/);
  });

  test("ENUMERATION SAFETY: an existing account and a nonexistent account produce byte-identical public responses under a valid config", async () => {
    process.env.CLIENT_URL = "https://tahos.store";
    const user = await createTestUser({ role: "customer" });
    try {
      const existingRes = await triggerReset(user.email);
      const nonexistentRes = await triggerReset("definitely-not-registered-anywhere@example.invalid");
      assert.deepEqual(existingRes, nonexistentRes);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("ENUMERATION SAFETY: an existing account and a nonexistent account produce byte-identical public responses even when CLIENT_URL is broken (previously a 500-vs-200 oracle)", async () => {
    delete process.env.CLIENT_URL;
    const user = await createTestUser({ role: "customer" });
    try {
      const existingRes = await triggerReset(user.email);
      const nonexistentRes = await triggerReset("also-not-registered@example.invalid");
      assert.deepEqual(existingRes, nonexistentRes, "a broken CLIENT_URL must not distinguish real accounts from fake ones via a thrown error");
      assert.equal(sentMail, undefined);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });
});
