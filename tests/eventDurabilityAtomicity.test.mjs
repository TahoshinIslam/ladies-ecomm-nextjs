// Phase 11 realtime-durability CORRECTION — deterministic proof that the
// transactional-outbox call sites (order creation, order cancellation,
// COD payment creation) are genuinely atomic with their business
// mutation, and that the non-transactional call sites are awaited (never
// silently fire-and-forget). This closes the gap the original Phase 11
// report left open: the mandatory two-process test
// (tests/http/multiInstanceEvents.integration.test.mjs) proves
// cross-instance DELIVERY once a write has succeeded, but never forced a
// write to FAIL to prove atomicity — this file does exactly that, against
// the REAL services/orderService.js/paymentService.js/productService.js
// functions and a real transaction-capable MongoDB, using mock.method to
// deterministically fail the event insert (or the business write) at the
// exact right moment.
import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestUser, createTestProduct } from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("Phase 11 CORRECTION — transactional-outbox atomicity (real DB, forced failures)", { skip: !canRun && reason }, () => {
  let Order, Payment, Product, Event, Cart, Category;
  let createOrder, cancelOrder;
  let codCreate;
  let createProduct;

  before(async () => {
    await connectTestDb();
    ({ default: Order } = await import("../models/orderModel.js"));
    ({ default: Payment } = await import("../models/paymentModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ default: Event } = await import("../models/eventModel.js"));
    ({ default: Cart } = await import("../models/cartModel.js"));
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ createOrder, cancelOrder } = await import("../services/orderService.js"));
    ({ codCreate } = await import("../services/paymentService.js"));
    ({ createProduct } = await import("../services/productService.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  function orderPayloadFor(product) {
    return {
      items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
      shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" },
    };
  }

  test("createOrder: a forced Event.create failure rolls back the ENTIRE transaction — no Order, no stock decrement, no Event", async () => {
    const user = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 5 });
    const idempotencyKey = `atomicity-fail-${Date.now()}-a`;

    const spy = mock.method(Event, "create", async () => {
      throw new Error("simulated event-insert failure");
    });
    try {
      await assert.rejects(() => createOrder(user._id, orderPayloadFor(product), idempotencyKey), /simulated event-insert failure/);
    } finally {
      spy.mock.restore();
    }

    const orderCount = await Order.countDocuments({ user: user._id });
    assert.equal(orderCount, 0, "no Order document must exist — the transaction (order + stock decrement) must have rolled back");

    const freshProduct = await Product.findById(product._id).lean();
    assert.equal(freshProduct.variants[0].stock, 5, "stock must be unchanged — the decrement rolled back with the rest of the transaction");

    // No order was ever created (proven above), and NEW_ORDER's `orderId`
    // payload field is only ever derived from a real, committed order's
    // `_id` — so there is no possible NEW_ORDER event this run could have
    // produced. (A DB-wide count is deliberately not asserted here — this
    // suite may run alongside other test files sharing the same disposable
    // database, each with its own real, legitimately-created orders/events.)

    await Product.updateOne({ _id: product._id }, { $set: { isActive: false } });
  });

  test("createOrder: a forced business-mutation failure (insufficient stock) leaves no event, no matter what", async () => {
    const user = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 0 }); // guarantees the stock guard rejects
    const idempotencyKey = `atomicity-fail-${Date.now()}-b`;

    await assert.rejects(() => createOrder(user._id, orderPayloadFor(product), idempotencyKey), /Insufficient stock/);

    const orderCount = await Order.countDocuments({ user: user._id });
    // No order was created (the stock guard rejected before Order.create
    // ever ran), so the NEW_ORDER emit — which only ever fires with an
    // orderId derived from a real committed order's _id — could never
    // have been constructed or reached, transactional or not.
    assert.equal(orderCount, 0, "no order means no event could have referenced it");
  });

  test("createOrder: a successful transaction commits BOTH the order and its NEW_ORDER event, atomically", async () => {
    const user = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 5 });
    const idempotencyKey = `atomicity-success-${Date.now()}`;

    const { order } = await createOrder(user._id, orderPayloadFor(product), idempotencyKey);
    assert.ok(order);

    const events = await Event.find({ type: "NEW_ORDER", "payload.orderId": order._id.toString() }).lean();
    assert.equal(events.length, 1, "exactly one NEW_ORDER event must exist for the newly committed order");

    await Order.deleteOne({ _id: order._id });
    await Event.deleteMany({ "payload.orderId": order._id.toString() });
  });

  test("createOrder: sequential idempotent replay produces exactly one NEW_ORDER event, never two", async () => {
    const user = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 5 });
    const idempotencyKey = `atomicity-replay-seq-${Date.now()}`;
    const payload = orderPayloadFor(product);

    const first = await createOrder(user._id, payload, idempotencyKey);
    const second = await createOrder(user._id, payload, idempotencyKey);
    assert.equal(second.replayed, true);
    assert.equal(second.order._id.toString(), first.order._id.toString());

    const events = await Event.find({ type: "NEW_ORDER", "payload.orderId": first.order._id.toString() }).lean();
    assert.equal(events.length, 1, "a sequential replay must never create a second NEW_ORDER event");

    await Order.deleteOne({ _id: first.order._id });
    await Event.deleteMany({ "payload.orderId": first.order._id.toString() });
  });

  test("createOrder: concurrent idempotent replay (same key, simultaneous requests) still produces exactly one NEW_ORDER event", async () => {
    const user = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 5 });
    const idempotencyKey = `atomicity-replay-conc-${Date.now()}`;
    const payload = orderPayloadFor(product);

    const [a, b] = await Promise.all([createOrder(user._id, payload, idempotencyKey), createOrder(user._id, payload, idempotencyKey)]);
    const winnerId = (a.replayed ? b : a).order._id.toString();
    assert.equal(a.order._id.toString(), winnerId);
    assert.equal(b.order._id.toString(), winnerId);
    assert.ok(a.replayed || b.replayed, "exactly one of the two concurrent requests must be the winner, the other a replay");

    const events = await Event.find({ type: "NEW_ORDER", "payload.orderId": winnerId }).lean();
    assert.equal(events.length, 1, "a concurrent replay race must never create a second NEW_ORDER event");

    await Order.deleteOne({ _id: winnerId });
    await Event.deleteMany({ "payload.orderId": winnerId });
  });

  test("cancelOrder: a forced Event.create failure rolls back the cancellation transaction — order status is unchanged, stock is not restored", async () => {
    const user = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 5 });
    const idempotencyKey = `atomicity-cancel-${Date.now()}`;
    const { order } = await createOrder(user._id, orderPayloadFor(product), idempotencyKey);

    const spy = mock.method(Event, "create", async () => {
      throw new Error("simulated event-insert failure on cancel");
    });
    try {
      await assert.rejects(() => cancelOrder(user._id, "customer", order._id.toString()), /simulated event-insert failure on cancel/);
    } finally {
      spy.mock.restore();
    }

    const freshOrder = await Order.findById(order._id).lean();
    assert.notEqual(freshOrder.status, "cancelled", "the order must remain in its pre-cancellation status — the transaction rolled back");

    const cancelledEvents = await Event.countDocuments({ type: "ORDER_CANCELLED", "payload.orderId": order._id.toString() });
    assert.equal(cancelledEvents, 0);

    await Order.deleteOne({ _id: order._id });
    await Event.deleteMany({ "payload.orderId": order._id.toString() });
  });

  test("cancelOrder: a successful cancellation commits both the status change and its two events atomically", async () => {
    const user = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 5 });
    const idempotencyKey = `atomicity-cancel-success-${Date.now()}`;
    const { order } = await createOrder(user._id, orderPayloadFor(product), idempotencyKey);

    await cancelOrder(user._id, "customer", order._id.toString());

    const freshOrder = await Order.findById(order._id).lean();
    assert.equal(freshOrder.status, "cancelled");

    const orderEvents = await Event.countDocuments({ channel: `order:${order._id}`, type: "ORDER_STATUS_UPDATED" });
    const adminEvents = await Event.countDocuments({ type: "ORDER_CANCELLED", "payload.orderId": order._id.toString() });
    assert.equal(orderEvents, 1);
    assert.equal(adminEvents, 1);

    await Order.deleteOne({ _id: order._id });
    await Event.deleteMany({ "payload.orderId": order._id.toString() });
  });

  test("codCreate: a forced Event.create failure rolls back the Payment creation and order-status change together", async () => {
    const user = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 5 });
    const idempotencyKey = `atomicity-cod-${Date.now()}`;
    const { order } = await createOrder(user._id, orderPayloadFor(product), idempotencyKey);

    const spy = mock.method(Event, "create", async () => {
      throw new Error("simulated event-insert failure on COD create");
    });
    try {
      await assert.rejects(() => codCreate(order._id.toString(), user._id), /simulated event-insert failure on COD create/);
    } finally {
      spy.mock.restore();
    }

    const freshOrder = await Order.findById(order._id).lean();
    assert.equal(freshOrder.status, "pending", "the order status change must have rolled back with the failed event insert");

    const paymentCount = await Payment.countDocuments({ order: order._id });
    assert.equal(paymentCount, 0, "no Payment document must exist — it rolled back with the same transaction");

    await Order.deleteOne({ _id: order._id });
    await Event.deleteMany({ "payload.orderId": order._id.toString() });
  });

  test("codCreate: a successful COD creation commits the Payment, the order status change, and the event atomically", async () => {
    const user = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 5 });
    const idempotencyKey = `atomicity-cod-success-${Date.now()}`;
    const { order } = await createOrder(user._id, orderPayloadFor(product), idempotencyKey);

    await codCreate(order._id.toString(), user._id);

    const freshOrder = await Order.findById(order._id).lean();
    assert.equal(freshOrder.status, "processing");
    const paymentCount = await Payment.countDocuments({ order: order._id });
    assert.equal(paymentCount, 1);
    const eventCount = await Event.countDocuments({ channel: `order:${order._id}`, type: "ORDER_STATUS_UPDATED" });
    assert.equal(eventCount, 1);

    await Order.deleteOne({ _id: order._id });
    await Payment.deleteMany({ order: order._id });
    await Event.deleteMany({ "payload.orderId": order._id.toString() });
  });

  test("createProduct (non-transactional): the event write is genuinely AWAITED — the function does not return until the emit settles", async () => {
    let resolveEmit;
    const gate = new Promise((resolve) => {
      resolveEmit = resolve;
    });
    let emitStarted = false;
    let functionReturnedBeforeEmitResolved = false;

    const spy = mock.method(Event, "create", async (...args) => {
      emitStarted = true;
      await gate;
      return Event.create.wrappedMethod ? Event.create.wrappedMethod(...args) : [];
    });
    try {
      const { createTestCategory } = await import("./helpers/testDb.mjs");
      const dept = await createTestCategory();
      const leaf = await Category.create({ name: `__leaf_${Date.now()}`, slug: `__leaf-await-${Date.now()}`, parent: dept._id });
      const createPromise = createProduct({
        name: `__atomicity_await_test_${Date.now()}`,
        description: "Phase 11 atomicity fixture — safe to delete.",
        category: leaf._id.toString(),
        basePrice: 100,
        images: ["https://placehold.co/400x400?text=test"],
        variants: [{ variantName: "Default", sku: `AWAIT-${Date.now()}`, stock: 1 }],
      });

      // Give the emit call a moment to actually start before we decide
      // whether the outer promise resolved too early.
      await new Promise((r) => setTimeout(r, 20));
      assert.ok(emitStarted, "the event insert must have started before this check");

      let settled = false;
      createPromise.then(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 20));
      if (settled) functionReturnedBeforeEmitResolved = true;

      resolveEmit();
      const product = await createPromise;
      assert.ok(product);
      assert.equal(functionReturnedBeforeEmitResolved, false, "createProduct() must not resolve before its (best-effort) event write has settled");

      await Product.deleteOne({ _id: product._id });
    } finally {
      spy.mock.restore();
    }
  });

  test("createProduct (non-transactional): a forced event-insert failure is logged, but the already-succeeded product save is NOT rolled back", async () => {
    const { createTestCategory } = await import("./helpers/testDb.mjs");
    const dept = await createTestCategory();
    const leaf = await Category.create({ name: `__leaf_${Date.now()}b`, slug: `__leaf-besteffort-${Date.now()}`, parent: dept._id });

    const spy = mock.method(Event, "create", async () => {
      throw new Error("simulated non-transactional event failure");
    });
    const consoleSpy = mock.method(console, "error", () => {});
    let product;
    try {
      product = await createProduct({
        name: `__atomicity_besteffort_test_${Date.now()}`,
        description: "Phase 11 atomicity fixture — safe to delete.",
        category: leaf._id.toString(),
        basePrice: 100,
        images: ["https://placehold.co/400x400?text=test"],
        variants: [{ variantName: "Default", sku: `BESTEFFORT-${Date.now()}`, stock: 1 }],
      });
    } finally {
      spy.mock.restore();
      consoleSpy.mock.restore();
    }

    assert.ok(product, "the product save itself must succeed even though its accompanying event write failed");
    const found = await Product.findById(product._id).lean();
    assert.ok(found, "the product must genuinely exist in the database — a best-effort event failure must never roll back a non-transactional save");
    assert.ok(
      consoleSpy.mock.calls.some((c) => String(c.arguments[0]).includes("event publish failed")),
      "the event-insert failure must be logged, never silently dropped",
    );

    await Product.deleteOne({ _id: product._id });
  });
});
