import Order from "../../models/orderModel.js";
import Payment from "../../models/paymentModel.js";
import { withTransaction } from "../../lib/db/tx.js";
import { createAdminNotification, createUserNotification } from "../notificationService.js";
import { HttpError } from "../../lib/http.js";
import { emitOrderEvent, emitAdminEvent } from "../../lib/events.js";
import { requireObjectIdFormat } from "../../lib/validation.js";
import { redactIdempotencyFields } from "./checkout.js";
import { restoreStockAndCoupon } from "./customerOrders.js";

/** Order status changes made by the store, and the messages shoppers get for them. */
const CUSTOMER_STATUS_MESSAGE = {
  paid: (n) => `Payment confirmed for order #${n}`,
  processing: (n) => `Order #${n} is being processed`,
  shipped: (n) => `Order #${n} has shipped`,
  delivered: (n) => `Order #${n} was delivered`,
  cancelled: (n) => `Order #${n} was cancelled`,
  refunded: (n) => `Order #${n} was refunded`,
};



export async function getAllOrders({ status, search, sortBy, sortOrder, page = 1, limit = 20 }) {
  const pageNum = Number(page);
  const limitNum = Number(limit);
  const skip = (pageNum - 1) * limitNum;
  const { orders, total } = await Order.findAdminList({ status, search, sortBy, sortOrder, skip, limit: limitNum });
  return {
    total,
    page: pageNum,
    pages: Math.max(1, Math.ceil(total / limitNum)),
    count: orders.length,
    // See getMyOrders()'s own comment — same redaction, same reason.
    orders: orders.map(redactIdempotencyFields),
  };
}


const ORDER_STATUS_TRANSITIONS = {
  pending: ["paid", "processing", "shipped", "cancelled"],
  paid: ["processing", "shipped", "cancelled", "refunded"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};


function isOrderStatusTransitionAllowed(from, to) {
  if (from === to) return true;
  return (ORDER_STATUS_TRANSITIONS[from] || []).includes(to);
}


// Previously a plain findById() -> mutate -> order.save(), with no row lock
// and no transaction — two concurrent admin requests (e.g. one setting
// "shipped", another concurrently setting "cancelled") could both read the
// same starting status, both pass isOrderStatusTransitionAllowed(), and the
// last UPDATE would silently win with no side effects re-evaluated against
// the actual final state. Now mirrors cancelOrder()'s pattern: a single
// transaction holds a row lock (SELECT ... FOR UPDATE) across the read,
// the transition check, the write, and every side effect that must commit
// or roll back with it — so a losing concurrent request fails with a clear
// 409 against the row's real current status instead of clobbering it.
export async function updateOrderStatus(orderId, { status, trackingNumber }) {
  requireObjectIdFormat(orderId, "orderId");

  const { order, changed } = await withTransaction(async (conn) => {
    const current = await Order.findByIdForUpdate(conn, orderId);
    if (!current) throw new HttpError(404, "Order not found");

    if (!isOrderStatusTransitionAllowed(current.status, status)) {
      throw new HttpError(409, `Cannot change order status from "${current.status}" to "${status}"`);
    }

    const isSameStatus = current.status === status;
    const trackingChanged = !!trackingNumber && trackingNumber !== current.trackingNumber;

    if (isSameStatus && !trackingChanged) {
      return { order: current, changed: false };
    }

    if (!isSameStatus) current.status = status;
    if (trackingChanged) current.trackingNumber = trackingNumber;
    if (!isSameStatus && status === "delivered") current.deliveredAt = new Date();

    // Coordinate with the side effects each destination status requires,
    // inside the same lock/transaction as the status write itself — never
    // as a separate, unguarded follow-up query.
    if (!isSameStatus && status === "cancelled") {
      await restoreStockAndCoupon(conn, current);
    }

    await Order.saveOrderOnConnection(conn, current);

    // Delivery does not mark the payment collected — the dashboard records
    // collections explicitly (ecom_erp order-payment.service.js). A refund
    // only touches a payment that was completed (Payment.markRefunded).
    if (!isSameStatus && status === "refunded") {
      await Payment.markRefunded(conn, current._id, "Marked refunded by admin status change");
    }

    // Transactional outbox, same discipline as cancelOrder()/createOrder():
    // written inside this transaction so it's atomic with the status write
    // (and everything else above) rather than a best-effort afterthought.
    await emitOrderEvent(orderId, { orderId, status, trackingNumber: current.trackingNumber }, { session: conn });
    if (!isSameStatus) {
      const orderNumber = orderId.toString().slice(-6);
      await emitAdminEvent(
        { type: "ORDER_STATUS_CHANGED", orderId: orderId.toString(), orderNumber, status },
        { session: conn },
      );
    }

    return { order: current, changed: true };
  });

  if (!changed) return { order, changed: false };

  const orderNumber = orderId.toString().slice(-6).toUpperCase();
  if (["cancelled", "refunded"].includes(status)) {
    createAdminNotification({
      message: `Order #${orderNumber} marked as ${status}`,
      url: `/dashboard/orders/${orderId}`,
    }).catch(() => {});
  }

  const customerMessage = CUSTOMER_STATUS_MESSAGE[status];
  if (customerMessage) {
    createUserNotification({
      recipient: order.user,
      message: customerMessage(orderNumber),
      url: `/orders/${orderId}`,
    }).catch(() => {});
  }

  return { order, changed: true };
}
