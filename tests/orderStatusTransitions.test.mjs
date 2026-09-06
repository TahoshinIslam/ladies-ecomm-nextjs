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
  let Order, User, Product, Payment, Notification, Event;

  before(async () => {
    await connectTestDb();
    ({ PUT: statusPUT } = await import("../app/api/orders/[id]/status/route.js"));
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ default: Order } = await import("../models/orderModel.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ default: Payment } = await import("../models/paymentModel.js"));
    ({ default: Notification } = await import("../models/notificationModel.js"));
    ({ default: Event } = await import("../models/eventModel.js"));
  });

  async function getModels() {
    return { Notification, Event };
  }

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

  // Phase 12 remediation — a same-status resubmission must be a TRUE
  // no-op: no re-save, no deliveredAt/updatedAt rewrite, no duplicate
  // notification, no duplicate event, no cache invalidation.
  describe("same-status resubmission is a true no-op (Phase 12 remediation)", () => {
    test("delivered twice preserves the original deliveredAt and updatedAt", async () => {
      const admin = await createTestUser({ role: "admin" });
      const buyer = await createTestUser();
      const product = await createTestProduct({ stock: 5 });
      try {
        const order = await makeOrder(buyer, product);
        await setStatus(admin, order._id, { status: "processing" });
        await setStatus(admin, order._id, { status: "shipped" });
        await setStatus(admin, order._id, { status: "delivered" });
        const first = await Order.findById(order._id).lean();

        await new Promise((resolve) => setTimeout(resolve, 10));
        const res = await setStatus(admin, order._id, { status: "delivered" });
        assert.equal(res.status, 200);
        const second = await Order.findById(order._id).lean();

        assert.equal(second.deliveredAt.getTime(), first.deliveredAt.getTime(), "deliveredAt must not be rewritten by a repeat 'delivered' request");
        assert.equal(second.updatedAt.getTime(), first.updatedAt.getTime(), "updatedAt must not change — no save() must occur on a true no-op");
      } finally {
        await Order.deleteMany({ user: buyer._id });
        await Product.deleteOne({ _id: product._id });
        await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
      }
    });

    test("cancelled twice creates no duplicate notification", async () => {
      const { Notification } = await getModels();
      const admin = await createTestUser({ role: "admin" });
      const buyer = await createTestUser();
      const product = await createTestProduct({ stock: 5 });
      let order;
      try {
        order = await makeOrder(buyer, product);
        await setStatus(admin, order._id, { status: "cancelled" });
        // The admin notification is intentionally fire-and-forget (not
        // part of this remediation's scope) — a short settle wait lets it
        // land before counting, avoiding a false negative from racing it.
        await new Promise((resolve) => setTimeout(resolve, 150));
        const countAfterFirst = await Notification.countDocuments({ message: new RegExp(`#${order._id.toString().slice(-6)} marked as cancelled`) });
        const res = await setStatus(admin, order._id, { status: "cancelled" });
        assert.equal(res.status, 200);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const countAfterSecond = await Notification.countDocuments({ message: new RegExp(`#${order._id.toString().slice(-6)} marked as cancelled`) });
        assert.equal(countAfterSecond, countAfterFirst, "a repeated 'cancelled' request must not create a second notification");
        assert.ok(countAfterFirst >= 1);
      } finally {
        await Notification.deleteMany({ message: new RegExp(`#${order._id?.toString?.().slice(-6)}`) });
        await Order.deleteMany({ user: buyer._id });
        await Product.deleteOne({ _id: product._id });
        await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
      }
    });

    test("refunded twice creates no duplicate notification/event", async () => {
      const { Notification, Event } = await getModels();
      const admin = await createTestUser({ role: "admin" });
      const buyer = await createTestUser();
      const product = await createTestProduct({ stock: 5 });
      let order;
      try {
        order = await makeOrder(buyer, product);
        await setStatus(admin, order._id, { status: "processing" });
        await setStatus(admin, order._id, { status: "shipped" });
        await setStatus(admin, order._id, { status: "delivered" });
        await setStatus(admin, order._id, { status: "refunded" });
        await new Promise((resolve) => setTimeout(resolve, 150));
        const notifBefore = await Notification.countDocuments({ message: new RegExp(`#${order._id.toString().slice(-6)} marked as refunded`) });
        const eventsBefore = await Event.countDocuments({ channel: "admin", type: "ORDER_STATUS_CHANGED", "payload.orderId": order._id.toString(), "payload.status": "refunded" });

        const res = await setStatus(admin, order._id, { status: "refunded" });
        assert.equal(res.status, 200);
        await new Promise((resolve) => setTimeout(resolve, 150));

        const notifAfter = await Notification.countDocuments({ message: new RegExp(`#${order._id.toString().slice(-6)} marked as refunded`) });
        const eventsAfter = await Event.countDocuments({ channel: "admin", type: "ORDER_STATUS_CHANGED", "payload.orderId": order._id.toString(), "payload.status": "refunded" });
        assert.equal(notifAfter, notifBefore, "no duplicate refunded notification");
        assert.equal(eventsAfter, eventsBefore, "no duplicate ORDER_STATUS_CHANGED event");
      } finally {
        await Notification.deleteMany({ message: new RegExp(`#${order._id?.toString?.().slice(-6)}`) });
        await Event.deleteMany({ "payload.orderId": order._id?.toString?.() });
        await Order.deleteMany({ user: buyer._id });
        await Product.deleteOne({ _id: product._id });
        await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
      }
    });

    test("an unchanged tracking number is a no-op (no re-save, no re-emitted event)", async () => {
      const { Event } = await getModels();
      const admin = await createTestUser({ role: "admin" });
      const buyer = await createTestUser();
      const product = await createTestProduct({ stock: 5 });
      try {
        const order = await makeOrder(buyer, product);
        await setStatus(admin, order._id, { status: "processing" });
        await setStatus(admin, order._id, { status: "shipped", trackingNumber: "TRK-001" });
        const before = await Order.findById(order._id).lean();
        const eventsBefore = await Event.countDocuments({ channel: `order:${order._id}` });

        const res = await setStatus(admin, order._id, { status: "shipped", trackingNumber: "TRK-001" });
        assert.equal(res.status, 200);
        const after = await Order.findById(order._id).lean();
        const eventsAfter = await Event.countDocuments({ channel: `order:${order._id}` });

        assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), "no save() when tracking number is unchanged");
        assert.equal(eventsAfter, eventsBefore, "no re-emitted order-channel event for an unchanged tracking number");
      } finally {
        await Order.deleteMany({ user: buyer._id });
        await Product.deleteOne({ _id: product._id });
        await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
      }
    });

    test("a genuinely changed tracking number (same status) updates it, refreshes the customer channel, but does not touch the admin channel or create a notification", async () => {
      const { Event } = await getModels();
      const admin = await createTestUser({ role: "admin" });
      const buyer = await createTestUser();
      const product = await createTestProduct({ stock: 5 });
      try {
        const order = await makeOrder(buyer, product);
        await setStatus(admin, order._id, { status: "processing" });
        await setStatus(admin, order._id, { status: "shipped", trackingNumber: "TRK-001" });
        const adminEventsBefore = await Event.countDocuments({ channel: "admin", "payload.orderId": order._id.toString() });

        const res = await setStatus(admin, order._id, { status: "shipped", trackingNumber: "TRK-002" });
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.order.trackingNumber, "TRK-002");

        const orderEvents = await Event.find({ channel: `order:${order._id}` }).sort({ createdAt: -1 }).limit(1).lean();
        assert.equal(orderEvents[0]?.payload?.trackingNumber, "TRK-002", "the customer channel must reflect the new tracking number");

        const adminEventsAfter = await Event.countDocuments({ channel: "admin", "payload.orderId": order._id.toString() });
        assert.equal(adminEventsAfter, adminEventsBefore, "a tracking-only change must not touch the admin channel");
      } finally {
        await Order.deleteMany({ user: buyer._id });
        await Product.deleteOne({ _id: product._id });
        await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
      }
    });

    test("concurrent repeats of the same status create zero additional side effects", async () => {
      const { Notification } = await getModels();
      const admin = await createTestUser({ role: "admin" });
      const buyer = await createTestUser();
      const product = await createTestProduct({ stock: 5 });
      let order;
      try {
        order = await makeOrder(buyer, product);
        await setStatus(admin, order._id, { status: "cancelled" });
        await new Promise((resolve) => setTimeout(resolve, 150));
        const before = await Notification.countDocuments({ message: new RegExp(`#${order._id.toString().slice(-6)} marked as cancelled`) });

        const [r1, r2, r3] = await Promise.all([
          setStatus(admin, order._id, { status: "cancelled" }),
          setStatus(admin, order._id, { status: "cancelled" }),
          setStatus(admin, order._id, { status: "cancelled" }),
        ]);
        assert.ok([r1.status, r2.status, r3.status].every((s) => s === 200));
        await new Promise((resolve) => setTimeout(resolve, 150));

        const after = await Notification.countDocuments({ message: new RegExp(`#${order._id.toString().slice(-6)} marked as cancelled`) });
        assert.equal(after, before, "concurrent repeats of an already-cancelled status must create zero additional notifications");
      } finally {
        await Notification.deleteMany({ message: new RegExp(`#${order._id?.toString?.().slice(-6)}`) });
        await Order.deleteMany({ user: buyer._id });
        await Product.deleteOne({ _id: product._id });
        await User.deleteMany({ _id: { $in: [admin._id, buyer._id] } });
      }
    });
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
