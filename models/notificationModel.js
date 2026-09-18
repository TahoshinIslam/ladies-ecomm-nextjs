import { withConnection, query } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";

function rowToNotification(row) {
  if (!row) return null;
  return {
    _id: row.id,
    recipient: row.recipient_id,
    message: row.message,
    url: row.url,
    readAt: row.read_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function insertMany(docs) {
  if (!docs.length) return;
  await withConnection(async (conn) => {
    for (const d of docs) {
      await conn.query("INSERT INTO notifications (id, recipient_id, message, url) VALUES (?, ?, ?, ?)", [
        generateObjectId(),
        d.recipient,
        d.message,
        d.url || "",
      ]);
    }
  });
}

async function create({ recipient, message, url }) {
  const id = generateObjectId();
  await query("INSERT INTO notifications (id, recipient_id, message, url) VALUES (?, ?, ?, ?)", [id, recipient, message, url || ""]);
  return rowToNotification({ id, recipient_id: recipient, message, url: url || "", created_at: new Date() });
}

async function findByRecipient(userId, { unreadOnly = false, skip = 0, limit = 20 } = {}) {
  const unreadClause = unreadOnly ? "AND read_at IS NULL" : "";
  const rows = await query(
    `SELECT * FROM notifications WHERE recipient_id = ? ${unreadClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [userId, Number(limit), Number(skip)],
  );
  return rows.map(rowToNotification);
}

async function countByRecipient(userId, { unreadOnly = false } = {}) {
  const unreadClause = unreadOnly ? "AND read_at IS NULL" : "";
  const rows = await query(`SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? ${unreadClause}`, [userId]);
  return rows[0].n;
}

async function markRead(id, userId) {
  const result = await query("UPDATE notifications SET read_at = NOW(3) WHERE id = ? AND recipient_id = ?", [id, userId]);
  if (result.affectedRows === 0) return null;
  const rows = await query("SELECT * FROM notifications WHERE id = ?", [id]);
  return rowToNotification(rows[0]);
}

async function markAllRead(userId) {
  await query("UPDATE notifications SET read_at = NOW(3) WHERE recipient_id = ? AND read_at IS NULL", [userId]);
}

const Notification = { insertMany, create, findByRecipient, countByRecipient, markRead, markAllRead };

export default Notification;
