// Incident response, restored for MySQL — regression coverage for
// lib/localDevSafety.js's checkLocalDevHost(), wired into config/db.js's
// buildPool(). See that module's own header comment for the full incident
// history this guards against: a plain `next dev` (no explicit opt-in)
// silently connecting to a remote production database.
//
// This is a pure-function test (no live database, no real Vercel/test
// environment) — checkLocalDevHost() takes an explicit env object
// specifically so it's testable this way, same as lib/testDbSafety.js's
// checks. A companion integration proof (config/db.js's buildPool()
// actually calling this and refusing to build a pool) is covered by
// tests/buildTimeDbAccessPrevention.test.mjs's sibling NEXT_PHASE guard
// pattern — that file already proves getPool()'s guards fire for real;
// this file proves the underlying predicate's decision table is correct.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { checkLocalDevHost } from "../lib/localDevSafety.js";

describe("checkLocalDevHost — Vercel and test-suite runs are always unaffected", () => {
  test("VERCEL=1 bypasses every check, even a remote host with nothing else configured", () => {
    const result = checkLocalDevHost({ VERCEL: "1" }, "some-remote-host.example");
    assert.deepEqual(result, { ok: true });
  });

  test("NODE_ENV=test bypasses this guard (the test suite has its own independent, stricter guard)", () => {
    const result = checkLocalDevHost({ NODE_ENV: "test" }, "some-remote-host.example");
    assert.deepEqual(result, { ok: true });
  });

  test("VERCEL is checked before NODE_ENV — order doesn't matter, both alone are sufficient", () => {
    assert.equal(checkLocalDevHost({ VERCEL: "1", NODE_ENV: "development" }, "remote.example").ok, true);
  });
});

describe("checkLocalDevHost — local-machine runs (neither VERCEL nor NODE_ENV=test)", () => {
  test("accepts 127.0.0.1, localhost, and ::1", () => {
    assert.equal(checkLocalDevHost({}, "127.0.0.1").ok, true);
    assert.equal(checkLocalDevHost({}, "localhost").ok, true);
    assert.equal(checkLocalDevHost({}, "::1").ok, true);
  });

  test("rejects an unset host", () => {
    const result = checkLocalDevHost({}, undefined);
    assert.equal(result.ok, false);
    assert.match(result.reason, /DB_HOST is not set/);
  });

  test("rejects a remote host by default — this is the actual incident-prevention case", () => {
    const result = checkLocalDevHost({}, "prod-mysql.internal.example.com");
    assert.equal(result.ok, false);
    assert.match(result.reason, /not localhost/);
    assert.match(result.reason, /ALLOW_REMOTE_DEV_DB/);
  });

  test("a remote host is accepted only with the explicit ALLOW_REMOTE_DEV_DB=true opt-in", () => {
    assert.equal(checkLocalDevHost({ ALLOW_REMOTE_DEV_DB: "true" }, "prod-mysql.internal.example.com").ok, true);
  });

  test("ALLOW_REMOTE_DEV_DB set to anything other than the exact string \"true\" is NOT an opt-in", () => {
    assert.equal(checkLocalDevHost({ ALLOW_REMOTE_DEV_DB: "1" }, "remote.example").ok, false);
    assert.equal(checkLocalDevHost({ ALLOW_REMOTE_DEV_DB: "yes" }, "remote.example").ok, false);
    assert.equal(checkLocalDevHost({ ALLOW_REMOTE_DEV_DB: "false" }, "remote.example").ok, false);
  });

  test("NODE_ENV=production (a bare local `next start`, which always forces this) still gets the guard — VERCEL is the only real bypass", () => {
    // `next start` always runs as NODE_ENV=production regardless of the
    // actual deployment target (documented elsewhere in this codebase) —
    // so NODE_ENV alone can never distinguish "real Vercel Production"
    // from "someone's laptop running `next start` locally." VERCEL is the
    // only trustworthy signal, which is exactly why this guard keys off
    // it instead.
    const result = checkLocalDevHost({ NODE_ENV: "production" }, "remote.example");
    assert.equal(result.ok, false);
  });
});
