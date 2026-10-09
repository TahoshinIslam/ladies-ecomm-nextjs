// Phase 11, section F — unit tests for scripts/validateProductionEnv.mjs's
// pure `validateProductionEnv()` function against synthetic env fixtures.
// Never touches the real process.env, never connects to anything.
//
// Rewritten for the Mongo -> MySQL migration: scripts/validateProductionEnv.mjs
// now validates DB_HOST/DB_PORT/DB_NAME/DB_USER (a real production MySQL
// deployment) in place of the old MONGO_URI shape/transaction-capability
// checks, and its cross-check now guards against DB_NAME ending in
// "_test"/"_ci" instead of MONGO_URI === MONGO_URI_TEST.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";

import { validateProductionEnv } from "../scripts/validateProductionEnv.mjs";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const VALID_ENV = {
  DB_HOST: "db.internal.tahos.store",
  DB_PORT: "3306",
  DB_NAME: "ladies_multi_ecomm",
  DB_USER: "tahos_app",
  APP_ORIGIN: "https://tahos.store",
  CLIENT_URL: "https://tahos.store",
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
  test("rejects a localhost DB_HOST", () => {
    const env = { ...VALID_ENV, DB_HOST: "127.0.0.1" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => p.startsWith("DB_HOST:")));
  });

  test("rejects a non-numeric DB_PORT", () => {
    const env = { ...VALID_ENV, DB_PORT: "not-a-port" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => p.startsWith("DB_PORT:")));
  });

  test("rejects a DB_NAME with characters outside letters/digits/underscore", () => {
    const env = { ...VALID_ENV, DB_NAME: "ladies multi-ecomm!" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => p.startsWith("DB_NAME:")));
  });

  test("rejects a placeholder DB_USER", () => {
    const env = { ...VALID_ENV, DB_USER: "changeme" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => p.startsWith("DB_USER:")));
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
});

describe("validateProductionEnv — uploads live in the database, so no image-host credentials are required", () => {
  test("a production environment without any Cloudinary variable is valid, and none is checked", () => {
    const problems = validateProductionEnv(VALID_ENV);
    assert.deepEqual(problems.filter((p) => /CLOUDINARY/.test(p)), []);
    assert.ok(!Object.keys(VALID_ENV).some((k) => k.startsWith("CLOUDINARY")));
  });
});

describe("validateProductionEnv — cross-variable checks", () => {
  test("rejects a DB_NAME ending in _test", () => {
    const env = { ...VALID_ENV, DB_NAME: "ladies_multi_ecomm_test" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => /DB_NAME/.test(p) && /_test/.test(p)));
  });

  test("rejects a DB_NAME ending in _ci", () => {
    const env = { ...VALID_ENV, DB_NAME: "ladies_multi_ecomm_ci" };
    const problems = validateProductionEnv(env);
    assert.ok(problems.some((p) => /DB_NAME/.test(p) && /_ci/.test(p)));
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
