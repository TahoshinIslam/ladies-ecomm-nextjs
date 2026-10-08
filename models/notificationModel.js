import { withConnection, query } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import { getOrganizationId } from "../lib/tenant.js";

/**
 * `notifications` is shared with the dashboard, which also notifies staff, so
 * every row carries a `recipient_type` saying which table its `recipient_id`
 * points into — `customers` or `users`.
 *
 * Every read here pins it to 'customer'. Without that a shopper could be
 * handed a staff member's notification whose id happened to match theirs,
 * and `markAllRead` would mark it read on their behalf.
 *
 * Writes are the exception: `insertMany` is how the storefront tells the
 * shop's staff that an order came in, so it takes the type rather than
 * assuming it.
 */
const CUSTOMER_SCOPE = "organization_id = ? AND recipient_type = 'customer'";

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

async function insertMany(docs, recipientType = "customer") {
  if (!docs.length) return;
  if (recipientType !== "customer" && recipientType !== "staff") {
    throw new Error(`notificationModel: unknown recipient type "${recipientType}"`);
  }
  await withConnection(async (conn) => {
    for (const d of docs) {
      await conn.query(
        `INSERT INTO notifications (id, organization_id, recipient_type, recipient_id, message, url)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [generateObjectId(), getOrganizationId(), recipientType, d.recipient, d.message, d.url || ""],
      );
    }
  });
}

async function create({ recipient, message, url }) {
  const id = generateObjectId();
  await query(
    `INSERT INTO notifications (id, organization_id, recipient_type, recipient_id, message, url)
     VALUES (?, ?, 'customer', ?, ?, ?)`,
    [id, getOrganizationId(), recipient, message, url || ""],
  );
  return rowToNotification({ id, recipient_id: recipient, message, url: url || "", created_at: new Date() });
}

async function findByRecipient(userId, { unreadOnly = false, skip = 0, limit = 20 } = {}) {
  const unreadClause = unreadOnly ? "AND read_at IS NULL" : "";
  const rows = await query(
    `SELECT * FROM notifications WHERE ${CUSTOMER_SCOPE} AND recipient_id = ? ${unreadClause}
      ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [getOrganizationId(), userId, Number(limit), Number(skip)],
  );
  return rows.map(rowToNotification);
}

async function countByRecipient(userId, { unreadOnly = false } = {}) {
  const unreadClause = unreadOnly ? "AND read_at IS NULL" : "";
  const rows = await query(
    `SELECT COUNT(*) AS n FROM notifications WHERE ${CUSTOMER_SCOPE} AND recipient_id = ? ${unreadClause}`,
    [getOrganizationId(), userId],
  );
  return rows[0].n;
}

async function markRead(id, userId) {
  const result = await query(
    `UPDATE notifications SET read_at = NOW(3) WHERE ${CUSTOMER_SCOPE} AND id = ? AND recipient_id = ?`,
    [getOrganizationId(), id, userId],
  );
  if (result.affectedRows === 0) return null;
  const rows = await query(`SELECT * FROM notifications WHERE ${CUSTOMER_SCOPE} AND id = ?`, [
    getOrganizationId(),
    id,
  ]);
  return rowToNotification(rows[0]);
}

async function markAllRead(userId) {
  await query(
    `UPDATE notifications SET read_at = NOW(3) WHERE ${CUSTOMER_SCOPE} AND recipient_id = ? AND read_at IS NULL`,
    [getOrganizationId(), userId],
  );
}

const Notification = { insertMany, create, findByRecipient, countByRecipient, markRead, markAllRead };

export default Notification;
