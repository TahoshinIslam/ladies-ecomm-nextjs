// Runs automatically before `npm test` (npm's `pretest` convention — see
// package.json). Fails fast, before any test file connects to anything, if
// the environment looks like it could touch a non-test database — and, in
// strict mode (CI), fails fast if the test database ISN'T actually usable,
// rather than letting the suite quietly skip its most important coverage.
//
// Two modes:
//
//   Local/default (CI unset, REQUIRE_TEST_DB unset): a usable DB_NAME is
//   optional. If it's missing/unsafe, this prints a warning and exits 0 —
//   individual database-backed test files are expected to skip themselves
//   with a clear message, matching this app's existing "skip, don't fail,
//   when infra isn't present" convention.
//
//   Strict (CI=true or REQUIRE_TEST_DB=true): a safe DB_NAME is required.
//   Missing, misnamed, or unreachable is a hard failure here — before a
//   single test runs — specifically so a misconfigured CI run can never
//   silently report "all green" while every database-backed suite
//   actually skipped.
//
// The name/host predicates themselves live in lib/testDbSafety.js (shared
// with scripts/httpTestServer.mjs, and unit-tested directly in
// tests/testDbSafety.test.mjs) — this file is just the CLI wrapper that
// decides what "unsafe" means in each of the two modes above.

import mysql from "mysql2/promise";

import { checkTestDbConfig } from "../lib/testDbSafety.js";

const strict = process.env.CI === "true" || process.env.REQUIRE_TEST_DB === "true";

function fail(message) {
  console.error(`\n✖ Test DB safety check failed${strict ? " (strict mode)" : ""}: ${message}\n`);
  process.exit(1);
}

if (process.env.NODE_ENV !== "test") {
  fail(
    `NODE_ENV is "${process.env.NODE_ENV || "(unset)"}", not "test". ` +
      `Run tests via "npm test" (which sets this), not a bare "node --test".`,
  );
}

const dbName = process.env.DB_NAME;

if (!dbName) {
  if (strict) {
    fail(
      "DB_NAME is not set and CI=true/REQUIRE_TEST_DB=true — refusing to let database-backed " +
        "suites silently skip in CI. Configure DB_NAME in .env.test (see .env.test.example).",
    );
  }
  console.warn(
    "⚠ DB_NAME is not set — database-backed tests will skip themselves rather than run. " +
      "Set it (see .env.test.example) to actually exercise them.",
  );
  process.exit(0);
}

const host = process.env.DB_HOST || "127.0.0.1";
const configCheck = checkTestDbConfig({ dbName, host, allowRemoteHost: process.env.ALLOW_REMOTE_TEST_DB === "true" });
if (!configCheck.ok) {
  fail(configCheck.reason);
}

// In strict mode, actually prove the database is usable — connect for
// real and confirm a transaction round-trip works. InnoDB (this schema's
// engine — see sql/schema.sql) supports real ACID transactions on a single
// standalone server, so — unlike the old MongoDB replica-set requirement —
// there is no special server topology to verify here beyond "is it
// reachable and is the schema imported."
if (strict) {
  console.log(`Strict mode: verifying the test database is reachable and importable (db: "${dbName}")...`);
  let conn;
  try {
    conn = await mysql.createConnection({
      host,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || "",
      database: dbName,
      connectTimeout: 10_000,
    });
  } catch (err) {
    fail(`Could not connect to DB_NAME="${dbName}": ${err.message}`);
  }

  try {
    await conn.beginTransaction();
    await conn.query("SELECT 1");
    await conn.commit();
    const [tables] = await conn.query("SHOW TABLES LIKE 'users'");
    if (!tables.length) {
      fail(`Connected to "${dbName}", but it has no "users" table — import sql/schema.sql into it first.`);
    }
  } catch (err) {
    await conn.rollback().catch(() => {});
    fail(`Test database connected but a transaction probe failed: ${err.message}`);
  } finally {
    await conn.end().catch(() => {});
  }

  console.log("✓ Test database reachable, schema present, and transaction-capable.");
}

process.exit(0);
