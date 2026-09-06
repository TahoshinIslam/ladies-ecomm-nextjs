// Phase 5C — actual client-form adoption of shared schema primitives.
//
// This goes beyond tests/clientSchemaImportability.test.mjs's "the files
// are importable" check: it proves a REAL client form module
// (views/RegisterPage.jsx, views/ProfilePage.jsx) actually imports the
// shared numeric/enum boundary values from schemas/*.js, that those values
// equal the ones the real server schema enforces, and that a concrete
// boundary password (7 chars — previously accepted by the client's
// hand-copied `min(6)`, always rejected by the server's real min:8)
// is now rejected on BOTH sides identically — proving the bug this
// adoption fixed (a password could pass client-side validation and still
// be rejected server-side with a generic error) cannot recur.
//
// These view files are React Client Components (import "react",
// "next/navigation", react-hook-form, etc., none of which this Node test
// process has) — this file does NOT render them (no jsdom is installed).
// Instead it reads each view's source text to confirm the real import
// exists and extracts the literal boundary value used, then verifies that
// value against the REAL, live server schema constant, and separately
// proves the shared constant flows correctly into a real zod schema
// (structurally identical to what the view module builds) via `parse()`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { z } from "zod";

import { PASSWORD_MIN_LENGTH, registerSchema, updateMeSchema } from "../schemas/authSchemas.js";
import { ADDRESS_LABELS, createAddressSchema } from "../schemas/addressSchemas.js";
import { DISCOUNT_TYPES, createCouponSchema } from "../schemas/couponSchemas.js";
import { AGE_GROUP_VALUES_LIST, AVAILABILITY_VALUES } from "../schemas/catalogSchemas.js";

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("Phase 5C — real client forms actually import shared schema primitives", () => {
  test("views/RegisterPage.jsx imports PASSWORD_MIN_LENGTH from schemas/authSchemas.js (not a hand-copied number)", () => {
    const source = read("views/RegisterPage.jsx");
    assert.match(source, /import\s*\{[^}]*PASSWORD_MIN_LENGTH[^}]*\}\s*from\s*["']\.\.\/schemas\/authSchemas\.js["']/);
    assert.match(source, /\.min\(PASSWORD_MIN_LENGTH/, "the registration password field must validate against the imported constant, not a literal");
    assert.ok(!/password:\s*z\.string\(\)\.min\(6/.test(source), "the old hand-copied, server-mismatched min(6) must be gone");
  });

  test("views/ProfilePage.jsx imports PASSWORD_MIN_LENGTH and ADDRESS_LABELS from schemas/*.js", () => {
    const source = read("views/ProfilePage.jsx");
    assert.match(source, /import\s*\{\s*PASSWORD_MIN_LENGTH\s*\}\s*from\s*["']\.\.\/schemas\/authSchemas\.js["']/);
    assert.match(source, /import\s*\{\s*ADDRESS_LABELS\s*\}\s*from\s*["']\.\.\/schemas\/addressSchemas\.js["']/);
    assert.match(source, /newPassword:\s*z\.string\(\)\.min\(PASSWORD_MIN_LENGTH/);
    assert.match(source, /z\.enum\(ADDRESS_LABELS\)/);
    assert.ok(!/newPassword:\s*z\.string\(\)\.min\(6/.test(source), "the old hand-copied, server-mismatched min(6) must be gone");
  });

  test("views/CheckoutPage.jsx imports ADDRESS_LABELS from schemas/addressSchemas.js", () => {
    const source = read("views/CheckoutPage.jsx");
    assert.match(source, /import\s*\{\s*ADDRESS_LABELS\s*\}\s*from\s*["']\.\.\/schemas\/addressSchemas\.js["']/);
    assert.match(source, /z\.enum\(ADDRESS_LABELS\)/);
  });
});

describe("Phase 5C — client and server accept/reject the SAME boundary password values", () => {
  // A structural stand-in for what views/RegisterPage.jsx's useMemo builds
  // — same shape, same imported constant, different (plain, untranslated)
  // messages, which is exactly the composition pattern the closure prompt
  // asks for: "map schema issue paths to translated UI messages" rather
  // than duplicating the boundary number.
  const clientLikeRegisterSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(PASSWORD_MIN_LENGTH),
  });

  test("a 7-character password (below the real server minimum) is rejected by BOTH the client-shaped schema and the real server schema", () => {
    const candidate = { name: "Test User", email: "test@example.invalid", password: "Short1!" }; // 7 chars
    assert.equal(candidate.password.length, 7);

    const clientResult = clientLikeRegisterSchema.safeParse(candidate);
    assert.equal(clientResult.success, false, "the client-shaped schema must reject a 7-char password");

    const serverResult = registerSchema.safeParse(candidate);
    assert.equal(serverResult.success, false, "the real server registerSchema must also reject it");
  });

  test("an 8-character password (exactly the shared minimum) is accepted by both", () => {
    const candidate = { name: "Test User", email: "test@example.invalid", password: "Exactly8" };
    assert.equal(candidate.password.length, 8);

    assert.equal(clientLikeRegisterSchema.safeParse(candidate).success, true);
    assert.equal(registerSchema.safeParse(candidate).success, true);
  });

  test("PASSWORD_MIN_LENGTH is a real, positive, finite number the real updateMeSchema also uses for newPassword", () => {
    assert.equal(typeof PASSWORD_MIN_LENGTH, "number");
    assert.ok(PASSWORD_MIN_LENGTH >= 8);
    const tooShort = updateMeSchema.safeParse({ newPassword: "x".repeat(PASSWORD_MIN_LENGTH - 1) });
    assert.equal(tooShort.success, false);
    const longEnough = updateMeSchema.safeParse({ newPassword: "x".repeat(PASSWORD_MIN_LENGTH) });
    assert.equal(longEnough.success, true);
  });
});

describe("Phase 5C — client and server accept/reject the SAME address label values", () => {
  test("ADDRESS_LABELS matches exactly what the real createAddressSchema accepts", () => {
    for (const label of ADDRESS_LABELS) {
      const result = createAddressSchema.safeParse({
        fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "x", label,
      });
      assert.equal(result.success, true, `label "${label}" must be accepted by the real server schema`);
    }
    const bogus = createAddressSchema.safeParse({
      fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "x", label: "not-a-real-label",
    });
    assert.equal(bogus.success, false);
  });
});

describe("Phase 5D — real client forms actually import the remaining shared enums", () => {
  test("views/admin/CouponsPage.jsx imports DISCOUNT_TYPES from schemas/couponSchemas.js (not a hand-copied enum)", () => {
    const source = read("views/admin/CouponsPage.jsx");
    assert.match(source, /import\s*\{\s*DISCOUNT_TYPES\s*\}\s*from\s*["']\.\.\/\.\.\/schemas\/couponSchemas\.js["']/);
    assert.match(source, /discountType:\s*z\.enum\(DISCOUNT_TYPES\)/);
    assert.ok(!/discountType:\s*z\.enum\(\["percentage",\s*"flat"\]\)/.test(source), "the old hand-copied enum literal must be gone");
  });

  test("views/admin/ProductsPage.jsx imports AGE_GROUP_VALUES_LIST and AVAILABILITY_VALUES from schemas/catalogSchemas.js", () => {
    const source = read("views/admin/ProductsPage.jsx");
    assert.match(source, /import\s*\{\s*AGE_GROUP_VALUES_LIST,\s*AVAILABILITY_VALUES\s*\}\s*from\s*["']\.\.\/\.\.\/schemas\/catalogSchemas\.js["']/);
    assert.match(source, /ageGroup:\s*z\.enum\(AGE_GROUP_VALUES_LIST\)/);
    assert.match(source, /availability:\s*z\.enum\(AVAILABILITY_VALUES\)/);
  });

  test("DISCOUNT_TYPES matches exactly what the real createCouponSchema accepts", () => {
    for (const discountType of DISCOUNT_TYPES) {
      const result = createCouponSchema.safeParse({
        code: "TEST10", discountType, discountValue: 5, expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      assert.equal(result.success, true, `discountType "${discountType}" must be accepted by the real server schema`);
    }
    const bogus = createCouponSchema.safeParse({
      code: "TEST10", discountType: "not-a-real-type", discountValue: 5, expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    assert.equal(bogus.success, false);
  });
});
