// Phase 1: Cash-on-Delivery payment — the only payment method actually
// shipped (see the Phase 0B/0 investigation's payment UI-vs-server section).
// Traced from services/paymentService.js's codCreate()/getPaymentByOrder()
// and their Route Handlers, app/api/payments/{cod/[orderId],order/[orderId]}/route.js.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  createTestSession,
  requestAs,
  createTestUser,
  createTestProduct,
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("COD payment: POST /api/payments/cod/[orderId], GET /api/payments/order/[orderId]", { skip: !canRun && reason }, () => {
  let codPOST, orderPaymentGET, createOrderPOST;
  let Order, Payment, Product, User;

  before(async () => {
    await connectTestDb();
    ({ POST: codPOST } = await import("../app/api/payments/cod/[orderId]/route.js"));
    ({ GET: orderPaymentGET } = await import("../app/api/payments/order/[orderId]/route.js"));
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ default: Order } = await import("../models/orderModel.js"));
    ({ default: Payment } = await import("../models/paymentModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ default: User } = await import("../models/userModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  async function makeOrder(buyer, product) {
    const res = await createOrderPOST(
      requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
        body: {
          items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
          shippingAddress: {
            fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh",
          },
        },
      }),
    );
    return (await res.json()).order;
  }

  test("the order's owner can create a COD payment; order status moves pending -> processing", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);
      assert.equal(order.status, "pending");

      const req = requestAs({ method: "POST", url: `http://test/api/payments/cod/${order._id}`, session: await createTestSession(buyer._id) });
      const res = await codPOST(req, { params: Promise.resolve({ orderId: order._id }) });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.order.status, "processing", "codCreate() unconditionally transitions pending -> processing");
      assert.equal(json.order.paymentMethod, "cod");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("a non-owner is rejected (403) and the order is left untouched", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const stranger = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);
      const req = requestAs({ method: "POST", url: `http://test/api/payments/cod/${order._id}`, session: await createTestSession(stranger._id) });
      const res = await codPOST(req, { params: Promise.resolve({ orderId: order._id }) });
      assert.equal(res.status, 403);

      const unchanged = await Order.findById(order._id);
      assert.equal(unchanged.status, "pending");
      assert.equal(await Payment.findOne({ order: order._id }), null);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [buyer._id, stranger._id] } });
    }
  });

  test("a missing order is rejected (404)", async () => {
    const buyer = await createTestUser({ role: "customer" });
    try {
      const fakeId = "507f1f77bcf86cd799439011";
      const req = requestAs({ method: "POST", url: `http://test/api/payments/cod/${fakeId}`, session: await createTestSession(buyer._id) });
      const res = await codPOST(req, { params: Promise.resolve({ orderId: fakeId }) });
      assert.equal(res.status, 404);
    } finally {
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("DOCUMENTED LIMITATION: codCreate() does not validate the order's current status — an already-delivered or cancelled order can still be moved to 'processing'", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);
      await Order.updateOne({ _id: order._id }, { $set: { status: "delivered" } });

      const req = requestAs({ method: "POST", url: `http://test/api/payments/cod/${order._id}`, session: await createTestSession(buyer._id) });
      const res = await codPOST(req, { params: Promise.resolve({ orderId: order._id }) });
      assert.equal(
        res.status,
        200,
        "confirmed: services/paymentService.js's codCreate() has no order.status guard at all — this succeeds even though the order was already 'delivered'",
      );
      const after_ = await Order.findById(order._id);
      assert.equal(after_.status, "processing", "an already-delivered order was silently regressed back to 'processing'");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("duplicate COD requests for the same order upsert — exactly one Payment document ever exists (enforced by both application logic and the unique index)", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);
      const fire = async () =>
        codPOST(requestAs({ method: "POST", url: `http://test/api/payments/cod/${order._id}`, session: await createTestSession(buyer._id) }), {
          params: Promise.resolve({ orderId: order._id }),
        });

      assert.equal((await fire()).status, 200);
      assert.equal((await fire()).status, 200, "a second identical request does not error");

      const payments = await Payment.find({ order: order._id });
      assert.equal(payments.length, 1, "upsertPayment()'s findOne-then-update, backstopped by paymentModel's unique `order` index, guarantees exactly one Payment row per order");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("payment lookup ownership: owner and admin can GET the payment, a stranger cannot (403)", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const stranger = await createTestUser({ role: "customer" });
    const admin = await createTestUser({ role: "admin" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);
      await codPOST(requestAs({ method: "POST", url: `http://test/api/payments/cod/${order._id}`, session: await createTestSession(buyer._id) }), {
        params: Promise.resolve({ orderId: order._id }),
      });

      const ownerRes = await orderPaymentGET(requestAs({ method: "GET", url: `http://test/api/payments/order/${order._id}`, session: await createTestSession(buyer._id) }), {
        params: Promise.resolve({ orderId: order._id }),
      });
      assert.equal(ownerRes.status, 200);

      const strangerRes = await orderPaymentGET(
        requestAs({ method: "GET", url: `http://test/api/payments/order/${order._id}`, session: await createTestSession(stranger._id) }),
        { params: Promise.resolve({ orderId: order._id }) },
      );
      assert.equal(strangerRes.status, 403);

      const adminRes = await orderPaymentGET(requestAs({ method: "GET", url: `http://test/api/payments/order/${order._id}`, session: await createTestSession(admin._id) }), {
        params: Promise.resolve({ orderId: order._id }),
      });
      assert.equal(adminRes.status, 200);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [buyer._id, stranger._id, admin._id] } });
    }
  });

  test("unauthenticated COD request is rejected (401)", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);
      const req = requestAs({ method: "POST", url: `http://test/api/payments/cod/${order._id}` });
      const res = await codPOST(req, { params: Promise.resolve({ orderId: order._id }) });
      assert.equal(res.status, 401);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });
});

// NOT covered by an executable test in this file: "transaction failure
// behavior" for codCreate(). services/paymentService.js's codCreate() does
// NOT use a Mongoose session/transaction — it performs upsertPayment()
// and order.save() as two separate, non-atomic writes. A process crash or
// DB error between those two calls could leave a Payment row recorded
// without the matching order.status update (or vice versa). Simulating
// that mid-write failure deterministically is out of scope for this pass;
// this is a documented code-level observation (see
// services/paymentService.js:28-38), not a verified reproduction.
