import Order from "../models/orderModel.js";
import Payment from "../models/paymentModel.js";
import { withTransaction } from "../lib/db/tx.js";
import { HttpError } from "../lib/http.js";
import { emitOrderEvent } from "../lib/events.js";
import { isDuplicateKeyError } from "../lib/idempotency.js";
import { requireObjectIdFormat } from "../lib/validation.js";

// The only order status COD payment creation may start from. Anything else
// is a conflict, not a silent transition.
const COD_CREATABLE_STATUS = "pending";

// Phase 4: the orderId is this operation's natural idempotency identity.
// Payment creation and the order status transition happen inside one
// transaction, and payments' unique `order_id` index is the database-level
// backstop against a concurrent duplicate producing two Payment rows.
export async function codCreate(orderId, userId) {
  requireObjectIdFormat(orderId, "orderId");
  let result;
  try {
    result = await withTransaction(async (conn) => {
      const order = await Order.findByIdForUpdate(conn, orderId);
      if (!order) throw new HttpError(404, "Order not found");
      // Ownership is checked before any payment data (existing or new) is
      // ever returned to the caller.
      if (order.user.toString() !== String(userId)) throw new HttpError(403, "Not authorized");

      const existingPayment = await Payment.findByOrder(order._id, conn);
      if (existingPayment) {
        // A COD payment already exists for this order (first creation, an
        // earlier retry, or a prior race past the unique index). Return it
        // as-is — never a second Payment row, and never rewrite the
        // order's status.
        return { order, payment: existingPayment, replayed: true };
      }

      if (order.status !== COD_CREATABLE_STATUS) {
        throw new HttpError(409, `Cannot create a COD payment for an order in status "${order.status}"`);
      }

      const payment = await Payment.create(
        { order: order._id, user: userId, method: "cod", amount: order.total, currency: order.currency || "BDT", status: "pending" },
        conn,
      );

      order.status = "processing";
      order.paymentMethod = "cod";
      await Order.saveOrderOnConnection(conn, order);

      // Phase 11 realtime-durability correction (kept from the original):
      // written INSIDE this same transaction — a genuine transactional
      // outbox for COD payment creation.
      await emitOrderEvent(orderId, { orderId, status: order.status }, { session: conn });

      return { order, payment, replayed: false };
    });
  } catch (err) {
    // Concurrent duplicate: another request's Payment insert committed
    // first (this transaction aborted on payments' unique `order_id`
    // index, so THIS attempt's order-status write never persisted).
    // Resolve to the winner's Payment/Order instead of a raw 500.
    if (isDuplicateKeyError(err, "uq_payments_order")) {
      const [order, payment] = await Promise.all([Order.findById(orderId), Payment.findByOrder(orderId)]);
      if (order && payment) {
        result = { order, payment, replayed: true };
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  return result.order;
}

export async function getPaymentByOrder(orderId, userId, role) {
  requireObjectIdFormat(orderId, "orderId");
  const payment = await Payment.findByOrder(orderId);
  if (!payment) throw new HttpError(404, "Payment not found");
  if (payment.user.toString() !== String(userId) && role !== "admin") {
    throw new HttpError(403, "Not authorized");
  }
  return payment;
}
