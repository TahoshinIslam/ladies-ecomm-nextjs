// Phase 11, section F — unit tests for scripts/validateProductionEnv.mjs's
// pure `validateProductionEnv()` function against synthetic env fixtures.
// Never touches the real process.env, never connects to anything.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";

import { validateProductionEnv } from "../scripts/validateProductionEnv.mjs";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const VALID_ENV = {
  MONGO_URI: "mongodb+srv://user:pass@cluster0.mongodb.net/tahos_prod",
  APP_ORIGIN: "https://tahos.store",
  CLIENT_URL: "https://tahos.store",
  CLOUDINARY_CLOUD_NAME: "tahos-real-cloud",
  CLOUDINARY_API_KEY: "123456789012345678901234",
  CLOUDINARY_API_SECRET: "zK9mQpLwVr72TnHs04ByXeUdCf381Gjq",
  SMTP_HOST: "smtp.sendgrid.net",
  SMTP_PORT: "587",
  SMTP_USER: "apikey",
  SMTP_PASS: "SG.abcdefghijklmnopqrstuvwxyz1234567890ABCD",
};

describe("validateProductionEnv — happy path", () => {
  test("a fully valid synthetic production env produces zero problems", () => {
    assert.deepEqual(validateProductionEnv(VALID_ENV), []);
  });
});

describe("validateProductionEnv — missing variables", () => {
  for (const name of Object.keys(VALID_ENV)) {
    test(`reports ${name} when it is missing`, () => {
      const env = { ...VALID_ENV };
      delete env[name];
      const problems = validateProductionEnv(env);
      assert.ok(problems.some((p) => p.startsWith(`${name}:`)), `expected a problem for missing ${name}`);
    });
  }
});

describe("validateProductionEnv — rejects localhost/placeholder/example values", () => {
  test("rejects a localhost MONGO_URI", () => {
    const env = { ...VALID_ENV, MONGO_URI: "mongodb://127.0.0.1:27017/tahos" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => p.startsWith("MONGO_URI:")));
  });

  test("rejects an http:// (non-TLS) APP_ORIGIN", () => {
    const env = { ...VALID_ENV, APP_ORIGIN: "http://tahos.store" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => p.startsWith("APP_ORIGIN:")));
  });

  test("rejects an example.com CLIENT_URL", () => {
    const env = { ...VALID_ENV, CLIENT_URL: "https://example.com" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => p.startsWith("CLIENT_URL:")));
  });

  test("rejects a weak/short SMTP_PASS", () => {
    const env = { ...VALID_ENV, SMTP_PASS: "1234" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => p.startsWith("SMTP_PASS:")));
  });

  test("rejects a non-transaction-capable plain mongodb:// URI (no replicaSet=)", () => {
    const env = { ...VALID_ENV, MONGO_URI: "mongodb://real-prod-host.internal:27017/tahos_prod" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => p.startsWith("MONGO_URI:") && /transaction-capable/.test(p)));
  });

  test("accepts a plain mongodb:// URI that explicitly names replicaSet=", () => {
    const env = { ...VALID_ENV, MONGO_URI: "mongodb://real-prod-host.internal:27017/tahos_prod?replicaSet=rs0" };
    assert.deepEqual(validateProductionEnv(env), []);
  });
});

describe("validateProductionEnv — CLOUDINARY_API_KEY is a non-secret identifier, not a strength-checked secret", () => {
  test("a realistic synthetic 15-digit Cloudinary API key passes (previously wrongly failed the >=16-char secret heuristic)", () => {
    const env = { ...VALID_ENV, CLOUDINARY_API_KEY: "123456789012345" };
    assert.deepEqual(validateProductionEnv(env), []);
  });

  test("rejects an empty CLOUDINARY_API_KEY", () => {
    const env = { ...VALID_ENV, CLOUDINARY_API_KEY: "" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => p.startsWith("CLOUDINARY_API_KEY:")));
  });

  test("rejects a whitespace-only CLOUDINARY_API_KEY", () => {
    const env = { ...VALID_ENV, CLOUDINARY_API_KEY: "   " };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => p.startsWith("CLOUDINARY_API_KEY:")));
  });

  test("rejects a placeholder-shaped CLOUDINARY_API_KEY", () => {
    const env = { ...VALID_ENV, CLOUDINARY_API_KEY: "changeme" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => p.startsWith("CLOUDINARY_API_KEY:")));
  });

  test("a weak/short CLOUDINARY_API_SECRET is still rejected (the real secret keeps strong validation)", () => {
    const env = { ...VALID_ENV, CLOUDINARY_API_SECRET: "short" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => p.startsWith("CLOUDINARY_API_SECRET:")));
  });

  test("every reported problem is a field-name + reason string only, never the offending value", () => {
    const secretSentinel = "zqx9f2"; // short (triggers looksWeak) and not an English word, so it can't coincidentally appear in a reason string
    const env = { ...VALID_ENV, CLOUDINARY_API_KEY: "changeme", CLOUDINARY_API_SECRET: secretSentinel, SMTP_PASS: secretSentinel };
    const problems = validateProductionEnv(env);
    assert.ok(problems.length >= 3, "expected all three fixtures to actually fail, or this test proves nothing");
    for (const p of problems) {
      assert.doesNotMatch(p, new RegExp(secretSentinel), "problem string must never echo back the actual submitted value");
    }
  });
});

describe("validateProductionEnv — cross-variable checks", () => {
  test("rejects MONGO_URI equal to MONGO_URI_TEST", () => {
    const env = { ...VALID_ENV, MONGO_URI_TEST: VALID_ENV.MONGO_URI };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => /MONGO_URI_TEST/.test(p)));
  });

  test("rejects APP_ORIGIN/CLIENT_URL disagreement", () => {
    const env = { ...VALID_ENV, CLIENT_URL: "https://www.tahos.store" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => /APP_ORIGIN and CLIENT_URL/.test(p)));
  });
});

describe("Phase 11 — validate:production npm script and .env.example wiring", () => {
  test("package.json defines a validate:production script pointing at the validator", () => {
    assert.equal(pkg.scripts["validate:production"], "node scripts/validateProductionEnv.mjs");
  });

  test("an ordinary `npm run build` never requires real production secrets (the validator is not wired into the build script)", () => {
    assert.ok(!/validateProductionEnv/.test(pkg.scripts.build), "build script must not call the production env validator");
  });

  test(".env.example documents every SMTP variable read by utlis/sendEmail.js", () => {
    const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    for (const name of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "FROM_NAME", "FROM_EMAIL"]) {
      assert.match(envExample, new RegExp(`^${name}=`, "m"), `.env.example must document ${name}`);
    }
  });
});
