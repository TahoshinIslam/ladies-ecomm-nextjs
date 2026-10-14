import Order from "../../models/orderModel.js";
import Coupon from "../../models/couponModel.js";
import CouponUsage from "../../models/couponUsageModel.js";
import * as Inventory from "../../models/inventoryModel.js";
import { withTransaction } from "../../lib/db/tx.js";
import { createAdminNotification } from "../notificationService.js";
import { HttpError } from "../../lib/http.js";
import { emitOrderEvent, emitAdminEvent } from "../../lib/events.js";
import { requireObjectIdFormat } from "../../lib/validation.js";
import { redactIdempotencyFields } from "./checkout.js";

/** A shopper's own orders: listing, reading and cancelling. */
export async function getMyOrders(userId) {
  const orders = await Order.findMyOrders(userId);
  // See redactIdempotencyFields()'s own comment: models/orderModel.js's
  // rowToOrder() hides nothing (a plain `SELECT *` has no concept of a
  // field that's hidden by default), so every order-model read includes
  // these two columns unless a caller strips them again here
  // — every externally-facing read (this list, getOrder() below, and
  // createOrder()'s own response) must, since these are for internal
  // replay-detection use only and were never meant to reach a client.
  return orders.map(redactIdempotencyFields);
}


export async function getOrder(userId, role, orderId) {
  requireObjectIdFormat(orderId, "orderId");
  const order = await Order.findById(orderId, { populateUser: true });
  if (!order) throw new HttpError(404, "Order not found");
  const isOwner = order.user._id.toString() === String(userId);
  if (!isOwner) throw new HttpError(403, "Not authorized");
  return redactIdempotencyFields(order);
}


// Used by cancelOrder() to restore stock and coupon usage inside the same
// transaction as the status write.
export async function restoreStockAndCoupon(conn, order) {
  // Cancelling before dispatch: the goods never left, so the reservation is
  // released and nothing is "put back". An order placed before inventory
  // existed has no reservations and releases nothing.
  await Inventory.releaseOrder(conn, order._id, "order cancelled");
  if (order.coupon) {
    // Symmetric with the global-usage rollback: cancelling an order
    // restores both the global usedCount AND the per-user usage count.
    // (This mirrors the FIRST-order promo's deliberately opposite
    // choice — claimFirstOrderPromo's flag is sticky and never restored
    // on cancel — but that is a distinct, separately-reasoned guarantee.)
    await Coupon.restoreGlobalUsage(conn, order.coupon);
    await CouponUsage.restorePerUserUsage(conn, order.coupon, order.user);
  }
}


export async function cancelOrder(userId, role, orderId) {
  requireObjectIdFormat(orderId, "orderId");
  const updatedOrder = await withTransaction(async (conn) => {
    const order = await Order.findByIdForUpdate(conn, orderId);
    if (!order) throw new HttpError(404, "Order not found");
    if (order.user.toString() !== String(userId)) {
      throw new HttpError(403, "Not authorized");
    }
    if (!["pending", "paid", "processing"].includes(order.status)) {
      throw new HttpError(400, `Cannot cancel an order in status "${order.status}"`);
    }
    await restoreStockAndCoupon(conn, order);
    order.status = "cancelled";
    await Order.saveOrderOnConnection(conn, order);

    const orderNumber = orderId.toString().slice(-6);
    await emitOrderEvent(orderId, { orderId, status: "cancelled" }, { session: conn });
    await emitAdminEvent(
      { type: "ORDER_CANCELLED", orderId: orderId.toString(), orderNumber, actorId: userId?.toString() },
      { session: conn },
    );

    return order;
  });

  const orderNumber = orderId.toString().slice(-6).toUpperCase();
  createAdminNotification({
    message: `Order #${orderNumber} was cancelled`,
    url: `/dashboard/orders/${orderId}`,
  }).catch(() => {});

  return updatedOrder;
}
