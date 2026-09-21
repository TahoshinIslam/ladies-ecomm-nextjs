// Behavioral coverage for lib/expiryCleanup.js against a real, disposable
// test database — proving the actual SQL (not just the wrapper script)
// preserves active rows, removes expired ones, and handles the boundary
// and batching cases scripts/cleanupExpired.mjs relies on.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady, skipReason, connectTestDb, disconnectTestDb, truncateAll, rawQuery,
  createTestUser, testOrganizationId,
} from "./helpers/testDb.mjs";
import { generateObjectId } from "../lib/objectId.js";
import { countExpired, deleteExpiredInBatches } from "../lib/expiryCleanup.js";

const canRun = dbReady;
const reason = skipReason;

function pastDate(secondsAgo) {
  return new Date(Date.now() - secondsAgo * 1000);
}
function futureDate(secondsAhead) {
  return new Date(Date.now() + secondsAhead * 1000);
}

// `customer_sessions` carries a composite foreign key on
// (organization_id, customer_id), so a session needs a customer that really
// exists in this store — a random id is rejected outright now rather than
// quietly stored. One shopper is shared by every session these tests plant;
// which shopper owns them is irrelevant to expiry.
let sessionOwnerId;
async function sessionOwner() {
  if (!sessionOwnerId) sessionOwnerId = (await createTestUser())._id;
  return sessionOwnerId;
}

async function insertSession({ expiresAt, userId }) {
  const id = generateObjectId();
  await rawQuery(
    `INSERT INTO customer_sessions (id, organization_id, customer_id, token_hash, csrf_token_hash, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      testOrganizationId(),
      userId ?? (await sessionOwner()),
      `${id}-token-hash`.padEnd(64, "0").slice(0, 64),
      `${id}-csrf-hash`.padEnd(64, "0").slice(0, 64),
      expiresAt,
      new Date(),
    ],
  );
  return id;
}

let counterSeq = 0;
async function insertRateLimitCounter({ expiresAt }) {
  counterSeq += 1;
  const keyHash = `test-cleanup-key-${counterSeq}`.padEnd(64, "0").slice(0, 64);
  const action = "test-cleanup-action";
  const windowStart = new Date(Date.now() - counterSeq * 1000);
  await rawQuery(
    `INSERT INTO rate_limit_counters (organization_id, key_hash, action, window_start, count, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [testOrganizationId(), keyHash, action, windowStart, 1, expiresAt],
  );
  return { keyHash, action, windowStart };
}

// This is a distinct concern from the boundary tests below, added on
// review: those tests prove deleteExpiredInBatches() correctly separates
// active from expired rows using a JS-computed cutoff, but that alone
// doesn't directly show WHY the earlier NOW()-based comparison was wrong
// or that mysql2's own client-side timezone conversion (config/db.js's
// `timezone: "Z"`) is what makes the JS-Date-only fix correct rather than
// coincidental. These tests make that explicit: they insert a JS Date
// bound parameter, then compare the round-tripped column value against
// the DATABASE SERVER's own UTC_TIMESTAMP(3) — an authority independent
// of both this test process's clock and the server's `time_zone` SYSTEM
// setting (confirmed elsewhere to be +06 / Asia/Dhaka on this machine,
// while `expires_at` columns are DATETIME(3), which carries no timezone
// of its own — it is meaningful only relative to whatever convention the
// writer/reader both agree on, which is why config/db.js's `timezone:
// "Z"` client-side setting, not the server's session time_zone, is what
// actually determines correctness here). A regression back to comparing
// against SQL NOW()/NOW(3) anywhere in this path — this module, or
// wherever a caller stores expiresAt — would fail the second assertion
// below by (in this environment) about 6 hours, not a rounding error.
describe("lib/expiryCleanup.js — UTC serialization consistency (mysql2 timezone config)", { skip: !canRun && reason }, () => {
  before(async () => {
    await connectTestDb();
  });
  after(async () => {
    await disconnectTestDb();
  });
  beforeEach(async () => {
    await truncateAll();
    sessionOwnerId = undefined;
  });

  test("a JS Date bound parameter round-trips through storage as the same real instant mysql2's own client sent, independent of the server's session time_zone", async () => {
    const before = Date.now();
    const expiresAt = futureDate(30);
    const id = await insertSession({ expiresAt });
    const after = Date.now();

    const rows = await rawQuery("SELECT expires_at FROM customer_sessions WHERE id = ?", [id]);
    const stored = rows[0].expires_at;
    assert.ok(stored instanceof Date, "mysql2 with timezone:\"Z\" must return a JS Date, not a raw string, for a DATETIME(3) column");

    // Round-trip tolerance only (network + DATETIME(3) millisecond
    // rounding) — anywhere near the ~21,600,000ms (6-hour) size of the
    // original bug would fail this bound by three orders of magnitude.
    const roundTripDriftMs = Math.abs(stored.getTime() - expiresAt.getTime());
    assert.ok(
      roundTripDriftMs < 1000,
      `expected the stored expires_at to match the JS Date sent within 1000ms of round-trip tolerance, drift was ${roundTripDriftMs}ms — a ~21,600,000ms drift would mean the SYSTEM/UTC skew regressed`,
    );
    assert.ok(before - 1000 <= stored.getTime() && stored.getTime() <= after + 31000, "sanity bound: stored value must fall in the real wall-clock window this test ran in");
  });

  test("the round-tripped expires_at agrees with the database SERVER's own UTC_TIMESTAMP(3), not its local SYSTEM NOW(3) — proves the fix isn't coincidental", async () => {
    const expiresAt = futureDate(60);
    const id = await insertSession({ expiresAt });

    const rows = await rawQuery("SELECT expires_at, UTC_TIMESTAMP(3) AS server_utc_now, NOW(3) AS server_local_now FROM customer_sessions WHERE id = ?", [id]);
    const { expires_at: stored, server_utc_now: serverUtcNow, server_local_now: serverLocalNow } = rows[0];

    // stored (our JS-Date-sourced value) minus the server's own,
    // independently-computed UTC clock should reproduce the ~60s offset
    // we asked for — small tolerance for the moments elapsed between the
    // INSERT and this SELECT.
    const driftFromServerUtcMs = Math.abs(stored.getTime() - serverUtcNow.getTime() - 60_000);
    assert.ok(
      driftFromServerUtcMs < 3000,
      `expected stored expires_at to be ~60000ms ahead of the server's own UTC_TIMESTAMP(3), actual drift from that expectation was ${driftFromServerUtcMs}ms`,
    );

    // Documents WHY comparing against NOW()/NOW(3) was wrong: on this
    // environment's MariaDB instance (time_zone=SYSTEM, system tz
    // Asia/Dhaka, UTC+6), the server's own local NOW(3) and UTC_TIMESTAMP(3)
    // genuinely disagree by a large, real offset. This assertion is
    // informational (skipped rather than failed if some future environment
    // happens to run with time_zone=UTC, where the whole class of bug this
    // task fixed cannot occur) — it exists so a reader can see the
    // discrepancy directly rather than take the docs' word for it.
    const localVsUtcSkewMs = Math.abs(serverLocalNow.getTime() - serverUtcNow.getTime());
    if (localVsUtcSkewMs < 1000) {
      console.warn(
        "[expiryCleanup UTC test] this database's session time_zone appears to already be UTC (local NOW(3) ≈ UTC_TIMESTAMP(3)) — the NOW()-vs-UTC skew this fix addresses cannot be demonstrated on this environment, though the fix itself remains correct and environment-independent.",
      );
    } else {
      assert.ok(
        localVsUtcSkewMs > 1000 * 60 * 30,
        `expected a real, large SYSTEM-timezone skew (this environment is documented as UTC+6) between server NOW(3) and UTC_TIMESTAMP(3); observed only ${localVsUtcSkewMs}ms — if this environment's server timezone configuration changed, update this test/comment accordingly`,
      );
    }
  });
});

describe("lib/expiryCleanup.js — sessions", { skip: !canRun && reason }, () => {
  before(async () => {
    await connectTestDb();
  });
  after(async () => {
    await disconnectTestDb();
  });
  beforeEach(async () => {
    await truncateAll();
    sessionOwnerId = undefined;
  });

  test("an expired session is deleted", async () => {
    const id = await insertSession({ expiresAt: pastDate(60) });
    const deleted = await deleteExpiredInBatches(rawQuery, "customer_sessions", testOrganizationId());
    assert.equal(deleted, 1);
    const remaining = await rawQuery("SELECT id FROM customer_sessions WHERE id = ?", [id]);
    assert.equal(remaining.length, 0, "the expired session row must actually be gone");
  });

  test("an active (not-yet-expired) session is preserved", async () => {
    const id = await insertSession({ expiresAt: futureDate(3600) });
    const deleted = await deleteExpiredInBatches(rawQuery, "customer_sessions", testOrganizationId());
    assert.equal(deleted, 0);
    const remaining = await rawQuery("SELECT id FROM customer_sessions WHERE id = ?", [id]);
    assert.equal(remaining.length, 1, "an active session must never be deleted by the cleanup");
  });

  test("boundary: a session expiring a couple seconds in the future is preserved, one expiring a couple seconds in the past is deleted", async () => {
    const activeId = await insertSession({ expiresAt: futureDate(2) });
    const expiredId = await insertSession({ expiresAt: pastDate(2) });
    const deleted = await deleteExpiredInBatches(rawQuery, "customer_sessions", testOrganizationId());
    assert.equal(deleted, 1);
    assert.equal((await rawQuery("SELECT id FROM customer_sessions WHERE id = ?", [activeId])).length, 1, "the not-yet-expired boundary row must survive");
    assert.equal((await rawQuery("SELECT id FROM customer_sessions WHERE id = ?", [expiredId])).length, 0, "the just-expired boundary row must be deleted");
  });

  test("a mix of expired and active sessions: only the expired ones are removed, count matches exactly", async () => {
    const expiredIds = await Promise.all([pastDate(120), pastDate(90), pastDate(30)].map((d) => insertSession({ expiresAt: d })));
    const activeIds = await Promise.all([futureDate(120), futureDate(3600)].map((d) => insertSession({ expiresAt: d })));

    const deleted = await deleteExpiredInBatches(rawQuery, "customer_sessions", testOrganizationId());
    assert.equal(deleted, 3);

    for (const id of expiredIds) {
      assert.equal((await rawQuery("SELECT id FROM customer_sessions WHERE id = ?", [id])).length, 0);
    }
    for (const id of activeIds) {
      assert.equal((await rawQuery("SELECT id FROM customer_sessions WHERE id = ?", [id])).length, 1);
    }
  });

  test("countExpired reports the same number deleteExpiredInBatches will actually remove, without deleting anything itself", async () => {
    await insertSession({ expiresAt: pastDate(10) });
    await insertSession({ expiresAt: pastDate(20) });
    await insertSession({ expiresAt: futureDate(10) });

    const count = await countExpired(rawQuery, "customer_sessions", testOrganizationId());
    assert.equal(count, 2, "countExpired must match the real expired row count");

    const stillThere = await rawQuery("SELECT COUNT(*) AS n FROM customer_sessions");
    assert.equal(stillThere[0].n, 3, "countExpired must be read-only — nothing deleted yet");

    const deleted = await deleteExpiredInBatches(rawQuery, "customer_sessions", testOrganizationId());
    assert.equal(deleted, count, "the actual delete must remove exactly what was counted");
  });

  test("deletes in bounded batches: more expired rows than one batch, all still get removed, active rows untouched", async () => {
    const expiredIds = await Promise.all(Array.from({ length: 10 }, () => insertSession({ expiresAt: pastDate(60) })));
    const activeId = await insertSession({ expiresAt: futureDate(3600) });

    const deleted = await deleteExpiredInBatches(rawQuery, "customer_sessions", testOrganizationId(), { batchSize: 3 });
    assert.equal(deleted, 10, "every expired row must be removed even though batchSize (3) is smaller than the total (10)");

    for (const id of expiredIds) {
      assert.equal((await rawQuery("SELECT id FROM customer_sessions WHERE id = ?", [id])).length, 0);
    }
    assert.equal((await rawQuery("SELECT id FROM customer_sessions WHERE id = ?", [activeId])).length, 1, "batching must never touch an active row");
  });

  test("running the cleanup twice in a row is a safe no-op the second time (idempotent)", async () => {
    await insertSession({ expiresAt: pastDate(30) });
    const first = await deleteExpiredInBatches(rawQuery, "customer_sessions", testOrganizationId());
    assert.equal(first, 1);
    const second = await deleteExpiredInBatches(rawQuery, "customer_sessions", testOrganizationId());
    assert.equal(second, 0, "a second run must find nothing left to delete");
  });

  test("an empty table is handled cleanly — zero deleted, no error", async () => {
    const deleted = await deleteExpiredInBatches(rawQuery, "customer_sessions", testOrganizationId());
    assert.equal(deleted, 0);
  });
});

describe("lib/expiryCleanup.js — rate_limit_counters", { skip: !canRun && reason }, () => {
  before(async () => {
    await connectTestDb();
  });
  after(async () => {
    await disconnectTestDb();
  });
  beforeEach(async () => {
    await truncateAll();
    sessionOwnerId = undefined;
  });

  test("an expired rate-limit counter is deleted", async () => {
    const { keyHash } = await insertRateLimitCounter({ expiresAt: pastDate(60) });
    const deleted = await deleteExpiredInBatches(rawQuery, "rate_limit_counters", testOrganizationId());
    assert.equal(deleted, 1);
    const remaining = await rawQuery("SELECT key_hash FROM rate_limit_counters WHERE key_hash = ?", [keyHash]);
    assert.equal(remaining.length, 0);
  });

  test("an active rate-limit window is preserved", async () => {
    const { keyHash } = await insertRateLimitCounter({ expiresAt: futureDate(900) });
    const deleted = await deleteExpiredInBatches(rawQuery, "rate_limit_counters", testOrganizationId());
    assert.equal(deleted, 0);
    const remaining = await rawQuery("SELECT key_hash FROM rate_limit_counters WHERE key_hash = ?", [keyHash]);
    assert.equal(remaining.length, 1, "an active rate-limit window must survive cleanup — a client mid-window must keep being counted correctly");
  });

  test("boundary: a counter expiring a couple seconds in the future survives, one a couple seconds in the past is removed", async () => {
    const active = await insertRateLimitCounter({ expiresAt: futureDate(2) });
    const expired = await insertRateLimitCounter({ expiresAt: pastDate(2) });
    const deleted = await deleteExpiredInBatches(rawQuery, "rate_limit_counters", testOrganizationId());
    assert.equal(deleted, 1);
    assert.equal((await rawQuery("SELECT key_hash FROM rate_limit_counters WHERE key_hash = ?", [active.keyHash])).length, 1);
    assert.equal((await rawQuery("SELECT key_hash FROM rate_limit_counters WHERE key_hash = ?", [expired.keyHash])).length, 0);
  });

  test("deletes in bounded batches across many expired counters, active ones untouched", async () => {
    const expired = await Promise.all(Array.from({ length: 8 }, () => insertRateLimitCounter({ expiresAt: pastDate(60) })));
    const active = await insertRateLimitCounter({ expiresAt: futureDate(900) });

    const deleted = await deleteExpiredInBatches(rawQuery, "rate_limit_counters", testOrganizationId(), { batchSize: 3 });
    assert.equal(deleted, 8);

    for (const { keyHash } of expired) {
      assert.equal((await rawQuery("SELECT key_hash FROM rate_limit_counters WHERE key_hash = ?", [keyHash])).length, 0);
    }
    assert.equal((await rawQuery("SELECT key_hash FROM rate_limit_counters WHERE key_hash = ?", [active.keyHash])).length, 1);
  });

  test("running the cleanup twice in a row is a safe no-op the second time", async () => {
    await insertRateLimitCounter({ expiresAt: pastDate(30) });
    const first = await deleteExpiredInBatches(rawQuery, "rate_limit_counters", testOrganizationId());
    assert.equal(first, 1);
    const second = await deleteExpiredInBatches(rawQuery, "rate_limit_counters", testOrganizationId());
    assert.equal(second, 0);
  });
});
