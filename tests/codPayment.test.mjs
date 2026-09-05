// Phase 1: Cash-on-Delivery payment — the only payment method actually
// shipped (see the Phase 0B/0 investigation's payment UI-vs-server section).
// Traced from services/paymentService.js's codCreate()/getPaymentByOrder()
// and their Route Handlers, app/api/payments/{cod/[orderId],order/[orderId]}/route.js.
//
// Phase 4 rewrite: codCreate() is no longer two non-atomic writes with no
// status guard. It now runs inside one Mongoose transaction — an existing
// Payment for the order is returned as-is (no second row, no order-status
// rewrite, regardless of how far the order has since progressed), and an
// order with NO existing Payment may only move pending -> processing (any
// other current status is a controlled 409 conflict, never a silent
// regression). This file's "DOCUMENTED LIMITATION" tests from Phase 1 are
// replaced with tests of that corrected behavior, plus new coverage for
// concurrency and deterministic rollback (Phase 4 spec sections I/K).

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

  function codRequest(orderId, session) {
    return requestAs({ method: "POST", url: `http://test/api/payments/cod/${orderId}`, session });
  }

  test("the order's owner can create a COD payment; order status moves pending -> processing", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);
      assert.equal(order.status, "pending");

      const res = await codPOST(codRequest(order._id, await createTestSession(buyer._id)), { params: Promise.resolve({ orderId: order._id }) });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.order.status, "processing");
      assert.equal(json.order.paymentMethod, "cod");

      const payments = await Payment.find({ order: order._id });
      assert.equal(payments.length, 1);
      assert.equal(payments[0].status, "pending");
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
      const res = await codPOST(codRequest(order._id, await createTestSession(stranger._id)), { params: Promise.resolve({ orderId: order._id }) });
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
      const res = await codPOST(codRequest(fakeId, await createTestSession(buyer._id)), { params: Promise.resolve({ orderId: fakeId }) });
      assert.equal(res.status, 404);
    } finally {
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("CORRECTED: an order without a Payment yet, in any status other than pending, is a controlled 409 conflict — never a silent status rewrite", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);
      await Order.updateOne({ _id: order._id }, { $set: { status: "delivered" } });

      const res = await codPOST(codRequest(order._id, await createTestSession(buyer._id)), { params: Promise.resolve({ orderId: order._id }) });
      assert.equal(res.status, 409, "codCreate() now guards the order's current status before creating a first Payment");
      const after_ = await Order.findById(order._id);
      assert.equal(after_.status, "delivered", "the order status must be untouched by the rejected attempt");
      assert.equal(await Payment.findOne({ order: order._id }), null, "no Payment must have been created for the rejected attempt");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("CORRECTED: a cancelled order with no Payment yet is rejected (409), stays cancelled", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);
      await Order.updateOne({ _id: order._id }, { $set: { status: "cancelled" } });

      const res = await codPOST(codRequest(order._id, await createTestSession(buyer._id)), { params: Promise.resolve({ orderId: order._id }) });
      assert.equal(res.status, 409);
      const after_ = await Order.findById(order._id);
      assert.equal(after_.status, "cancelled");
      assert.equal(await Payment.findOne({ order: order._id }), null);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("duplicate COD requests for the same order return the SAME Payment — exactly one Payment document ever exists, order status set only once", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);
      const fire = async () => codPOST(codRequest(order._id, await createTestSession(buyer._id)), { params: Promise.resolve({ orderId: order._id }) });

      const first = await fire();
      assert.equal(first.status, 200);
      const firstJson = await first.json();

      const second = await fire();
      assert.equal(second.status, 200, "a second identical request does not error");
      const secondJson = await second.json();
      assert.equal(secondJson.order.status, "processing");

      const payments = await Payment.find({ order: order._id });
      assert.equal(payments.length, 1, "exactly one Payment row ever exists per order, enforced by paymentModel's unique `order` index");
      assert.equal(String(firstJson.order._id), String(secondJson.order._id));
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("duplicate after shipped: a retry against a shipped order with an existing Payment returns that Payment, shipped remains shipped", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);
      await codPOST(codRequest(order._id, await createTestSession(buyer._id)), { params: Promise.resolve({ orderId: order._id }) });
      const originalPayment = await Payment.findOne({ order: order._id });
      await Order.updateOne({ _id: order._id }, { $set: { status: "shipped" } });

      const res = await codPOST(codRequest(order._id, await createTestSession(buyer._id)), { params: Promise.resolve({ orderId: order._id }) });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.order.status, "shipped", "shipped must remain shipped — no regression to processing");

      const payments = await Payment.find({ order: order._id });
      assert.equal(payments.length, 1);
      assert.equal(String(payments[0]._id), String(originalPayment._id));
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("duplicate after delivered: a retry against a delivered order with an existing Payment returns that Payment, delivered never regresses", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);
      await codPOST(codRequest(order._id, await createTestSession(buyer._id)), { params: Promise.resolve({ orderId: order._id }) });
      await Order.updateOne({ _id: order._id }, { $set: { status: "delivered", deliveredAt: new Date() } });

      const res = await codPOST(codRequest(order._id, await createTestSession(buyer._id)), { params: Promise.resolve({ orderId: order._id }) });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.order.status, "delivered", "delivered must never regress back to processing on a COD retry");

      assert.equal((await Payment.find({ order: order._id })).length, 1);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("concurrent duplicate COD requests for a brand-new order: exactly one Payment, one pending->processing transition, no duplicate-key 500", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);
      // Build two independent authenticated requests (separate sessions are
      // unnecessary — this is the same user firing twice at once, which is
      // exactly the double-click/duplicate-request scenario) that both race
      // against the same brand-new order.
      const session = await createTestSession(buyer._id);
      const req1 = requestAs({ method: "POST", url: `http://test/api/payments/cod/${order._id}`, session });
      const req2 = requestAs({ method: "POST", url: `http://test/api/payments/cod/${order._id}`, session });

      const [res1, res2] = await Promise.all([
        codPOST(req1, { params: Promise.resolve({ orderId: order._id }) }),
        codPOST(req2, { params: Promise.resolve({ orderId: order._id }) }),
      ]);

      assert.ok([res1.status, res2.status].every((s) => s === 200), "neither concurrent request may surface a raw duplicate-key 500");
      const [json1, json2] = await Promise.all([res1.json(), res2.json()]);
      assert.equal(json1.order.status, "processing");
      assert.equal(json2.order.status, "processing");

      const payments = await Payment.find({ order: order._id });
      assert.equal(payments.length, 1, "concurrent duplicate COD creation must still leave exactly one Payment row");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("DETERMINISTIC ROLLBACK: if the Order status write fails after the Payment write, the transaction leaves NO Payment behind", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const order = await makeOrder(buyer, product);

      // Deterministically force order.save() to fail INSIDE codCreate()'s
      // transaction, strictly after Payment.create() has already run in
      // that same (still-uncommitted) transaction — a real, test-controlled
      // failure of "the Order half of the transaction fails", not just a
      // documented possibility. Restored in `finally` no matter what.
      const originalSave = Order.prototype.save;
      Order.prototype.save = function patchedSave(...args) {
        if (String(this._id) === String(order._id)) {
          Order.prototype.save = originalSave;
          return Promise.reject(new Error("Simulated Order.save failure for deterministic rollback test"));
        }
        return originalSave.apply(this, args);
      };

      // lib/http.js's toResponse() deliberately console.error()s any
      // non-HttpError before turning it into a 500 — expected, real
      // behavior here (this failure IS forced), not something CI should
      // read as an unexpected crash. Narrowly mocked for just this one
      // call, and asserted to have actually fired, rather than either
      // letting it print noise into CI logs or silently swallowing it.
      const originalConsoleError = console.error;
      let consoleErrorCalls = 0;
      console.error = (...args) => {
        consoleErrorCalls += 1;
        void args;
      };
      try {
        const res = await codPOST(codRequest(order._id, await createTestSession(buyer._id)), { params: Promise.resolve({ orderId: order._id }) });
        assert.equal(res.status, 500, "the forced save failure surfaces as a server error, not a silently-swallowed partial write");
      } finally {
        console.error = originalConsoleError;
        Order.prototype.save = originalSave;
      }
      assert.equal(consoleErrorCalls, 1, "the forced failure must actually reach lib/http.js's error-logging path exactly once");

      const persisted = await Order.findById(order._id);
      assert.equal(persisted.status, "pending", "the order must remain in its prior status after the transaction rolled back");
      assert.equal(persisted.total, order.total, "the order's own fields must be unaffected by the aborted in-transaction mutation");
      assert.equal(await Payment.findOne({ order: order._id }), null, "no Payment may remain when the Order half of the transaction failed");
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
      await codPOST(codRequest(order._id, await createTestSession(buyer._id)), { params: Promise.resolve({ orderId: order._id }) });

      const ownerRes = await orderPaymentGET(requestAs({ method: "GET", url: `http://test/api/payments/order/${order._id}`, session: await createTestSession(buyer._id) }), {
        params: Promise.resolve({ orderId: order._id }),
      });
      assert.equal(ownerRes.status, 200);
      const ownerJson = await ownerRes.json();
      assert.ok(!("gatewayResponse" in (ownerJson.payment || ownerJson)), "internal gatewayResponse must remain excluded by default");

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
