import { query } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";

function rowToPayment(row) {
  if (!row) return null;
  return {
    _id: row.id,
    order: row.order_id,
    user: row.user_id,
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
  const sql = "SELECT * FROM payments WHERE order_id = ?";
  const rows = conn ? (await conn.query(sql, [orderId]))[0] : await query(sql, [orderId]);
  return rowToPayment(rows[0]);
}

/** Insert inside the caller's transaction — the paymentModel unique `order_id` index is the DB-level backstop against a concurrent duplicate. */
async function create({ order, user, method, amount, currency, status }, conn) {
  const id = generateObjectId();
  await conn.query(
    "INSERT INTO payments (id, order_id, user_id, method, amount, currency, status, gateway_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, order, user, method, amount, currency || "BDT", status || "pending", JSON.stringify({})],
  );
  return rowToPayment({ id, order_id: order, user_id: user, method, amount, currency: currency || "BDT", status: status || "pending" });
}

async function markCompletedForCod(orderId) {
  await query(
    "UPDATE payments SET status = 'completed', paid_at = NOW(3) WHERE order_id = ? AND method = 'cod' AND status = 'pending'",
    [orderId],
  );
}

const Payment = { findByOrder, create, markCompletedForCod };

export default Payment;
