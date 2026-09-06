import mongoose from "mongoose";

import Order from "../models/orderModel.js";
import Payment from "../models/paymentModel.js";
import { HttpError } from "../lib/http.js";
import { emitOrderEvent } from "../lib/events.js";
import { isDuplicateKeyError } from "../lib/idempotency.js";
import { requireObjectIdFormat } from "../lib/validation.js";

// The only order status COD payment creation may start from. Anything else
// (already processing/shipped/delivered/cancelled/refunded, or an
// inconsistent non-pending order with no Payment yet) is a conflict, not a
// silent transition — see codCreate() below.
const COD_CREATABLE_STATUS = "pending";

// The step CheckoutPage.jsx calls immediately after createOrder() for a COD
// order — it's what actually records the Payment row (method: "cod",
// status: "pending") that updateOrderStatus()'s "mark completed on
// delivery" step later looks for, and moves the order from "pending" to
// "processing" now that payment terms are confirmed.
//
// Phase 4: the orderId is this operation's natural idempotency identity —
// no separate Idempotency-Key header is needed here (unlike order
// creation, which has no other unique-per-checkout-intent identifier).
// Payment creation and the order status transition happen inside one
// Mongoose transaction, and paymentModel.js's unique `order` index is the
// database-level backstop against a concurrent duplicate producing two
// Payment rows.
export async function codCreate(orderId, userId) {
  requireObjectIdFormat(orderId, "orderId");
  const session = await mongoose.startSession();
  try {
    let result;
    try {
      await session.withTransaction(async () => {
        const order = await Order.findById(orderId).session(session);
        if (!order) throw new HttpError(404, "Order not found");
        // Ownership is checked before any payment data (existing or new) is
        // ever returned to the caller.
        if (order.user.toString() !== String(userId)) throw new HttpError(403, "Not authorized");

        const existingPayment = await Payment.findOne({ order: order._id }).session(session);
        if (existingPayment) {
          // A COD payment already exists for this order (first creation,
          // an earlier retry, or the process having raced past the unique
          // index below on a prior attempt). Return it as-is — never a
          // second Payment row, and never rewrite the order's status,
          // however far it has since progressed (shipped/delivered/
          // cancelled all leave both documents untouched here).
          result = { order, payment: existingPayment, replayed: true };
          return;
        }

        if (order.status !== COD_CREATABLE_STATUS) {
          // No Payment exists yet, but the order isn't in the one status
          // COD creation may start from — either it legitimately moved on
          // through some other path, or it's an inconsistent state (e.g. an
          // admin manually changed status before COD was ever created).
          // Either way: a controlled conflict, not a silent status rewrite.
          throw new HttpError(409, `Cannot create a COD payment for an order in status "${order.status}"`);
        }

        const [payment] = await Payment.create(
          [
            {
              order: order._id,
              user: userId,
              method: "cod",
              amount: order.total,
              currency: order.currency || "BDT",
              status: "pending",
            },
          ],
          { session },
        );

        order.status = "processing";
        order.paymentMethod = "cod";
        await order.save({ session });

        result = { order, payment, replayed: false };
      });
    } catch (err) {
      // Concurrent duplicate: another request's Payment.create() committed
      // first (this transaction aborted on paymentModel's unique `order`
      // index, so THIS attempt's order-status write never persisted).
      // Resolve to the winner's Payment/Order instead of a raw 500.
      if (isDuplicateKeyError(err, "order")) {
        const [order, payment] = await Promise.all([
          Order.findById(orderId),
          Payment.findOne({ order: orderId }),
        ]);
        if (order && payment) {
          result = { order, payment, replayed: true };
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    if (!result.replayed) {
      emitOrderEvent(orderId, { orderId, status: result.order.status }).catch(() => {});
    }
    return result.order;
  } finally {
    await session.endSession();
  }
}

export async function getPaymentByOrder(orderId, userId, role) {
  requireObjectIdFormat(orderId, "orderId");
  const payment = await Payment.findOne({ order: orderId });
  if (!payment) throw new HttpError(404, "Payment not found");
  if (payment.user.toString() !== String(userId) && role !== "admin") {
    throw new HttpError(403, "Not authorized");
  }
  return payment;
}
