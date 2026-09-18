// Shared by scripts/cleanupExpired.mjs (the CLI/cron entry point) and
// tests/expiryCleanup.test.mjs — see that script's own header comment for
// the full background on why this exists (MySQL has no equivalent to
// MongoDB's TTL index) and why it's a storage-reclamation backstop only,
// never relied on for authentication/rate-limit correctness.
//
// Every function here takes an explicit `queryFn` (shaped like
// config/db.js's own `query()` — `async (sql, params) => rows`) instead of
// importing config/db.js directly, so tests can point these functions at
// the real, disposable test database via tests/helpers/testDb.mjs's
// `rawQuery`, without this module ever needing to know which database
// it's talking to.

const DEFAULT_BATCH_SIZE = 1000;

// Deliberately a JS-computed, parameterized cutoff — never SQL's own
// NOW()/UTC_TIMESTAMP(). Confirmed directly against this app's real local
// MySQL/MariaDB instance: `time_zone` is "SYSTEM" and the system's own
// timezone is NOT UTC (Asia/Dhaka, UTC+6 here), so MySQL's NOW() returns
// LOCAL wall-clock time while every `expires_at`/timestamp column this
// app writes is stored as UTC (config/db.js's pool sets `timezone: "Z"`,
// telling the driver to treat every JS Date as UTC on the way in and out)
// — comparing a UTC column against server-local NOW() would be wrong by
// the server's own UTC offset, exactly the class of bug
// lib/session.js's validateSessionToken() already avoids by comparing
// `expiresAt` against a JS `new Date()` instead of asking MySQL. This
// function follows that same, already-proven-safe pattern rather than
// introducing a second, timezone-dependent way to ask "is this expired."
function expiredWhereClause() {
  return { sql: "expires_at < ?", params: [new Date()] };
}

/** Row count of `table` currently past its own expiry — read-only, no delete. */
export async function countExpired(queryFn, table) {
  const { sql, params } = expiredWhereClause();
  const rows = await queryFn(`SELECT COUNT(*) AS n FROM ${table} WHERE ${sql}`, params);
  return rows[0].n;
}

/**
 * Deletes every row in `table` whose `expires_at` has already passed, in
 * bounded batches (never one unbounded DELETE against a potentially large
 * table) — relies on `table` having an index on `expires_at` (both
 * `sessions` and `rate_limit_counters` do — see sql/schema.sql) to keep
 * each batch's WHERE clause a fast indexed range scan rather than a full
 * table scan. Returns the total number of rows deleted.
 *
 * `table` is never caller/request-supplied — both real call sites pass a
 * fixed string literal ("sessions" / "rate_limit_counters"), never
 * interpolated user input, so this has no injection surface despite the
 * template-string SQL.
 */
export async function deleteExpiredInBatches(queryFn, table, { batchSize = DEFAULT_BATCH_SIZE } = {}) {
  let total = 0;
  for (;;) {
    // A fresh `new Date()` (via expiredWhereClause()) on every batch
    // iteration, not one captured before the loop — a cleanup run
    // spanning many batches on a very large backlog should use "now" at
    // the time each batch actually runs, not a slightly-stale value from
    // when the function was first called.
    const { sql, params } = expiredWhereClause();
    const result = await queryFn(`DELETE FROM ${table} WHERE ${sql} LIMIT ${batchSize}`, params);
    const deleted = result.affectedRows ?? 0;
    total += deleted;
    if (deleted < batchSize) break;
  }
  return total;
}
