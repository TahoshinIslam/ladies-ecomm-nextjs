// Phase 5 rewrite — email HTML injection is now FIXED.
//
// utlis/sendEmail.js's buildPasswordResetEmail() used to interpolate `name`
// directly into a raw HTML template literal with no escaping (the Phase 1
// characterization this file used to assert as a known defect). Phase 5
// adds lib/htmlEscape.js's escapeHtml() at both interpolation sites (name
// and link both escaped). This file now asserts the CORRECTED behavior: a
// malicious name must never appear unescaped in the generated HTML.
// (buildVerificationEmail() was removed in Phase 6 along with the rest of
// the unwired email-verification feature — this file no longer references it.)
//
// Part A (buildPasswordResetEmail) needs no database and no mocking — it
// is a pure function. Part B exercises the real send
// path (services/userService.js's forgotPassword()) with Nodemailer's
// "nodemailer" module replaced via node:test's `mock.module`, which
// requires the process to be run with --experimental-test-module-mocks
// (already added to the "test" npm script — see package.json).

import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestUser } from "./helpers/testDb.mjs";
import { escapeHtml } from "../lib/htmlEscape.js";

const MALICIOUS_NAMES = [
  { label: "script tag", value: '<script>alert("xss")</script>' },
  { label: "img onerror", value: "<img src=x onerror=alert(1)>" },
  { label: "double quote", value: 'Rah"eem' },
  { label: "ampersand", value: "Tom & Jerry's Boutique" },
  { label: "closing tag breakout", value: "</h2><h1>Injected Heading</h1>" },
  { label: "onclick handler text", value: 'Name" onclick="alert(1)' },
  { label: "unicode name", value: "Björk Guðmundsdóttir" },
  { label: "ordinary apostrophe", value: "O'Brien" },
  { label: "encoded-looking string", value: "%3Cscript%3Ealert(1)%3C/script%3E" },
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

describe("Part A — buildPasswordResetEmail: names and links are HTML-escaped", () => {
  let buildPasswordResetEmail;

  before(async () => {
    ({ buildPasswordResetEmail } = await import("../utlis/sendEmail.js"));
  });

  for (const { label, value } of MALICIOUS_NAMES) {
    test(`FIXED: password-reset email HTML never contains the raw name verbatim, only its escaped form (${label})`, () => {
      const { html } = buildPasswordResetEmail(value, "https://example.test/reset-password/abc");
      assert.equal(html.includes(escapeHtml(value)), true);
      if (/[&<>"']/.test(value)) {
        assert.equal(html.includes(value), false);
      }
      assert.ok(!/<script/i.test(html));
    });

    test(`the plain-text alternative remains readable — it contains the ORIGINAL, unescaped name (no HTML entities in plain text) (${label})`, () => {
      const { text } = buildPasswordResetEmail(value, "https://example.test/reset-password/abc");
      assert.ok(text.includes(value), "plain text has no markup context, so no escaping is needed or wanted there");
      assert.ok(!text.includes("&amp;") || value.includes("&amp;"), "plain text must not show HTML entities for ordinary values");
    });
  }

  test("an ordinary name with no special characters is rendered completely unchanged (no double-escaping of normal values)", () => {
    const { html } = buildPasswordResetEmail("Fatima Rahman", "https://example.test/reset-password/abc");
    assert.ok(html.includes("Fatima Rahman"));
  });

  test("FIXED: the reset link itself is HTML-escaped too — a tricky link cannot break out of the href attribute", () => {
    const trickyLink = 'https://example.test/reset-password/abc"><script>alert(1)</script>';
    const { html } = buildPasswordResetEmail("Normal Name", trickyLink);
    assert.equal(html.includes(trickyLink), false, "the raw tricky link must not appear verbatim");
    assert.ok(!/<script/i.test(html));
  });

  test("a normal, real reset link (no special characters) renders identically to before", () => {
    const normalLink = "https://example.test/reset-password/abcdef0123456789";
    const { html } = buildPasswordResetEmail("Normal Name", normalLink);
    assert.ok(html.includes(`href="${normalLink}"`));
  });
});

// moduleMockUsable/moduleMockProbeError were established above, before
// Part A ran — see the comment there for why.
const canRunPartB = moduleMockUsable && dbReady;
const partBSkipReason = !moduleMockUsable
  ? `node:test module mocking unavailable (${moduleMockProbeError?.message || "unknown error"}) — run with --experimental-test-module-mocks`
  : skipReason;

describe("Part B — services/userService.js forgotPassword(): injection is escaped by the time it reaches the real (mocked) Nodemailer call", { skip: !canRunPartB && partBSkipReason }, () => {
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

  test("FIXED: forgotPassword() sends an email whose HTML does NOT contain the user's raw, unescaped name", async () => {
    await forgotPassword(user.email);
    assert.ok(sentMail, "sendMail should have been called");
    assert.equal(sentMail.html.includes(user.name), false, "the raw malicious name must never reach the real email payload");
    assert.ok(!/<script/i.test(sentMail.html), "no <script> tag may reach the real email payload");
  });
});
