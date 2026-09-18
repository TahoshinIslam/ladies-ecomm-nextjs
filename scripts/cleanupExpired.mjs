// Bounded, indexed, repeatable cleanup for the two tables MongoDB's own
// background TTL index used to physically delete automatically —
// `sessions` and `rate_limit_counters` — see sql/schema.sql's own
// idx_sessions_expires_at / idx_rate_limit_expires_at comments, and
// docs/PRODUCTION_READINESS.md §6.4 ("Expiry cleanup — real gap
// introduced by the migration") for the full background.
//
// This script is a storage-reclamation BACKSTOP ONLY — it is never relied
// on for correctness:
//   - lib/session.js's validateSessionToken() already rejects an expired
//     or revoked session on every single authenticated request, purely
//     from the row's own expires_at/revoked_at columns — a session row
//     sitting past its expiry is already 100% unusable for authentication
//     whether or not this script has ever run. Deleting it only reclaims
//     disk space.
//   - lib/rateLimit.js's own header comment documents the identical
//     guarantee for rate_limit_counters: windowStart is a deterministic
//     function of the current time, so a request always targets a
//     brand-new row the instant a new window begins — an old window's row
//     becomes irrelevant to every future check instantly, whether or not
//     this script has deleted it yet.
//
// The actual deletion logic (bounded batches, the expires_at rule) lives
// in lib/expiryCleanup.js — shared with tests/expiryCleanup.test.mjs, so
// that logic has real behavioral test coverage against a live database,
// not just this CLI wrapper's own output.
//
// Reports ROW COUNTS only. Never logs a token_hash, csrf_token_hash,
// key_hash, or any other column value from either table.
//
// Usage:
//   node --env-file=.env scripts/cleanupExpired.mjs              (deletes expired rows)
//   node --env-file=.env scripts/cleanupExpired.mjs --dry-run    (reports counts only, writes nothing)
//
// Exit code: 0 on success (including "nothing to delete"); 1 on any error
// (a connection failure, a query error) — so a cron/launchd wrapper can
// alert on a non-zero exit without parsing output.

import connectDB, { query, closePool } from "../config/db.js";
import { countExpired, deleteExpiredInBatches } from "../lib/expiryCleanup.js";

const DRY_RUN = process.argv.includes("--dry-run");

function log(message) {
  console.log(`[cleanupExpired] ${message}`);
}

async function main() {
  await connectDB();

  if (DRY_RUN) {
    const sessionsExpired = await countExpired(query, "sessions");
    const countersExpired = await countExpired(query, "rate_limit_counters");
    log(`DRY RUN — would delete ${sessionsExpired} expired session(s), ${countersExpired} expired rate-limit counter(s). Nothing written.`);
    await closePool();
    return;
  }

  const sessionsDeleted = await deleteExpiredInBatches(query, "sessions");
  log(`sessions: deleted ${sessionsDeleted} expired row(s)`);

  const countersDeleted = await deleteExpiredInBatches(query, "rate_limit_counters");
  log(`rate_limit_counters: deleted ${countersDeleted} expired row(s)`);

  log(`done — ${sessionsDeleted + countersDeleted} row(s) reclaimed total`);
  await closePool();
}

main().catch((err) => {
  // Deliberately generic — never the query, never a row's own data, just
  // the error's own message (config/db.js's own errors are already kept
  // credential-free — see its own comments).
  console.error("[cleanupExpired] failed:", err.message || err);
  process.exitCode = 1;
});
