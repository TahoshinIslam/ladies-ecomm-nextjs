// Phase 11, section C2 — static architecture checks for the password
// recovery pages (the two Phase 10 carryovers: /forgot-password linked
// from LoginPage but nonexistent, and the reset email linking to a
// nonexistent /reset-password/[token]). Same house style as
// tests/errorBoundaryArchitecture.test.mjs: source-text inspection with
// comments stripped, proving concrete invariants rather than opinions.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const abs = (...parts) => path.join(ROOT, ...parts);
const read = (relPath) => fs.readFileSync(abs(relPath), "utf8");
const exists = (relPath) => fs.existsSync(abs(relPath));

function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const ROUTE_FILES = [
  "app/(routes)/forgot-password/page.jsx",
  "app/(routes)/reset-password/[token]/page.jsx",
];
const VIEW_FILES = ["views/ForgotPasswordPage.jsx", "views/ResetPasswordPage.jsx"];

describe("Phase 11 — password recovery route files exist", () => {
  for (const rel of [...ROUTE_FILES, ...VIEW_FILES]) {
    test(`${rel} exists`, () => {
      assert.ok(exists(rel), `${rel} must exist`);
    });
  }
});

describe("Phase 11 — route wrappers are noindex,nofollow", () => {
  for (const rel of ROUTE_FILES) {
    test(`${rel} exports robots: { index: false, follow: false }`, () => {
      const content = read(rel);
      assert.match(content, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/, `${rel} must be noindex,nofollow`);
    });
  }
});

describe("Phase 11 — LoginPage.jsx's existing /forgot-password link now resolves", () => {
  test("LoginPage.jsx links to /forgot-password", () => {
    const content = read("views/LoginPage.jsx");
    assert.match(content, /href=["']\/forgot-password["']/, "LoginPage must still link to /forgot-password");
  });
});

describe("Phase 11 — ForgotPasswordPage.jsx enumeration-safety", () => {
  const content = stripComments(read("views/ForgotPasswordPage.jsx"));

  test("uses the existing useForgotPasswordMutation from store/userApi.js", () => {
    assert.match(content, /useForgotPasswordMutation/);
    assert.match(content, /from ["']\.\.\/store\/userApi\.js["']/);
  });

  test("shows the identical success state whether the mutation resolves or rejects", () => {
    const tryIndex = content.indexOf("try {");
    const finallyIndex = content.indexOf("finally");
    assert.ok(tryIndex !== -1 && finallyIndex !== -1, "onSubmit must use try/catch/finally");
    const finallyBlock = content.slice(finallyIndex, finallyIndex + 120);
    assert.match(finallyBlock, /setSubmitted\(true\)/, "success state must be set unconditionally in finally, not only in try");
  });

  test("does not branch rendering on the mutation's resolved value", () => {
    assert.ok(!/\.data\b/.test(content), "must not inspect mutation response body to decide UI state");
  });
});

describe("Phase 11 — ResetPasswordPage.jsx token handling", () => {
  const content = stripComments(read("views/ResetPasswordPage.jsx"));

  test("receives the token as a prop, not from browser storage", () => {
    assert.match(content, /function ResetPasswordPage\(\{\s*token\s*\}\)/, "token must arrive as a prop");
    assert.ok(!/localStorage/.test(content), "must never touch localStorage");
    assert.ok(!/sessionStorage/.test(content), "must never touch sessionStorage");
  });

  test("forwards the token directly to useResetPasswordMutation", () => {
    assert.match(content, /useResetPasswordMutation/);
    assert.match(content, /resetPassword\(\{\s*token,\s*password:\s*data\.password\s*\}\)/);
  });

  test("uses the shared PASSWORD_MIN_LENGTH constant from schemas/authSchemas.js, matching RegisterPage.jsx's pattern", () => {
    assert.match(content, /from ["']\.\.\/schemas\/authSchemas\.js["']/);
    assert.match(content, /PASSWORD_MIN_LENGTH/);
  });

  test("shows one shared generic invalid-link state regardless of failure reason (no branching on error type)", () => {
    const catchIndex = content.indexOf("} catch {");
    assert.ok(catchIndex !== -1, "must use a bare catch with no error-shape branching");
    const catchBlock = content.slice(catchIndex, catchIndex + 80);
    assert.match(catchBlock, /setInvalid\(true\)/);
  });

  test("links back to /forgot-password on an invalid/expired token, and to /login on success", () => {
    assert.match(content, /href=["']\/forgot-password["']/);
    assert.match(content, /router\.push\(["']\/login["']\)/);
  });
});

describe("Phase 11 — email verification is confirmed dormant, not a missing page", () => {
  test("no verification email/route/page exists (documented dormant feature, not a gap requiring a new page)", () => {
    assert.ok(!exists("app/(routes)/verify-email"));
    assert.ok(!exists("app/(routes)/verify-email/page.jsx"));
  });
});
