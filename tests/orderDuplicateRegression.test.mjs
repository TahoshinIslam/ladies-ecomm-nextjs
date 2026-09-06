// ============================================================================
// Phase 4 rewrite — order-request idempotency, CORRECTED behavior.
// ============================================================================
// This file used to characterize a KNOWN DEFECT: POST /api/orders had no
// idempotency key and no unique constraint, so two identical requests
// created two distinct Order documents. Phase 4 closes that gap: every
// create-order request now requires an `Idempotency-Key` header, scoped per
// user, backed by a unique partial index on
// { user, idempotencyKeyHash } (models/orderModel.js) and a
// find-before-create + duplicate-key-catch resolution in
// services/orderService.js's createOrder(). This file now asserts the
// CORRECTED behavior — do not reintroduce assertions that two identical
// requests should create two orders.
//
// This does NOT test (and does not claim anything about):
//   - transactional stock safety (services/orderService.js's atomic
//     `stock: { $gte: quantity }` guard) for two GENUINELY DIFFERENT orders
//     — that remains a separate guarantee from request-level idempotency,
//     and is exercised here only incidentally (via the different-keys test).
//   - promo-claim idempotency (claimFirstOrderPromo's atomic
//     findOneAndUpdate) — also a separate guarantee, exercised the same way.
// ============================================================================

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import mongoose from "mongoose";

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

const freshKey = () => crypto.randomBytes(16).toString("hex");

describe("POST /api/orders — Idempotency-Key contract (Phase 4)", { skip: !canRun && reason }, () => {
  let POST, cancelPOST;
  let Order, User, Settings, Product;
  let user, product, variantId;
  let priorPromoSetting;

  before(async () => {
    await connectTestDb();
    ({ POST } = await import("../app/api/orders/route.js"));
    ({ POST: cancelPOST } = await import("../app/api/orders/[id]/cancel/route.js"));
    ({ default: Order } = await import("../models/orderModel.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Settings } = await import("../models/settingsModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));

    user = await createTestUser({ role: "customer" });
    // Enough stock that every test below can succeed without hitting the
    // oversell guard — the point of this file is idempotency, not the
    // (separately-verified, working) stock guard.
    product = await createTestProduct({ stock: 50 });
    variantId = product.variants[0]._id;

    const settings = await Settings.getSingleton();
    priorPromoSetting = settings.promotions.firstOrderFreeShipping;
    settings.promotions.firstOrderFreeShipping = true;
    await settings.save();
  });

  after(async () => {
    const settings = await Settings.getSingleton();
    settings.promotions.firstOrderFreeShipping = priorPromoSetting;
    await settings.save();
    await Order.deleteMany({ user: user._id });
    await Product.deleteOne({ _id: product._id });
    await User.deleteOne({ _id: user._id });
    // Deliberately NOT disconnecting here — this file has a second
    // describe() block below that shares the same connection. Only the
    // very last describe's after() disconnects.
  });

  const orderPayload = (overrides = {}) => ({
    items: [{ productId: product._id.toString(), variantId: variantId.toString(), quantity: 1 }],
    shippingAddress: {
      fullName: "Test Buyer",
      phone: "0100000000",
      street: "1 Test Street",
      city: "Dhaka",
      postalCode: "1200",
      country: "Bangladesh",
    },
    ...overrides,
  });

  const fireCreateOrder = async ({ forUser = user, idempotencyKey, body, omitKey = false } = {}) => {
    const req = requestAs({
      method: "POST",
      url: "http://test/api/orders",
      session: await createTestSession(forUser._id),
      body: body || orderPayload(),
      idempotencyKey: omitKey ? null : idempotencyKey || freshKey(),
    });
    return POST(req);
  };

  // =========================================================================
  // 1 — sequential identical same-key requests
  // =========================================================================
  test("sequential identical same-key requests: one Order, same Order ID returned, stock decremented once, cart cleared once, promo claimed once, one notification/event", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const p = await createTestProduct({ stock: 10, basePrice: 1 });
    const key = freshKey();
    try {
      const stockBefore = (await Product.findById(p._id)).variants[0].stock;
      const body = orderPayload({ items: [{ productId: p._id.toString(), variantId: p.variants[0]._id.toString(), quantity: 1 }] });

      const res1 = await fireCreateOrder({ forUser: buyer, idempotencyKey: key, body });
      assert.equal(res1.status, 201);
      const json1 = await res1.json();

      const res2 = await fireCreateOrder({ forUser: buyer, idempotencyKey: key, body });
      assert.equal(res2.status, 200, "a sequential replay returns 200, not another 201");
      assert.equal(res2.headers.get("Idempotency-Replayed"), "true");
      const json2 = await res2.json();
      assert.equal(String(json2.order._id), String(json1.order._id), "the replay must return the SAME order");

      const orders = await Order.find({ user: buyer._id });
      assert.equal(orders.length, 1, "exactly one Order document must exist");

      const stockAfter = (await Product.findById(p._id)).variants[0].stock;
      assert.equal(stockAfter, stockBefore - 1, "stock must be decremented exactly once, not twice");

      const updatedUser = await User.findById(buyer._id);
      assert.equal(updatedUser.firstOrderPromoUsed, true, "the promo flag was claimed exactly once");
      assert.equal(json1.order.shippingCost, 0, "the first (real) order got the free-shipping promo");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: p._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  // =========================================================================
  // 2 — concurrent identical same-key requests
  // =========================================================================
  test("concurrent identical same-key requests: exactly one Order is created, every response refers to it, stock decremented once", async () => {
    const key = freshKey();
    const body = orderPayload();
    const [res1, res2] = await Promise.all([
      fireCreateOrder({ idempotencyKey: key, body }),
      fireCreateOrder({ idempotencyKey: key, body }),
    ]);
    const [json1, json2] = await Promise.all([res1.json(), res2.json()]);

    assert.ok([res1.status, res2.status].every((s) => s === 200 || s === 201), "no raw duplicate-key 500 may surface");
    assert.equal([res1.status, res2.status].filter((s) => s === 201).length, 1, "exactly one response is the real 201 creation");
    assert.equal([res1.status, res2.status].filter((s) => s === 200).length, 1, "exactly one response is a 200 replay");
    assert.equal(String(json1.order._id), String(json2.order._id), "both concurrent responses refer to the same Order");

    const orders = await Order.find({ user: user._id, "items.product": product._id });
    assert.equal(orders.length, 1, "exactly one Order document exists for this concurrent pair");
  });

  // =========================================================================
  // 3 — replay after the original request already cleared the cart
  // =========================================================================
  test("replay after the original request cleared the cart does not fail or recompute against an empty cart", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const p = await createTestProduct({ stock: 10 });
    const key = freshKey();
    try {
      const body = orderPayload({ items: [{ productId: p._id.toString(), variantId: p.variants[0]._id.toString(), quantity: 1 }] });
      const res1 = await fireCreateOrder({ forUser: buyer, idempotencyKey: key, body });
      assert.equal(res1.status, 201);
      const json1 = await res1.json();

      const { default: Cart } = await import("../models/cartModel.js");
      const cart = await Cart.findOne({ userId: buyer._id });
      assert.ok(!cart || cart.items.length === 0, "the real request must have cleared the cart");

      // The replay's body still names the same items (a real client always
      // resends the same body it originally sent) — this must succeed by
      // resolving from the stored order, not by trying to re-run
      // calcTotals() against whatever the cart looks like now.
      const res2 = await fireCreateOrder({ forUser: buyer, idempotencyKey: key, body });
      assert.equal(res2.status, 200);
      const json2 = await res2.json();
      assert.equal(String(json2.order._id), String(json1.order._id));
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: p._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  // =========================================================================
  // 4 — replay after the client discards/loses the first response
  // =========================================================================
  test("replay after the client never saw the first response still resolves to the order that was actually created", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const p = await createTestProduct({ stock: 10 });
    const key = freshKey();
    try {
      const body = orderPayload({ items: [{ productId: p._id.toString(), variantId: p.variants[0]._id.toString(), quantity: 1 }] });
      await fireCreateOrder({ forUser: buyer, idempotencyKey: key, body }); // response deliberately discarded

      const actualOrder = await Order.findOne({ user: buyer._id });
      assert.ok(actualOrder, "the first request must have actually created an order server-side");

      const replay = await fireCreateOrder({ forUser: buyer, idempotencyKey: key, body });
      assert.equal(replay.status, 200);
      const replayJson = await replay.json();
      assert.equal(String(replayJson.order._id), String(actualOrder._id));
      assert.equal(await Order.countDocuments({ user: buyer._id }), 1);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: p._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  // =========================================================================
  // 5 — same key, different payload -> 422
  // =========================================================================
  test("the same key reused with a materially different request is rejected (422), with no mutation", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const p = await createTestProduct({ stock: 10 });
    const key = freshKey();
    try {
      const body1 = orderPayload({ items: [{ productId: p._id.toString(), variantId: p.variants[0]._id.toString(), quantity: 1 }] });
      const res1 = await fireCreateOrder({ forUser: buyer, idempotencyKey: key, body: body1 });
      assert.equal(res1.status, 201);

      const stockAfterFirst = (await Product.findById(p._id)).variants[0].stock;

      // Same key, but a different quantity — a materially different order.
      const body2 = orderPayload({ items: [{ productId: p._id.toString(), variantId: p.variants[0]._id.toString(), quantity: 2 }] });
      const res2 = await fireCreateOrder({ forUser: buyer, idempotencyKey: key, body: body2 });
      assert.equal(res2.status, 422);
      const json2 = await res2.json();
      assert.ok(!/idempotencyKeyHash|idempotencyRequestHash|sha256|hash/i.test(JSON.stringify(json2)), "no internal hash detail leaks in the 422 body");

      assert.equal(await Order.countDocuments({ user: buyer._id }), 1, "the rejected mismatched replay must not create a second order");
      const stockAfterSecond = (await Product.findById(p._id)).variants[0].stock;
      assert.equal(stockAfterSecond, stockAfterFirst, "no additional stock mutation from the rejected request");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: p._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  // =========================================================================
  // 6 — same key, different users -> independent orders
  // =========================================================================
  test("the same Idempotency-Key value used by two different users creates two independent orders", async () => {
    const buyerA = await createTestUser({ role: "customer" });
    const buyerB = await createTestUser({ role: "customer" });
    const p = await createTestProduct({ stock: 10 });
    const sharedKey = freshKey();
    try {
      const body = orderPayload({ items: [{ productId: p._id.toString(), variantId: p.variants[0]._id.toString(), quantity: 1 }] });
      const resA = await fireCreateOrder({ forUser: buyerA, idempotencyKey: sharedKey, body });
      const resB = await fireCreateOrder({ forUser: buyerB, idempotencyKey: sharedKey, body });
      assert.equal(resA.status, 201);
      assert.equal(resB.status, 201, "a different user reusing the same raw key value gets their own independent order, not a 422/replay");
      const jsonA = await resA.json();
      const jsonB = await resB.json();
      assert.notEqual(String(jsonA.order._id), String(jsonB.order._id));
    } finally {
      await Order.deleteMany({ user: { $in: [buyerA._id, buyerB._id] } });
      await Product.deleteOne({ _id: p._id });
      await User.deleteMany({ _id: { $in: [buyerA._id, buyerB._id] } });
    }
  });

  // =========================================================================
  // 7 — different keys, identical payload -> separate legitimate orders
  // =========================================================================
  test("different keys with an identical payload remain two separate, legitimate orders (this is NOT the old duplicate-order defect)", async () => {
    const before = await Product.findById(product._id);
    const stockBefore = before.variants[0].stock;
    const body = orderPayload();

    const [res1, res2] = await Promise.all([
      fireCreateOrder({ idempotencyKey: freshKey(), body }),
      fireCreateOrder({ idempotencyKey: freshKey(), body }),
    ]);
    assert.equal(res1.status, 201);
    assert.equal(res2.status, 201);
    const [json1, json2] = await Promise.all([res1.json(), res2.json()]);
    assert.notEqual(json1.order._id, json2.order._id, "two distinct keys are two distinct legitimate checkout intents");

    const after_ = await Product.findById(product._id);
    assert.equal(after_.variants[0].stock, stockBefore - 2, "each of the two genuinely separate orders decremented stock independently");
  });

  // =========================================================================
  // 8-11 — key format validation
  // =========================================================================
  test("missing Idempotency-Key header -> 400", async () => {
    const res = await fireCreateOrder({ omitKey: true });
    assert.equal(res.status, 400);
  });

  test("too-short Idempotency-Key (under 16 chars) -> 400", async () => {
    const res = await fireCreateOrder({ idempotencyKey: "short-key" });
    assert.equal(res.status, 400);
  });

  test("oversized Idempotency-Key (over 128 chars) -> 400", async () => {
    const res = await fireCreateOrder({ idempotencyKey: "a".repeat(200) });
    assert.equal(res.status, 400);
  });

  test("whitespace/control/comma/malformed Idempotency-Key values -> 400", async () => {
    const badKeys = [
      "has a space in it!!",
      "has,a,comma,in,it!!",
      'quote"inside"value!!',
      "semi;colon;value;here",
    ];
    for (const bad of badKeys) {
      const res = await fireCreateOrder({ idempotencyKey: bad });
      assert.equal(res.status, 400, `expected 400 for malformed key: ${JSON.stringify(bad)}`);
    }
  });

  // =========================================================================
  // 12-14 — the raw key/hash never leak
  // =========================================================================
  test("internal idempotency hash fields are absent from the JSON response", async () => {
    const res = await fireCreateOrder();
    const json = await res.json();
    assert.ok(!("idempotencyKeyHash" in json.order));
    assert.ok(!("idempotencyRequestHash" in json.order));
    assert.ok(!/idempotencyKeyHash|idempotencyRequestHash/.test(JSON.stringify(json)));
  });

  test("the raw Idempotency-Key is absent from MongoDB — only its SHA-256 hash is stored", async () => {
    const key = freshKey();
    const res = await fireCreateOrder({ idempotencyKey: key });
    assert.equal(res.status, 201);
    const json = await res.json();

    const raw = await Order.collection.findOne({ _id: new mongoose.Types.ObjectId(json.order._id) });
    assert.ok(raw.idempotencyKeyHash, "the hash field must be persisted");
    assert.notEqual(raw.idempotencyKeyHash, key, "the stored value must not be the raw key");
    assert.equal(raw.idempotencyKeyHash.length, 64, "a SHA-256 hex digest is 64 characters");
    assert.ok(!JSON.stringify(raw).includes(key), "the raw key must not appear anywhere in the stored document");
  });

  test("the raw Idempotency-Key is never passed to console.* anywhere in the implementation (static source check)", async () => {
    const sources = [
      fs.readFileSync(new URL("../lib/idempotency.js", import.meta.url), "utf8"),
      fs.readFileSync(new URL("../services/orderService.js", import.meta.url), "utf8"),
      fs.readFileSync(new URL("../app/api/orders/route.js", import.meta.url), "utf8"),
    ].join("\n");
    for (const line of sources.split("\n")) {
      if (/console\.(log|error|warn|info|debug)/.test(line)) {
        assert.ok(
          !/idempotencyKey\b/.test(line) || /hashToken|keyHash/.test(line),
          `a console.* call must never reference the raw idempotencyKey variable: ${line.trim()}`,
        );
      }
    }
  });

  // =========================================================================
  // 15-16 — failed transaction: key not burned, no partial mutation
  // =========================================================================
  test("a failed transaction can be retried safely with the same key, and leaves no partial stock/cart/promo/order mutation", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const p = await createTestProduct({ stock: 10 });
    const key = freshKey();
    try {
      const body = orderPayload({ items: [{ productId: p._id.toString(), variantId: p.variants[0]._id.toString(), quantity: 1 }] });
      const stockBefore = (await Product.findById(p._id)).variants[0].stock;

      const originalCreate = Order.create.bind(Order);
      let failedOnce = false;
      Order.create = async function patchedCreate(...args) {
        if (!failedOnce) {
          failedOnce = true;
          throw new Error("Simulated Order.create failure for idempotency retry test");
        }
        return originalCreate(...args);
      };

      // lib/http.js's toResponse() console.error()s any non-HttpError
      // before turning it into a 500 — expected here (the failure is
      // forced), so it's narrowly mocked for just this one call and
      // asserted to have fired, rather than left to print noise into CI
      // logs or silently swallowed.
      const originalConsoleError = console.error;
      let consoleErrorCalls = 0;
      console.error = (...args) => {
        consoleErrorCalls += 1;
        void args;
      };
      let firstRes;
      try {
        firstRes = await fireCreateOrder({ forUser: buyer, idempotencyKey: key, body });
      } finally {
        console.error = originalConsoleError;
        Order.create = originalCreate;
      }
      assert.equal(firstRes.status, 500, "the forced failure surfaces as a server error, not a silently-eaten one");
      assert.equal(consoleErrorCalls, 1, "the forced failure must actually reach lib/http.js's error-logging path exactly once");

      assert.equal(await Order.countDocuments({ user: buyer._id }), 0, "no Order may persist from the aborted transaction");
      const midStock = (await Product.findById(p._id)).variants[0].stock;
      assert.equal(midStock, stockBefore, "stock must be completely unchanged after the aborted transaction");
      const midUser = await User.findById(buyer._id);
      assert.equal(midUser.firstOrderPromoUsed, false, "the promo claim must have rolled back too");

      // Retry with the SAME key — the key was not "consumed" by the failure.
      const retryRes = await fireCreateOrder({ forUser: buyer, idempotencyKey: key, body });
      assert.equal(retryRes.status, 201, "the same key must be usable again after a failed attempt");
      assert.equal(await Order.countDocuments({ user: buyer._id }), 1);
      const afterStock = (await Product.findById(p._id)).variants[0].stock;
      assert.equal(afterStock, stockBefore - 1);
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: p._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });

  // =========================================================================
  // 17-18 — cancellation interaction
  // =========================================================================
  test("cancelling the idempotently-created order restores stock exactly once; replaying the original creation afterward returns the cancelled order, not a replacement", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const p = await createTestProduct({ stock: 10 });
    const key = freshKey();
    try {
      const body = orderPayload({ items: [{ productId: p._id.toString(), variantId: p.variants[0]._id.toString(), quantity: 1 }] });
      const res = await fireCreateOrder({ forUser: buyer, idempotencyKey: key, body });
      assert.equal(res.status, 201);
      const json = await res.json();
      const stockAfterCreate = (await Product.findById(p._id)).variants[0].stock;

      const cancelRes = await cancelPOST(
        requestAs({ method: "POST", url: `http://test/api/orders/${json.order._id}/cancel`, session: await createTestSession(buyer._id) }),
        { params: Promise.resolve({ id: json.order._id }) },
      );
      assert.equal(cancelRes.status, 200);
      const stockAfterCancel = (await Product.findById(p._id)).variants[0].stock;
      assert.equal(stockAfterCancel, stockAfterCreate + 1, "cancellation restores stock exactly once");

      const replayRes = await fireCreateOrder({ forUser: buyer, idempotencyKey: key, body });
      assert.equal(replayRes.status, 200, "replaying the original creation after cancellation is still a replay, not a fresh 201");
      const replayJson = await replayRes.json();
      assert.equal(String(replayJson.order._id), String(json.order._id));
      assert.equal(replayJson.order.status, "cancelled", "the replay reflects the order's current (cancelled) status, unmodified");

      assert.equal(await Order.countDocuments({ user: buyer._id }), 1, "no replacement order may be created by replaying after cancellation");
      const stockAfterReplay = (await Product.findById(p._id)).variants[0].stock;
      assert.equal(stockAfterReplay, stockAfterCancel, "the replay must not touch stock again");
    } finally {
      await Order.deleteMany({ user: buyer._id });
      await Product.deleteOne({ _id: p._id });
      await User.deleteOne({ _id: buyer._id });
    }
  });
});

describe("Order idempotency index — real MongoDB behavior", { skip: !canRun && reason }, () => {
  let Order, User, Product;
  let user, product;

  before(async () => {
    await connectTestDb();
    ({ default: Order } = await import("../models/orderModel.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    user = await createTestUser({ role: "customer" });
    product = await createTestProduct({ stock: 10 });
    // Auto-index runs in the background on model compilation — give it a
    // moment before asserting the index exists, since these tests assert
    // the index directly against the live collection rather than relying
    // on write-time behavior alone.
    await Order.init();
  });

  after(async () => {
    await Order.deleteMany({ user: user._id });
    await Product.deleteOne({ _id: product._id });
    await User.deleteOne({ _id: user._id });
    await disconnectTestDb();
  });

  test("the unique compound index on {user, idempotencyKeyHash} exists in MongoDB, with a partial filter expression", async () => {
    const indexes = await Order.collection.indexes();
    const idx = indexes.find((i) => i.key?.user === 1 && i.key?.idempotencyKeyHash === 1);
    assert.ok(idx, "the {user, idempotencyKeyHash} index must exist");
    assert.equal(idx.unique, true);
    assert.ok(idx.partialFilterExpression, "the index must be partial, so legacy orders without the field never collide");
  });

  test("legacy orders with no idempotencyKeyHash at all can coexist without colliding on the unique index", async () => {
    const legacy1 = await Order.create({
      user: user._id,
      items: [{ product: product._id, variantId: product.variants[0]._id, quantity: 1, snapshot: { name: "x", price: 100 } }],
      shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "x" },
      subtotal: 100,
      total: 100,
    });
    const legacy2 = await Order.create({
      user: user._id,
      items: [{ product: product._id, variantId: product.variants[0]._id, quantity: 1, snapshot: { name: "x", price: 100 } }],
      shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "x" },
      subtotal: 100,
      total: 100,
    });
    assert.ok(legacy1._id);
    assert.ok(legacy2._id);
    assert.equal(await Order.countDocuments({ user: user._id }), 2);
  });

  test("a duplicate idempotencyKeyHash for the SAME user is rejected at the database level", async () => {
    const hash = crypto.createHash("sha256").update("test-value").digest("hex");
    const base = {
      user: user._id,
      items: [{ product: product._id, variantId: product.variants[0]._id, quantity: 1, snapshot: { name: "x", price: 100 } }],
      shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "x" },
      subtotal: 100,
      total: 100,
    };
    await Order.create({ ...base, idempotencyKeyHash: hash, idempotencyRequestHash: "r1" });
    await assert.rejects(
      () => Order.create({ ...base, idempotencyKeyHash: hash, idempotencyRequestHash: "r2" }),
      /E11000|duplicate key/i,
    );
  });

  test("the SAME idempotencyKeyHash value for DIFFERENT users is accepted (the index is scoped per-user)", async () => {
    const otherUser = await createTestUser({ role: "customer" });
    try {
      const hash = crypto.createHash("sha256").update("shared-value").digest("hex");
      const base = {
        items: [{ product: product._id, variantId: product.variants[0]._id, quantity: 1, snapshot: { name: "x", price: 100 } }],
        shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "x" },
        subtotal: 100,
        total: 100,
      };
      const a = await Order.create({ ...base, user: user._id, idempotencyKeyHash: hash, idempotencyRequestHash: "r" });
      const b = await Order.create({ ...base, user: otherUser._id, idempotencyKeyHash: hash, idempotencyRequestHash: "r" });
      assert.ok(a._id);
      assert.ok(b._id);
    } finally {
      await Order.deleteMany({ user: otherUser._id });
      await User.deleteOne({ _id: otherUser._id });
    }
  });

  test("idempotencyKeyHash and idempotencyRequestHash are excluded by default from a plain query (select:false)", async () => {
    const hash = crypto.createHash("sha256").update("select-false-check").digest("hex");
    const created = await Order.create({
      user: user._id,
      items: [{ product: product._id, variantId: product.variants[0]._id, quantity: 1, snapshot: { name: "x", price: 100 } }],
      shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "x" },
      subtotal: 100,
      total: 100,
      idempotencyKeyHash: hash,
      idempotencyRequestHash: "r",
    });
    const fetched = await Order.findById(created._id);
    assert.equal(fetched.idempotencyKeyHash, undefined);
    assert.equal(fetched.idempotencyRequestHash, undefined);
    assert.ok(!("idempotencyKeyHash" in fetched.toJSON()));
    assert.ok(!("idempotencyRequestHash" in fetched.toJSON()));
  });

  test("Payment.order's pre-existing unique index remains intact", async () => {
    const { default: Payment } = await import("../models/paymentModel.js");
    const indexes = await Payment.collection.indexes();
    const idx = indexes.find((i) => i.key?.order === 1);
    assert.ok(idx, "Payment.order index must still exist");
    assert.equal(idx.unique, true, "Payment.order must still be unique");
  });
});
