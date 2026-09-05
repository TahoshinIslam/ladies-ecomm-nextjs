// Phase 6 — a regression guard against the confirmed-dead architecture this
// phase removed ever quietly returning: the unreachable Express-era
// middleware/controller layer, the dead Redis/cache/logger facade, the
// unsupported non-COD payment gateway surface (including the bare 501
// `/api/payments` stub), and the unwired email-verification feature.
//
// This is a static, filesystem/text-based check (no server, no database) —
// it asserts concrete architectural invariants (a path does not exist, a
// production file does not import a given module) rather than wording, so
// it won't fail on harmless comment rephrasing.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const abs = (...parts) => path.join(ROOT, ...parts);
const exists = (relPath) => fs.existsSync(abs(relPath));

function findFiles(dir, { exclude = ["node_modules", ".next", ".git"] } = {}) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(full, { exclude }));
    } else if (/\.(js|jsx|mjs)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

const PRODUCTION_DIRS = ["app", "components", "context", "hooks", "lib", "models", "schemas", "services", "store", "utlis", "views"].map((d) =>
  abs(d),
);
const productionFiles = PRODUCTION_DIRS.flatMap((d) => findFiles(d));

describe("Phase 6 — dead Express-era cluster stays deleted", () => {
  test("app/middleware/ (the Express middleware layer) does not exist", () => {
    assert.equal(exists("app/middleware"), false);
  });

  test("controllers/ (the Express controller layer) does not exist", () => {
    assert.equal(exists("controllers"), false);
  });

  test("config/redis.js and utlis/cache.js (the dead Redis/cache facade) do not exist", () => {
    assert.equal(exists("config/redis.js"), false);
    assert.equal(exists("utlis/cache.js"), false);
  });

  test("utlis/logger.js (the unused pino-based logger facade) does not exist", () => {
    assert.equal(exists("utlis/logger.js"), false);
  });

  test("no production file imports the deleted middleware/controller/redis/cache/logger paths", () => {
    const forbiddenImportPatterns = [
      /from ["']\.{1,2}\/(\.{2}\/)*middleware\//,
      /from ["']\.{1,2}\/(\.{2}\/)*controllers\//,
      /from ["']\.{1,2}\/(\.{2}\/)*config\/redis\.js["']/,
      /from ["']\.{1,2}\/(\.{2}\/)*utlis\/cache\.js["']/,
      /from ["']\.{1,2}\/(\.{2}\/)*utlis\/logger\.js["']/,
    ];
    const offenders = [];
    for (const file of productionFiles) {
      const content = fs.readFileSync(file, "utf8");
      if (forbiddenImportPatterns.some((re) => re.test(content))) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    assert.deepEqual(offenders, []);
  });
});

describe("Phase 6 — COD-only enforcement stays in place", () => {
  test("the bare 501 `/api/payments` stub route does not exist (only cod/ and order/ subroutes remain)", () => {
    assert.equal(exists("app/api/payments/route.js"), false);
    assert.equal(exists("app/api/payments/cod/[orderId]/route.js"), true, "live COD payment route must remain");
    assert.equal(exists("app/api/payments/order/[orderId]/route.js"), true, "live order-payment lookup route must remain");
  });

  test("services/paymentService.js remains and exports no non-COD gateway functions", () => {
    assert.equal(exists("services/paymentService.js"), true);
    const content = fs.readFileSync(abs("services/paymentService.js"), "utf8");
    assert.match(content, /export async function codCreate/);
    assert.match(content, /export async function getPaymentByOrder/);
    for (const gatewayFn of ["stripeCreate", "bkashCreate", "bkashExecute", "nagadCreate", "nagadComplete", "nagadVerifyPayment"]) {
      assert.ok(!content.includes(gatewayFn), `services/paymentService.js must not export a "${gatewayFn}" gateway function`);
    }
  });

  test("store/shopApi.js no longer defines unsupported gateway mutations, and exports no corresponding hooks", () => {
    const content = fs.readFileSync(abs("store/shopApi.js"), "utf8");
    for (const name of ["stripeCheckout", "bkashCreate", "bkashExecute", "nagadCreate"]) {
      assert.ok(!content.includes(`${name}:`), `store/shopApi.js must not define a "${name}" endpoint`);
    }
    for (const hook of ["useStripeCheckoutMutation", "useBkashCreateMutation", "useBkashExecuteMutation", "useNagadCreateMutation"]) {
      assert.ok(!content.includes(hook), `store/shopApi.js must not export "${hook}"`);
    }
    // The live COD/order-payment endpoints must remain.
    assert.match(content, /codCreate:\s*b\.mutation/);
    assert.match(content, /getPaymentByOrder:\s*b\.query/);
    assert.ok(content.includes("useCodCreateMutation"));
    assert.ok(content.includes("useGetPaymentByOrderQuery"));
  });

  test("no production file imports a removed gateway mutation hook", () => {
    const forbidden = ["useStripeCheckoutMutation", "useBkashCreateMutation", "useBkashExecuteMutation", "useNagadCreateMutation"];
    const offenders = [];
    for (const file of productionFiles) {
      const content = fs.readFileSync(file, "utf8");
      if (forbidden.some((name) => content.includes(name))) offenders.push(path.relative(ROOT, file));
    }
    assert.deepEqual(offenders, []);
  });

  test("models/paymentModel.js's method enum is COD-only, not pre-declaring unimplemented gateways", () => {
    const content = fs.readFileSync(abs("models/paymentModel.js"), "utf8");
    assert.match(content, /enum:\s*\["cod"\]/);
  });
});

describe("Phase 6 — the unwired email-verification feature stays removed", () => {
  test("GET /api/users/verify-email/[token] route does not exist", () => {
    assert.equal(exists("app/api/users/verify-email"), false);
  });

  test("services/userService.js no longer exports verifyEmail()", () => {
    const content = fs.readFileSync(abs("services/userService.js"), "utf8");
    assert.ok(!content.includes("export async function verifyEmail"));
  });

  test("models/userModel.js no longer has a verificationToken field", () => {
    const content = fs.readFileSync(abs("models/userModel.js"), "utf8");
    assert.ok(!content.includes("verificationToken"));
  });

  test("utlis/sendEmail.js no longer exports buildVerificationEmail()", () => {
    const content = fs.readFileSync(abs("utlis/sendEmail.js"), "utf8");
    assert.ok(!content.includes("buildVerificationEmail"));
    // The live password-reset builder must remain.
    assert.match(content, /export const buildPasswordResetEmail/);
  });

  test("store/userApi.js no longer exports a verifyEmail endpoint/hook", () => {
    const content = fs.readFileSync(abs("store/userApi.js"), "utf8");
    assert.ok(!/verifyEmail:\s*b\.query/.test(content));
    assert.ok(!content.includes("useVerifyEmailQuery"));
  });

  test("no production file references the deleted verify-email route or hook", () => {
    const forbidden = ["verify-email", "useVerifyEmailQuery", "buildVerificationEmail"];
    const offenders = [];
    for (const file of productionFiles) {
      const content = fs.readFileSync(file, "utf8");
      if (forbidden.some((name) => content.includes(name))) offenders.push(path.relative(ROOT, file));
    }
    assert.deepEqual(offenders, []);
  });
});

describe("Phase 6 — live architecture this phase must NOT touch remains intact", () => {
  test("proxy.js (the live Next.js proxy/middleware, not the dead Express layer) remains", () => {
    assert.equal(exists("proxy.js"), true);
  });

  test("the live MongoDB-backed rate limiter (lib/rateLimit.js + its model) remains", () => {
    assert.equal(exists("lib/rateLimit.js"), true);
    assert.equal(exists("models/rateLimitModel.js"), true);
  });

  test("live Cloudinary upload services remain", () => {
    assert.equal(exists("config/cloudinary.js"), true);
    assert.equal(exists("utlis/cloudinaryUpload.js"), true);
  });

  test("forgot-password / reset-password remain fully wired", () => {
    assert.equal(exists("app/api/users/forgot-password/route.js"), true);
    assert.equal(exists("app/api/users/reset-password/[token]/route.js"), true);
    const content = fs.readFileSync(abs("services/userService.js"), "utf8");
    assert.match(content, /export async function forgotPassword/);
    assert.match(content, /export async function resetPassword/);
  });
});
