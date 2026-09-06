// Phase 4B — exactly-once post-commit side-effect evidence.
//
// The Phase 4 report inferred "post-commit effects run exactly once" from
// the `replayed` boolean alone. This file instruments the REAL effect
// boundary instead: services/notificationService.js's createAdminNotification
// and lib/events.js's emitAdminEvent/emitOrderEvent are mocked via
// node:test's module mocking (mock.module) — the exact functions
// services/orderService.js and services/paymentService.js actually import
// and call — with counting wrappers, so this proves call COUNTS, not just
// the response shape.
//
// mock.module replaces module resolution for a specifier globally in this
// process, so it must run BEFORE anything else in this process ever
// imports services/orderService.js, app/api/orders/route.js, or
// app/api/payments/cod/[orderId]/route.js (all done via dynamic import
// inside before(), after the mocks are installed, for exactly this
// reason). Node's test runner gives each test FILE its own process by
// default, so this doesn't affect any other test file's use of the real
// notification/event implementations.

import { test, describe, before, after, mock } from "node:test";
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

let notificationCalls = [];
let adminEventCalls = [];
let orderEventCalls = [];

mock.module("../services/notificationService.js", {
  namedExports: {
    createAdminNotification: async (payload) => {
      notificationCalls.push(payload);
    },
    getNotifications: async () => ({ total: 0, unreadCount: 0, page: 1, pages: 1, notifications: [] }),
  },
});

mock.module("../lib/events.js", {
  namedExports: {
    orderChannel: (orderId) => `order:${orderId}`,
    ADMIN_CHANNEL: "admin",
    emitAdminEvent: (payload) => {
      adminEventCalls.push(payload);
      return Promise.resolve();
    },
    emitOrderEvent: (orderId, payload) => {
      orderEventCalls.push({ orderId, payload });
      return Promise.resolve();
    },
  },
});

describe("Phase 4 exactly-once post-commit effects (real effect boundary, mocked/counted)", { skip: !canRun && reason }, () => {
  let createOrderPOST, codPOST;
  let Order, User, Product, Payment;

  before(async () => {
    await connectTestDb();
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ POST: codPOST } = await import("../app/api/payments/cod/[orderId]/route.js"));
    ({ default: Order } = await import("../models/orderModel.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ default: Payment } = await import("../models/paymentModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  const orderPayload = (product) => ({
    items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
    shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" },
  });

  test("sequential same-key replay: createAdminNotification and the NEW_ORDER admin event each fire exactly once, not once per request", async () => {
    notificationCalls = [];
    adminEventCalls = [];
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const session = await createTestSession(buyer._id);
      const key = "seq-effects-key-0123456789";
      const body = orderPayload(product);

      const res1 = await createOrderPOST(requestAs({ method: "POST", url: "http://test/api/orders", session, body, idempotencyKey: key }));
      assert.equal(res1.status, 201);
      const res2 = await createOrderPOST(requestAs({ method: "POST", url: "http://test/api/orders", session, body, idempotencyKey: key }));
      assert.equal(res2.status, 200);

      const newOrderEvents = adminEventCalls.filter((e) => e.type === "NEW_ORDER");
      assert.equal(notificationCalls.length, 1, "createAdminNotification must be called exactly once across the real request + its replay");
      assert.equal(newOrderEvents.length, 1, "the NEW_ORDER admin event must be emitted exactly once");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("concurrent same-key replay: createAdminNotification and the NEW_ORDER admin event each fire exactly once", async () => {
    notificationCalls = [];
    adminEventCalls = [];
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const session = await createTestSession(buyer._id);
      const key = "concurrent-effects-key-01234";
      const body = orderPayload(product);

      const [res1, res2] = await Promise.all([
        createOrderPOST(requestAs({ method: "POST", url: "http://test/api/orders", session, body, idempotencyKey: key })),
        createOrderPOST(requestAs({ method: "POST", url: "http://test/api/orders", session, body, idempotencyKey: key })),
      ]);
      assert.ok([res1.status, res2.status].every((s) => s === 200 || s === 201));

      const newOrderEvents = adminEventCalls.filter((e) => e.type === "NEW_ORDER");
      assert.equal(notificationCalls.length, 1, "concurrent replay must still only create one admin notification");
      assert.equal(newOrderEvents.length, 1, "concurrent replay must still only emit one NEW_ORDER event");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("two genuinely different keys (two real orders) DO each get their own notification and event — the dedup is key-scoped, not global", async () => {
    notificationCalls = [];
    adminEventCalls = [];
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const session = await createTestSession(buyer._id);
      const body = orderPayload(product);
      const res1 = await createOrderPOST(requestAs({ method: "POST", url: "http://test/api/orders", session, body, idempotencyKey: "different-key-one-01234567" }));
      const res2 = await createOrderPOST(requestAs({ method: "POST", url: "http://test/api/orders", session, body, idempotencyKey: "different-key-two-01234567" }));
      assert.equal(res1.status, 201);
      assert.equal(res2.status, 201);

      const newOrderEvents = adminEventCalls.filter((e) => e.type === "NEW_ORDER");
      assert.equal(notificationCalls.length, 2);
      assert.equal(newOrderEvents.length, 2);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  test("COD: sequential and concurrent duplicate requests each emit the order status event exactly once (not once per request)", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    try {
      const session = await createTestSession(buyer._id);
      const orderRes = await createOrderPOST(
        requestAs({ method: "POST", url: "http://test/api/orders", session, body: orderPayload(product), idempotencyKey: "cod-effects-key-0123456789" }),
      );
      const { order } = await orderRes.json();

      orderEventCalls = [];
      const fire = () => codPOST(requestAs({ method: "POST", url: `http://test/api/payments/cod/${order._id}`, session }), { params: Promise.resolve({ orderId: order._id }) });

      const r1 = await fire();
      assert.equal(r1.status, 200);
      const r2 = await fire();
      assert.equal(r2.status, 200);

      assert.equal(orderEventCalls.length, 1, "a replayed COD request (Payment already exists) must not emit a second order-status event");

      // A brand-new order's concurrent duplicate COD requests: still
      // exactly one status-transition event, even though two requests
      // raced.
      const orderRes2 = await createOrderPOST(
        requestAs({ method: "POST", url: "http://test/api/orders", session, body: orderPayload(product), idempotencyKey: "cod-effects-key-concurrent1" }),
      );
      const { order: order2 } = await orderRes2.json();
      orderEventCalls = [];
      const fire2 = () => codPOST(requestAs({ method: "POST", url: `http://test/api/payments/cod/${order2._id}`, session }), { params: Promise.resolve({ orderId: order2._id }) });
      const [c1, c2] = await Promise.all([fire2(), fire2()]);
      assert.ok([c1.status, c2.status].every((s) => s === 200));
      assert.equal(orderEventCalls.length, 1, "concurrent duplicate COD creation must still emit exactly one status event");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Payment.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });
});
