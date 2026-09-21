import { query } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import { getOrganizationId } from "../lib/tenant.js";
import User from "./userModel.js";

// See models/README-migration.md for the general pattern. Only the
// functions lib/session.js actually calls are implemented.

function rowToSession(row) {
  if (!row) return null;
  return {
    _id: row.id,
    user: row.customer_id,
    tokenHash: row.token_hash,
    csrfTokenHash: row.csrf_token_hash,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

async function create({ user, tokenHash, csrfTokenHash, expiresAt, userAgent }) {
  const id = generateObjectId();
  await query(
    `INSERT INTO customer_sessions
       (id, organization_id, customer_id, token_hash, csrf_token_hash, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, NOW(3), ?)`,
    [id, getOrganizationId(), user, tokenHash, csrfTokenHash, expiresAt, userAgent || ""],
  );
  return rowToSession({ id, customer_id: user, token_hash: tokenHash, csrf_token_hash: csrfTokenHash, expires_at: expiresAt, last_seen_at: new Date(), user_agent: userAgent || "" });
}

/** Active (not revoked, not expired) session ids for a user, newest first — pruneExcessSessions(). */
async function findActiveIdsByUser(userId) {
  // A JS-computed cutoff, not SQL's NOW() — this app's DATETIME columns
  // are stored as UTC (config/db.js's pool sets timezone: "Z"), but a
  // MySQL/MariaDB server's own NOW() returns LOCAL system time whenever
  // its `time_zone` setting is "SYSTEM" and the system itself isn't UTC
  // (confirmed on this app's own local instance) — comparing a UTC column
  // against server-local NOW() would silently misjudge any session in its
  // final stretch before real expiry. Same fix, same reasoning, as
  // lib/expiryCleanup.js's own expiredWhereClause().
  const rows = await query(
    `SELECT id FROM customer_sessions
      WHERE organization_id = ? AND customer_id = ? AND revoked_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC`,
    [getOrganizationId(), userId, new Date()],
  );
  return rows.map((r) => r.id);
}

async function revokeByIds(ids) {
  if (!ids.length) return;
  await query(
    `UPDATE customer_sessions SET revoked_at = NOW(3)
      WHERE organization_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
    [getOrganizationId(), ...ids],
  );
}

/** Finds a session by its token hash and populates `.user` — validateSessionToken(). */
async function findByTokenHash(tokenHash) {
  // Scoped even though token_hash is unique across the table: a token issued
  // by another store must not authenticate anyone here, and letting the
  // lookup succeed before checking would be authentication by accident.
  const rows = await query(
    "SELECT * FROM customer_sessions WHERE organization_id = ? AND token_hash = ? LIMIT 1",
    [getOrganizationId(), tokenHash],
  );
  const session = rowToSession(rows[0]);
  if (!session) return null;
  session.user = await User.findById(session.user);
  return session;
}

async function touchLastSeen(sessionId) {
  await query("UPDATE customer_sessions SET last_seen_at = NOW(3) WHERE organization_id = ? AND id = ?", [
    getOrganizationId(),
    sessionId,
  ]);
}

async function revokeByTokenHash(tokenHash) {
  await query(
    "UPDATE customer_sessions SET revoked_at = NOW(3) WHERE organization_id = ? AND token_hash = ? AND revoked_at IS NULL",
    [getOrganizationId(), tokenHash],
  );
}

async function revokeAllForUser(userId) {
  await query(
    "UPDATE customer_sessions SET revoked_at = NOW(3) WHERE organization_id = ? AND customer_id = ? AND revoked_at IS NULL",
    [getOrganizationId(), userId],
  );
}

const Session = {
  create,
  findActiveIdsByUser,
  revokeByIds,
  findByTokenHash,
  touchLastSeen,
  revokeByTokenHash,
  revokeAllForUser,
};

export default Session;
