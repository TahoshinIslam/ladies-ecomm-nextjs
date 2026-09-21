import { query } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";
import { getOrganizationId } from "../lib/tenant.js";

function rowToPayment(row) {
  if (!row) return null;
  return {
    _id: row.id,
    order: row.order_id,
    user: row.customer_id,
    method: row.method,
    status: row.status,
    transactionId: row.transaction_id,
    amount: Number(row.amount),
    currency: row.currency,
    paidAt: row.paid_at,
    refundedAt: row.refunded_at,
    refundReason: row.refund_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findByOrder(orderId, conn) {
  const sql = "SELECT * FROM payments WHERE organization_id = ? AND order_id = ?";
  const params = [getOrganizationId(), orderId];
  const rows = conn ? (await conn.query(sql, params))[0] : await query(sql, params);
  return rowToPayment(rows[0]);
}

/** Insert inside the caller's transaction — the paymentModel unique `order_id` index is the DB-level backstop against a concurrent duplicate. */
async function create({ order, user, method, amount, currency, status }, conn) {
  const id = generateObjectId();
  await conn.query(
    `INSERT INTO payments (id, organization_id, order_id, customer_id, method, amount, currency, status, gateway_response)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, getOrganizationId(), order, user, method, amount, currency || "BDT", status || "pending", JSON.stringify({})],
  );
  return rowToPayment({ id, order_id: order, customer_id: user, method, amount, currency: currency || "BDT", status: status || "pending" });
}

/** Runs on the caller's transaction connection when `conn` is supplied, so this commits/rolls back atomically with the order-status write it always accompanies (see orderService.js's updateOrderStatus). Falls back to the shared pool for isolated/legacy callers. */
async function markCompletedForCod(orderId, conn) {
  const sql =
    "UPDATE payments SET status = 'completed', paid_at = NOW(3) WHERE organization_id = ? AND order_id = ? AND method = 'cod' AND status = 'pending'";
  const params = [getOrganizationId(), orderId];
  if (conn) {
    await conn.query(sql, params);
  } else {
    await query(sql, params);
  }
}

/** Marks a completed payment refunded — guarded so it only ever moves 'completed' -> 'refunded', never re-refunds or refunds a payment that never completed. Always runs on the caller's transaction connection, alongside the order-status write. */
async function markRefunded(conn, orderId, reason) {
  await conn.query(
    `UPDATE payments SET status = 'refunded', refunded_at = NOW(3), refund_reason = ?
      WHERE organization_id = ? AND order_id = ? AND status = 'completed'`,
    [reason || "", getOrganizationId(), orderId],
  );
}

const Payment = { findByOrder, create, markCompletedForCod, markRefunded };

export default Payment;
