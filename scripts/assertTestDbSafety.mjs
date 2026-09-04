// Runs automatically before `npm test` (npm's `pretest` convention — see
// package.json). Fails fast, before any test file connects to anything, if
// the environment looks like it could touch a production database — and,
// in strict mode (CI), fails fast if the test database ISN'T actually
// usable, rather than letting the suite quietly skip its most important
// coverage.
//
// Two modes:
//
//   Local/default (CI unset, REQUIRE_TEST_DB unset): MONGO_URI_TEST is
//   optional. If it's missing, this prints a warning and exits 0 — the
//   individual database-backed test files each skip themselves with a
//   clear message (see tests/helpers/testDb.mjs), matching the existing
//   pre-Phase-1 pattern of "skip, don't fail, when infra isn't present."
//
//   Strict (CI=true or REQUIRE_TEST_DB=true): MONGO_URI_TEST is required.
//   Missing, misnamed, unreachable, or non-transactional is a hard failure
//   here — before a single test runs — specifically so a misconfigured CI
//   run can never silently report "all green" while every database-backed
//   suite actually skipped.

import mongoose from "mongoose";

const PRODUCTION_HOST_PATTERNS = [
  /mongodb\.net/i, // Atlas SRV hosts
  /\.mongodb\.com/i,
  /amazonaws\.com/i,
  /compute\.internal/i,
];

// The database name (path segment of the URI) must clearly read as
// test-only — this is a second, independent guard beyond "not equal to
// MONGO_URI" and "not a hosted-provider hostname," so a typo that points
// MONGO_URI_TEST at some other real database (still self-hosted, still not
// matching the host patterns above) is still caught.
const TEST_DB_NAME_PATTERN = /test/i;

const strict = process.env.CI === "true" || process.env.REQUIRE_TEST_DB === "true";

function fail(message) {
  console.error(`\n✖ Test DB safety check failed${strict ? " (strict mode)" : ""}: ${message}\n`);
  process.exit(1);
}

function dbNameFromUri(uri) {
  try {
    // Handles both mongodb:// and mongodb+srv:// — WHATWG URL parses both
    // schemes fine for this purpose since we only need the pathname.
    const u = new URL(uri);
    return decodeURIComponent(u.pathname.replace(/^\//, "")) || null;
  } catch {
    return null;
  }
}

if (process.env.NODE_ENV !== "test") {
  fail(
    `NODE_ENV is "${process.env.NODE_ENV || "(unset)"}", not "test". ` +
      `config/db.js only reads MONGO_URI_TEST when NODE_ENV=test — run tests via ` +
      `"npm test" (which sets this), not a bare "node --test".`,
  );
}

const testUri = process.env.MONGO_URI_TEST;
const prodUri = process.env.MONGO_URI;

if (!testUri) {
  if (strict) {
    fail(
      "MONGO_URI_TEST is not set and CI=true/REQUIRE_TEST_DB=true — refusing to let database-backed " +
        "suites silently skip in CI. Configure MONGO_URI_TEST (see .github/workflows/ci.yml and .env.test.example).",
    );
  }
  console.warn(
    "⚠ MONGO_URI_TEST is not set — database-backed tests will skip themselves " +
      "rather than run. Set it (see .env.test.example) to actually exercise them.",
  );
  process.exit(0);
}

if (prodUri && testUri === prodUri) {
  fail("MONGO_URI_TEST is identical to MONGO_URI — refusing to run tests against the same database.");
}

for (const pattern of PRODUCTION_HOST_PATTERNS) {
  if (pattern.test(testUri)) {
    fail(
      `MONGO_URI_TEST matches a pattern associated with hosted/production MongoDB (${pattern}). ` +
        `Point it at a local or CI-only replica-set instance instead.`,
    );
  }
}

const dbName = dbNameFromUri(testUri);
if (!dbName || !TEST_DB_NAME_PATTERN.test(dbName)) {
  fail(
    `MONGO_URI_TEST's database name ("${dbName || "(none)"}") does not clearly read as test-only ` +
      `(expected it to contain "test", e.g. "tahos_test") — refusing to run destructive test cleanup ` +
      `against a database that isn't unambiguously a test database.`,
  );
}

// In strict mode, actually prove the database is usable — connect for
// real, and confirm it supports transactions (services/orderService.js's
// createOrder() requires a replica set; a plain standalone mongod would
// otherwise make every transaction-dependent test silently skip, which is
// exactly the false-green outcome this script exists to prevent).
if (strict) {
  console.log(`Strict mode: verifying MONGO_URI_TEST is reachable and transaction-capable (db: "${dbName}")...`);
  try {
    await mongoose.connect(testUri, { serverSelectionTimeoutMS: 10_000 });
  } catch (err) {
    await mongoose.disconnect().catch(() => {});
    fail(`Could not connect to MONGO_URI_TEST: ${err.message}`);
  }

  const probeCollection = mongoose.connection.collection("_phase1_txn_capability_probe");
  try {
    const session = await mongoose.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await probeCollection.insertOne({ probe: true, at: new Date() }, { session });
      });
    } finally {
      await session.endSession();
    }
    await probeCollection.deleteMany({ probe: true });
  } catch (err) {
    await mongoose.disconnect().catch(() => {});
    fail(
      `MONGO_URI_TEST connected but does not support transactions (${err.message}). ` +
        `MongoDB transactions require a replica set — see .github/workflows/ci.yml's ` +
        `"mongodb-replica-set: test-rs" configuration and the matching "replicaSet=test-rs" ` +
        `query param on MONGO_URI_TEST.`,
    );
  }

  await mongoose.disconnect().catch(() => {});
  console.log("✓ Test database reachable and transaction-capable.");
}

process.exit(0);
