// Unit coverage for lib/testDbSafety.js — the guard both
// scripts/assertTestDbSafety.mjs (the pretest gate) and
// scripts/httpTestServer.mjs (the HTTP-integration harness) rely on to
// never run destructive setup/cleanup against the real ladies_multi_ecomm
// database or a stray non-test database. Pure-function checks need no
// database; assertConnectedDbMatches()'s own behavior is proven with a
// fake queryFn here (its real-database defense-in-depth role is exercised
// live by tests/httpTestServer.test.mjs instead).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  KNOWN_NON_TEST_DB_NAMES,
  TEST_DB_NAME_PATTERN,
  checkTestDbName,
  checkTestDbHost,
  checkTestDbConfig,
  assertConnectedDbMatches,
} from "../lib/testDbSafety.js";

describe("checkTestDbName", () => {
  test("rejects an unset name", () => {
    assert.deepEqual(checkTestDbName(undefined), { ok: false, reason: "DB_NAME is not set" });
    assert.deepEqual(checkTestDbName(""), { ok: false, reason: "DB_NAME is not set" });
  });

  test("rejects the real application database name", () => {
    const result = checkTestDbName("ladies_multi_ecomm");
    assert.equal(result.ok, false);
    assert.match(result.reason, /real application database name/);
  });

  test("rejects a name that doesn't end in _test or _ci", () => {
    const result = checkTestDbName("ladies_multi_ecomm_dev");
    assert.equal(result.ok, false);
    assert.match(result.reason, /does not end in/);
  });

  test("rejects a name that merely CONTAINS \"test\" without ending in it", () => {
    // Regression guard: a substring check would wrongly accept this.
    const result = checkTestDbName("test_ladies_multi_ecomm");
    assert.equal(result.ok, false);
  });

  test("accepts a name ending in _test", () => {
    assert.deepEqual(checkTestDbName("ladies_multi_ecomm_test"), { ok: true });
  });

  test("accepts a name ending in _ci (case-insensitive)", () => {
    assert.deepEqual(checkTestDbName("tahos_test_CI"), { ok: true });
  });

  test("KNOWN_NON_TEST_DB_NAMES and TEST_DB_NAME_PATTERN are exported for reuse elsewhere", () => {
    assert.ok(Array.isArray(KNOWN_NON_TEST_DB_NAMES) && KNOWN_NON_TEST_DB_NAMES.includes("ladies_multi_ecomm"));
    assert.ok(TEST_DB_NAME_PATTERN instanceof RegExp);
  });
});

describe("checkTestDbHost", () => {
  test("accepts 127.0.0.1, localhost, and ::1", () => {
    assert.equal(checkTestDbHost("127.0.0.1").ok, true);
    assert.equal(checkTestDbHost("localhost").ok, true);
    assert.equal(checkTestDbHost("::1").ok, true);
  });

  test("rejects a remote host by default", () => {
    const result = checkTestDbHost("db.example.internal");
    assert.equal(result.ok, false);
    assert.match(result.reason, /not localhost/);
  });

  test("accepts a remote host only when allowRemote is explicitly true", () => {
    assert.equal(checkTestDbHost("db.example.internal", { allowRemote: false }).ok, false);
    assert.equal(checkTestDbHost("db.example.internal", { allowRemote: true }).ok, true);
  });

  test("rejects an unset host", () => {
    assert.equal(checkTestDbHost(undefined).ok, false);
  });
});

describe("checkTestDbConfig — combined name + host check", () => {
  test("passes for a safe local test database", () => {
    assert.deepEqual(checkTestDbConfig({ dbName: "ladies_multi_ecomm_test", host: "127.0.0.1" }), { ok: true });
  });

  test("fails on the name check before ever looking at host (name is checked first)", () => {
    const result = checkTestDbConfig({ dbName: "ladies_multi_ecomm", host: "127.0.0.1" });
    assert.equal(result.ok, false);
    assert.match(result.reason, /real application database name/);
  });

  test("a safe name with an unapproved remote host still fails", () => {
    const result = checkTestDbConfig({ dbName: "ladies_multi_ecomm_test", host: "some-remote-host.example" });
    assert.equal(result.ok, false);
    assert.match(result.reason, /not localhost/);
  });
});

describe("assertConnectedDbMatches — defense-in-depth live-connection check", () => {
  test("resolves with the database name when it matches", async () => {
    const fakeQuery = async () => [{ db: "ladies_multi_ecomm_test" }];
    const result = await assertConnectedDbMatches(fakeQuery, "ladies_multi_ecomm_test");
    assert.equal(result, "ladies_multi_ecomm_test");
  });

  test("throws when the live connection reports a DIFFERENT database than expected", async () => {
    const fakeQuery = async () => [{ db: "ladies_multi_ecomm" }];
    await assert.rejects(
      () => assertConnectedDbMatches(fakeQuery, "ladies_multi_ecomm_test"),
      (err) => {
        assert.match(err.message, /Connected database is "ladies_multi_ecomm"/);
        assert.match(err.message, /expected "ladies_multi_ecomm_test"/);
        return true;
      },
    );
  });

  test("throws with a clear message when SELECT DATABASE() returns nothing", async () => {
    const fakeQuery = async () => [];
    await assert.rejects(() => assertConnectedDbMatches(fakeQuery, "ladies_multi_ecomm_test"), /\(none\)/);
  });
});
