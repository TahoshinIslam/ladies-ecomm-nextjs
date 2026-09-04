// Post-test check for strict/CI runs: fails if any database-backed (or
// module-mock-backed) suite reported itself as SKIPPED instead of actually
// running. scripts/assertTestDbSafety.mjs (pretest) already proves the test
// database is reachable and transaction-capable before any test file runs
// — if a suite skips anyway after that, something is wrong (e.g. a test
// file's own gating condition disagrees with the environment), and CI must
// not report green.
//
// Usage: node scripts/assertNoCriticalSkips.mjs <path-to-captured-test-output> [more-paths...]
// Only meaningful when the preceding test run(s) had CI=true or
// REQUIRE_TEST_DB=true — see .github/workflows/ci.yml, which pipes both
// `npm run test:core`'s and `npm run test:http`'s output to files
// specifically so this script can inspect them.

import { readFileSync } from "node:fs";

const strict = process.env.CI === "true" || process.env.REQUIRE_TEST_DB === "true";
if (!strict) {
  console.log("Not in strict mode (CI/REQUIRE_TEST_DB unset) — skipping the no-critical-skips check.");
  process.exit(0);
}

const logPaths = process.argv.slice(2);
if (!logPaths.length) {
  console.error("✖ Usage: node scripts/assertNoCriticalSkips.mjs <path-to-captured-test-output> [more-paths...]");
  process.exit(1);
}

const output = logPaths.map((p) => readFileSync(p, "utf8")).join("\n");

// These are the exact skip-reason substrings tests/helpers/testDb.mjs and
// the individual test files use when they can't reach/use the test
// database or the module-mocking flag. Any of these appearing in a strict
// run means a suite that should have executed didn't.
const CRITICAL_SKIP_MARKERS = [
  "MONGO_URI_TEST not configured",
  "MONGO_URI_TEST not reachable",
  "module mocking unavailable",
  "test server not reachable",
];

const skipLines = output
  .split("\n")
  .filter((line) => /# SKIP/.test(line) && CRITICAL_SKIP_MARKERS.some((marker) => line.includes(marker)));

if (skipLines.length > 0) {
  console.error("\n✖ Critical database-backed test suite(s) skipped in a strict/CI run:\n");
  for (const line of skipLines) console.error(`  ${line.trim()}`);
  console.error(
    "\nThis run's pretest step already proved MONGO_URI_TEST is reachable and transaction-capable, " +
      "so a skip here means a test file's own gate disagrees with that — investigate before trusting this run.\n",
  );
  process.exit(1);
}

// A different failure mode: no database-backed suites even matched the
// "dev server not reachable" skip pattern from the pre-existing tests,
// but also no evidence any new suite ran at all (e.g. glob matched zero
// files). Sanity-check that at least one of the Phase 1 suites is present
// in the output at all.
const knownSuiteMarkers = [
  "review ownership",
  "duplicate-submission characterization",
  "limit parameter",
  "forgotPassword()",
];
const anySuitePresent = knownSuiteMarkers.some((marker) => output.includes(marker));
if (!anySuitePresent) {
  console.error("\n✖ None of the expected Phase 1 database-backed suites appear in the test output at all — the test glob may not have matched them.\n");
  process.exit(1);
}

console.log("✓ No critical database-backed suites were skipped.");
process.exit(0);
