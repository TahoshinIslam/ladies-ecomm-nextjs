// Phase 1: email HTML injection characterization.
//
// utlis/sendEmail.js's buildVerificationEmail()/buildPasswordResetEmail()
// interpolate `name` directly into a raw HTML template literal with no
// escaping (see utlis/sendEmail.js:41,53). This file proves that with real
// inputs and, for the userService.forgotPassword() path, with the actual
// (mocked) Nodemailer send call — not a guess about what "probably" happens.
//
// Per the Phase 1 prompt: no real email is sent, and no escaping is
// implemented here. These tests currently PASS because they assert the
// unescaped behavior exists. If escaping is added in a later phase, this
// file must be updated to assert the fixed behavior — a green run of this
// file is not evidence the app is safe; read the test names.
//
// Part A (buildVerificationEmail/buildPasswordResetEmail) needs no database
// and no mocking — they are pure functions. Part B exercises the real send
// path (services/userService.js's forgotPassword()) with Nodemailer's
// "nodemailer" module replaced via node:test's `mock.module`, which
// requires the process to be run with --experimental-test-module-mocks
// (already added to the "test" npm script — see package.json).

import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestUser } from "./helpers/testDb.mjs";

const MALICIOUS_NAMES = [
  { label: "script tag", value: '<script>alert("xss")</script>' },
  { label: "img onerror", value: '<img src=x onerror=alert(1)>' },
  { label: "double quote", value: 'Rah"eem' },
  { label: "ampersand", value: "Tom & Jerry's Boutique" },
  { label: "closing tag breakout", value: '</h2><h1>Injected Heading</h1>' },
];

// The "nodemailer" mock (see Part B below) MUST be registered before
// ANYTHING in this file ever imports utlis/sendEmail.js — that module
// calls the real `nodemailer.createTransport(...)` at its own top level
// (module load time, not per-send), so once it's been imported once with
// the real module, re-importing services/userService.js later (which
// re-uses the same cached utlis/sendEmail.js instance) can never retroactively
// pick up a mock. Part A's `before()` below imports utlis/sendEmail.js
// too (for the pure builder functions) — so this setup has to happen here,
// at module scope, before either describe block runs, not inside Part B's
// own before().
let moduleMockUsable = false;
let moduleMockProbeError;
try {
  const probe = await mock.module("node:os", { namedExports: { hostname: () => "probe" } });
  probe.restore();
  moduleMockUsable = true;
} catch (err) {
  moduleMockProbeError = err;
}

let sentMail;
if (moduleMockUsable) {
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
}

describe("Part A — buildVerificationEmail / buildPasswordResetEmail: no escaping (pure functions, no DB needed)", () => {
  let buildVerificationEmail, buildPasswordResetEmail;

  before(async () => {
    ({ buildVerificationEmail, buildPasswordResetEmail } = await import("../utlis/sendEmail.js"));
  });

  for (const { label, value } of MALICIOUS_NAMES) {
    test(`CHARACTERIZED: verification email HTML contains the raw, unescaped name (${label})`, () => {
      const { html } = buildVerificationEmail(value, "https://example.test/verify/abc");
      assert.ok(
        html.includes(value),
        `expected the unescaped input to appear verbatim in the HTML — it did not, which would mean escaping now exists and this test needs updating, not deleting`,
      );
    });

    test(`CHARACTERIZED: password-reset email HTML contains the raw, unescaped name (${label})`, () => {
      const { html } = buildPasswordResetEmail(value, "https://example.test/reset-password/abc");
      assert.ok(html.includes(value));
    });
  }

  test("the reset link itself is inserted as a raw href with no URL-encoding of special characters", () => {
    const trickyLink = 'https://example.test/reset-password/abc"><script>alert(1)</script>';
    const { html } = buildPasswordResetEmail("Normal Name", trickyLink);
    assert.ok(html.includes(trickyLink), "a link containing a quote/tag is inserted verbatim into the href attribute");
  });
});

// moduleMockUsable/moduleMockProbeError were established above, before
// Part A ran — see the comment there for why.
const canRunPartB = moduleMockUsable && dbReady;
const partBSkipReason = !moduleMockUsable
  ? `node:test module mocking unavailable (${moduleMockProbeError?.message || "unknown error"}) — run with --experimental-test-module-mocks`
  : skipReason;

describe("Part B — services/userService.js forgotPassword(): injection survives to the real (mocked) Nodemailer call", { skip: !canRunPartB && partBSkipReason }, () => {
  let User, forgotPassword;
  let user;

  before(async () => {
    await connectTestDb();

    ({ default: User } = await import("../models/userModel.js"));
    ({ forgotPassword } = await import("../services/userService.js"));

    user = await createTestUser({ role: "customer" });
    user.name = '<script>alert("stored-xss-via-email")</script>';
    await user.save();
  });

  after(async () => {
    mock.reset();
    await User.deleteOne({ _id: user._id });
    await disconnectTestDb();
  });

  test("forgotPassword() sends an email whose HTML contains the user's raw, unescaped name", async () => {
    await forgotPassword(user.email);
    assert.ok(sentMail, "sendMail should have been called");
    assert.ok(
      sentMail.html.includes(user.name),
      "CHARACTERIZED: the malicious name reached the actual email payload unescaped, via the real forgotPassword() code path",
    );
  });
});
