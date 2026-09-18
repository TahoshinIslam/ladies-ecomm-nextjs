// Regression coverage for the confirmed audit gap: scripts/cleanupExpired.mjs's
// batched, idempotent expiry sweep existed but nothing ever invoked it
// automatically. app/api/admin/cron/cleanup/route.js is the HTTP entry
// point a real scheduler calls — this proves it's authenticated, repeat-
// safe, and covers all three expiring tables (sessions/rate_limit_counters/
// events), against the real disposable test database.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, truncateAll, rawQuery } from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("GET /api/admin/cron/cleanup — authenticated, repeat-safe scheduled cleanup", { skip: !canRun && reason }, () => {
  let cleanupGET;
  const ORIGINAL_SECRET = process.env.CRON_SECRET;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    process.env.CRON_SECRET = "test-cron-secret-value-0123456789";
    ({ GET: cleanupGET } = await import("../app/api/admin/cron/cleanup/route.js"));
  });

  after(async () => {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
    await disconnectTestDb();
  });

  function req(authHeader) {
    const headers = new Headers();
    if (authHeader !== undefined) headers.set("authorization", authHeader);
    return new Request("http://test/api/admin/cron/cleanup", { method: "GET", headers });
  }

  test("no Authorization header is rejected (401)", async () => {
    const res = await cleanupGET(req());
    assert.equal(res.status, 401);
  });

  test("wrong bearer token is rejected (401)", async () => {
    const res = await cleanupGET(req("Bearer totally-wrong-value"));
    assert.equal(res.status, 401);
  });

  test("the correct bearer token succeeds and reports per-table + total counts", async () => {
    // Seed one already-expired row in each covered table so the sweep has
    // something real to delete, not just a trivially-empty run.
    await rawQuery(
      "INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["c".repeat(24), "d".repeat(24), "a".repeat(64), "b".repeat(64), new Date(Date.now() - 1000), new Date(Date.now() - 1000), ""],
    );
    await rawQuery(
      "INSERT INTO rate_limit_counters (key_hash, action, window_start, count, expires_at) VALUES (?, ?, ?, ?, ?)",
      ["c".repeat(64), "cleanuptest-action", new Date(Date.now() - 120000), 1, new Date(Date.now() - 1000)],
    );
    await rawQuery("INSERT INTO events (channel, type, payload, expires_at) VALUES (?, ?, ?, ?)", [
      "cleanuptest-channel",
      "CLEANUP_TEST",
      JSON.stringify({}),
      new Date(Date.now() - 1000),
    ]);

    const res = await cleanupGET(req(`Bearer ${process.env.CRON_SECRET}`));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(json.deleted.sessions >= 1);
    assert.ok(json.deleted.rate_limit_counters >= 1);
    assert.ok(json.deleted.events >= 1);
    assert.equal(json.total, json.deleted.sessions + json.deleted.rate_limit_counters + json.deleted.events);
  });

  test("calling it again immediately (repeat/overlapping-scheduler simulation) is a safe no-op — never errors, never double-deletes", async () => {
    const first = await cleanupGET(req(`Bearer ${process.env.CRON_SECRET}`));
    assert.equal(first.status, 200);
    const firstJson = await first.json();

    const second = await cleanupGET(req(`Bearer ${process.env.CRON_SECRET}`));
    assert.equal(second.status, 200, "a second, immediately-following call must succeed, not error");
    const secondJson = await second.json();
    assert.equal(secondJson.total, 0, "nothing new expired in between — the second call must find nothing left to delete");
    assert.notEqual(firstJson, undefined);
  });
});

describe("GET /api/admin/cron/cleanup — fails closed when CRON_SECRET is not configured", { skip: !canRun && reason }, () => {
  let cleanupGET;
  const ORIGINAL_SECRET = process.env.CRON_SECRET;

  before(async () => {
    await connectTestDb();
    delete process.env.CRON_SECRET;
    ({ GET: cleanupGET } = await import("../app/api/admin/cron/cleanup/route.js"));
  });

  after(async () => {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
    await disconnectTestDb();
  });

  test("with CRON_SECRET unset, every request is rejected (503) rather than silently unauthenticated", async () => {
    const res = await cleanupGET(new Request("http://test/api/admin/cron/cleanup", { method: "GET" }));
    assert.equal(res.status, 503);
  });
});
