import { query } from "../config/db.js";

// See models/README-migration.md. `id` is a plain AUTO_INCREMENT BIGINT
// here (not the usual 24-hex ObjectId-format string) — see sql/schema.sql's
// header comment for why: this table's whole job is a real monotonic
// cursor for SSE polling, which AUTO_INCREMENT gives natively, and no
// external reference or "order number"-style display ever depends on an
// event's id looking like an ObjectId.

function rowToEvent(row) {
  if (!row) return null;
  return {
    _id: row.id,
    channel: row.channel,
    type: row.type,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** Inserts one event. Pass `conn` (a mysql2 PoolConnection) to join a caller's transaction — omit for a standalone, non-transactional insert. */
async function create({ channel, type, payload, expiresAt }, conn) {
  const sql = "INSERT INTO events (channel, type, payload, expires_at) VALUES (?, ?, ?, ?)";
  const params = [channel, type, JSON.stringify(payload ?? {}), expiresAt];
  const result = conn ? (await conn.query(sql, params))[0] : await query(sql, params);
  return rowToEvent({
    id: result.insertId,
    channel,
    type,
    payload: JSON.stringify(payload ?? {}),
    created_at: new Date(),
    expires_at: expiresAt,
  });
}

async function findSince(channel, afterId, limit) {
  const rows = afterId
    ? await query("SELECT * FROM events WHERE channel = ? AND id > ? ORDER BY id ASC LIMIT ?", [channel, afterId, limit])
    : await query("SELECT * FROM events WHERE channel = ? ORDER BY id ASC LIMIT ?", [channel, limit]);
  return rows.map(rowToEvent);
}

async function existsInChannel(id, channel) {
  const rows = await query("SELECT 1 FROM events WHERE id = ? AND channel = ? LIMIT 1", [id, channel]);
  return rows.length > 0;
}

async function findLatestId(channel) {
  const rows = await query("SELECT id FROM events WHERE channel = ? ORDER BY id DESC LIMIT 1", [channel]);
  return rows[0]?.id ?? null;
}

const Event = { create, findSince, existsInChannel, findLatestId };

export default Event;
