import { withConnection } from "../config/db.js";
import { getOrganizationId } from "../lib/tenant.js";

// See models/README-migration.md. MySQL's `INSERT ... ON DUPLICATE KEY
// UPDATE` is the direct equivalent of the old Mongo
// `findOneAndUpdate({...}, {$inc}, {upsert:true})` this replaces — both are
// a single atomic statement, so the "two concurrent requests racing to
// create the same brand-new window" case lib/rateLimit.js's own comment
// describes is handled by MySQL itself the same way MongoDB handled it,
// just via ON DUPLICATE KEY UPDATE instead of a caught E11000 retry (no
// separate retry branch is needed here — unlike a plain INSERT, ON
// DUPLICATE KEY UPDATE never raises a duplicate-key error to catch).
export async function upsertAndIncrement({ keyHash, action, windowStart, expiresAt }) {
  // `LAST_INSERT_ID(expr)` is a documented MySQL idiom: evaluating it sets
  // the CONNECTION's session-level last-insert-id to `expr` (as a side
  // effect) and also returns `expr` as the expression's own value — so
  // `SELECT LAST_INSERT_ID()` afterward retrieves whatever `expr` was. This
  // ONLY works cleanly when nothing else on the table competes for that
  // same session value — an AUTO_INCREMENT column on this table would
  // silently overwrite it with the row's own generated id on a plain
  // INSERT, even when the insert expression itself calls
  // `LAST_INSERT_ID(1)` (confirmed empirically against MariaDB 10.4, not
  // just a theoretical concern) — which is exactly why
  // rate_limit_counters has NO separate surrogate id column and uses
  // (organization_id, key_hash, action, window_start) as its real PRIMARY
  // KEY instead (see sql/schema.sql's own comment on this table).
  //
  // The organization is part of that key, not just a filter: without it one
  // store's traffic would increment the counter another store is throttled
  // by, and a busy shop could lock a quiet one's customers out of their own
  // sign-in.
  //
  // Both statements must run on the very same connection (withConnection,
  // not the pool's own auto-checkout-per-call `query()`) since
  // last-insert-id is a per-connection session value.
  return withConnection(async (conn) => {
    await conn.query(
      `INSERT INTO rate_limit_counters (organization_id, key_hash, action, window_start, count, expires_at)
       VALUES (?, ?, ?, ?, LAST_INSERT_ID(1), ?)
       ON DUPLICATE KEY UPDATE count = LAST_INSERT_ID(count + 1)`,
      [getOrganizationId(), keyHash, action, windowStart, expiresAt],
    );
    const [rows] = await conn.query("SELECT LAST_INSERT_ID() AS count");
    return Number(rows[0].count);
  });
}

const RateLimitCounter = { upsertAndIncrement };

export default RateLimitCounter;
