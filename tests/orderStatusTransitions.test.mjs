// Phase 5B — PUT /api/orders/[id]/status validation and transition
// contract. Previously entirely unvalidated (no schema, no transition
// guard, no ObjectId format check) and untested anywhere in this repo.

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

describe("PUT /api/orders/[id]/status — validation and transition contract", { skip: !canRun && reason }, () => {
  let statusPUT, createOrderPOST;
  let Order, User, Product, Payment;

  before(async () => {
    await connectTestDb();
    ({ PUT: statusPUT } = await import("../app/api/orders/[id]/status/route.js"));
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ default: Order } = await import("../models/orderModel.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ default: Payment } = await import("../models/paymentModel.js"));
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
          shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" },
        },
      }),
    );
    return (await res.json()).order;
  }

  async function setStatus(admin, orderId, body) {
    return statusPUT(
      requestAs({ method: "PUT", url: `http://test/api/orders/${orderId}/status`, session: await createTestSession(admin._id), body }),
      { params: Promise.resolve({ id: orderId }) },
    );
  }

  test("a valid forward transition (pending -> processing) succeeds", async () => {
    const admin = await createTestUser({ role: "admin" });
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const order = await makeOrder(buyer, product);
      const res = await setStatus(admin, order._id, { status: "processing" });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.order.status, "processing");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
    }
  });

  test("re-submitting the SAME status is idempotent (no-op, still 200)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const order = await makeOrder(buyer, product);
      await setStatus(admin, order._id, { status: "processing" });
      const res = await setStatus(admin, order._id, { status: "processing" });
      assert.equal(res.status, 200);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
    }
  });

  test("FIXED: a delivered order can never regress to processing (409, not a silent rewrite)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const order = await makeOrder(buyer, product);
      await setStatus(admin, order._id, { status: "processing" });
      await setStatus(admin, order._id, { status: "shipped" });
      const toDelivered = await setStatus(admin, order._id, { status: "delivered" });
      assert.equal(toDelivered.status, 200);

      const regress = await setStatus(admin, order._id, { status: "processing" });
      assert.equal(regress.status, 409);
      const persisted = await Order.findById(order._id);
      assert.equal(persisted.status, "delivered", "delivered must remain unchanged after a rejected regression attempt");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
    }
  });

  test("FIXED: a cancelled order can never be moved to any other status (409)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const order = await makeOrder(buyer, product);
      await setStatus(admin, order._id, { status: "cancelled" });
      const res = await setStatus(admin, order._id, { status: "processing" });
      assert.equal(res.status, 409);
      const persisted = await Order.findById(order._id);
      assert.equal(persisted.status, "cancelled");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
    }
  });

  test("FIXED: a shipped order cannot skip backward to pending (409)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const order = await makeOrder(buyer, product);
      await setStatus(admin, order._id, { status: "processing" });
      await setStatus(admin, order._id, { status: "shipped" });
      const res = await setStatus(admin, order._id, { status: "pending" });
      assert.equal(res.status, 409);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
    }
  });

  test("missing status -> 400", async () => {
    const admin = await createTestUser({ role: "admin" });
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const order = await makeOrder(buyer, product);
      const res = await setStatus(admin, order._id, {});
      assert.equal(res.status, 400);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
    }
  });

  test("an unknown status value -> 400", async () => {
    const admin = await createTestUser({ role: "admin" });
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const order = await makeOrder(buyer, product);
      const res = await setStatus(admin, order._id, { status: "not-a-real-status" });
      assert.equal(res.status, 400);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
    }
  });

  test("an array value for status -> 400", async () => {
    const admin = await createTestUser({ role: "admin" });
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const order = await makeOrder(buyer, product);
      const res = await setStatus(admin, order._id, { status: ["processing", "shipped"] });
      assert.equal(res.status, 400);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
    }
  });

  test("wrong-case status ('Processing') is rejected (case normalization is not a documented behavior here)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const order = await makeOrder(buyer, product);
      const res = await setStatus(admin, order._id, { status: "Processing" });
      assert.equal(res.status, 400);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
    }
  });

  test("an unknown/forbidden field is rejected (mass-assignment guard, e.g. total)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const order = await makeOrder(buyer, product);
      const res = await setStatus(admin, order._id, { status: "processing", total: 1 });
      assert.equal(res.status, 400);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
    }
  });

  test("malformed order id -> 400", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await setStatus(admin, "not-a-valid-id", { status: "processing" });
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("valid but nonexistent order id -> 404", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await setStatus(admin, "507f1f77bcf86cd799439011", { status: "processing" });
      assert.equal(res.status, 404);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("a non-admin (customer) is rejected (403)", async () => {
    const customer = await createTestUser({ role: "customer" });
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const order = await makeOrder(buyer, product);
      const res = await setStatus(customer, order._id, { status: "processing" });
      assert.equal(res.status, 403);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [customer._id, buyer._id] } });
    }
  });

  test("FIXED: delivered status set via this endpoint still atomically completes any pending COD Payment (existing behavior preserved)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const buyer = await createTestUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      const order = await makeOrder(buyer, product);
      const { POST: codPOST } = await import("../app/api/payments/cod/[orderId]/route.js");
      await codPOST(requestAs({ method: "POST", url: `http://test/api/payments/cod/${order._id}`, session: await createTestSession(buyer._id) }), { params: Promise.resolve({ orderId: order._id }) });

      await setStatus(admin, order._id, { status: "shipped" });
      await setStatus(admin, order._id, { status: "delivered" });

      const payment = await Payment.findOne({ order: order._id });
      assert.equal(payment.status, "completed");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
    }
  });
});
