import Order from "../models/orderModel.js";
import Payment from "../models/paymentModel.js";
import { HttpError } from "../lib/http.js";
import { emitOrderEvent } from "../lib/events.js";

const upsertPayment = async (orderId, userId, method, amount, currency = "BDT") => {
  let payment = await Payment.findOne({ order: orderId });
  if (!payment) {
    payment = await Payment.create({ order: orderId, user: userId, method, amount, currency, status: "pending" });
  } else {
    payment.method = method;
    payment.amount = amount;
    payment.currency = currency;
    payment.status = "pending";
    await payment.save();
  }
  return payment;
};

// The step CheckoutPage.jsx calls immediately after createOrder() for a COD
// order — it's what actually records the Payment row (method: "cod",
// status: "pending") that updateOrderStatus()'s "mark completed on
// delivery" step later looks for, and moves the order from "pending" to
// "processing" now that payment terms are confirmed. This endpoint didn't
// exist at all before — createOrder() succeeding but this 404ing is why
// checkout showed "Failed to place order" on an order that had, in fact,
// already been created.
export async function codCreate(orderId, userId) {
  const order = await Order.findById(orderId);
  if (!order) throw new HttpError(404, "Order not found");
  if (order.user.toString() !== String(userId)) throw new HttpError(403, "Not authorized");

  await upsertPayment(order._id, userId, "cod", order.total, order.currency || "BDT");
  order.status = "processing";
  order.paymentMethod = "cod";
  await order.save();
  emitOrderEvent(orderId, { orderId, status: order.status });
  return order;
}

export async function getPaymentByOrder(orderId, userId, role) {
  const payment = await Payment.findOne({ order: orderId });
  if (!payment) throw new HttpError(404, "Payment not found");
  if (payment.user.toString() !== String(userId) && role !== "admin") {
    throw new HttpError(403, "Not authorized");
  }
  return payment;
}
