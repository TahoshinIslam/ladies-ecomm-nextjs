// Phase 1: password-reset link construction under different CLIENT_URL values.
//
// services/userService.js:62 builds the reset link as a plain string
// concatenation: `${process.env.CLIENT_URL || ""}/reset-password/${rawToken}`
// — no URL validation, no trailing-slash normalization, no scheme check.
// This file proves the exact resulting string for each CLIENT_URL shape
// named in the Phase 1 prompt, via the real forgotPassword() code path with
// Nodemailer mocked (no real email sent, no environment behavior changed —
// process.env.CLIENT_URL is set/restored per test, in-process only).

import { test, describe, before, after, beforeEach, afterEach, mock } from "node:test";
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

describe("services/userService.js forgotPassword() — reset link vs. CLIENT_URL shape", { skip: !canRun && reason }, () => {
  let User, forgotPassword;
  let sentMail;
  const originalClientUrl = process.env.CLIENT_URL;

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
  });

  afterEach(async () => {
    sentMail = undefined;
  });

  function extractLink(html) {
    const match = html.match(/href="([^"]*)"/);
    return match?.[1];
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

  test("CLIENT_URL valid (no trailing slash): produces a correct absolute link", async () => {
    process.env.CLIENT_URL = "https://tahos.store";
    const link = await triggerResetAndGetLink();
    assert.match(link, /^https:\/\/tahos\.store\/reset-password\/[0-9a-f]{64}$/, "expected a well-formed absolute reset URL");
  });

  test("CLIENT_URL missing: DOCUMENTED BROKEN LINK — produces a bare relative path with no scheme/host", async () => {
    delete process.env.CLIENT_URL;
    const link = await triggerResetAndGetLink();
    assert.match(link, /^\/reset-password\/[0-9a-f]{64}$/, "with CLIENT_URL unset, the link has no host at all");
    assert.ok(
      !link.startsWith("http"),
      "CONFIRMED: this is not a clickable absolute URL — most email clients will not render a bare relative path as a link",
    );
  });

  test("CLIENT_URL malformed (not a URL at all): concatenated verbatim, no validation", async () => {
    process.env.CLIENT_URL = "this-is-not-a-url";
    const link = await triggerResetAndGetLink();
    assert.match(link, /^this-is-not-a-url\/reset-password\/[0-9a-f]{64}$/, "CONFIRMED: no validation rejects or corrects a malformed CLIENT_URL — it is used as-is");
  });

  test("CLIENT_URL with a trailing slash: produces a double-slash in the link (no normalization)", async () => {
    process.env.CLIENT_URL = "https://tahos.store/";
    const link = await triggerResetAndGetLink();
    assert.match(
      link,
      /^https:\/\/tahos\.store\/\/reset-password\/[0-9a-f]{64}$/,
      "CONFIRMED: a trailing slash on CLIENT_URL is not stripped, producing '//reset-password/...' — most servers/browsers will still resolve this correctly, but it is untested, unintentional behavior, not a designed one",
    );
  });
});
