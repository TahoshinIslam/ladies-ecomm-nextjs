// Phase 1: order-creation transactional guarantees, ownership, and
// cancellation — services/orderService.js's createOrder()/cancelOrder(),
// called via the real POST /api/orders, GET /api/orders/[id], and
// POST /api/orders/[id]/cancel Route Handlers against a real,
// transaction-capable MongoDB replica set.
//
// This file is deliberately separate from
// tests/orderDuplicateRegression.test.mjs — that file characterizes the
// KNOWN DEFECT that duplicate/retried requests create two orders; this file
// verifies the transactional guarantees that DO work correctly today
// (stock atomicity, rollback, cart handling, promo consumption,
// cancellation, ownership). Do not read a passing run of this file as
// evidence the duplicate-order defect doesn't exist — see the other file.

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

describe("Order transactions: creation, stock, cart, promo, cancellation, ownership", { skip: !canRun && reason }, () => {
  let createOrderPOST, getOrderGET, cancelOrderPOST;
  let Order, Product, Cart, User, Settings;

  before(async () => {
    await connectTestDb();
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ GET: getOrderGET } = await import("../app/api/orders/[id]/route.js"));
    ({ POST: cancelOrderPOST } = await import("../app/api/orders/[id]/cancel/route.js"));
    ({ default: Order } = await import("../models/orderModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ default: Cart } = await import("../models/cartModel.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Settings } = await import("../models/settingsModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  const address = () => ({
    fullName: "Test Buyer",
    phone: "0100000000",
    street: "1 Test Street",
    city: "Dhaka",
    postalCode: "1200",
    country: "Bangladesh",
  });

  async function makeBuyerAndProducts() {
    const buyer = await createTestUser({ role: "customer" });
    const productA = await createTestProduct({ stock: 10 });
    const productB = await createTestProduct({ stock: 10 });
    return { buyer, productA, productB };
  }

  async function cleanup(buyer, ...products) {
    await Order.deleteMany({ user: buyer._id });
    await Cart.deleteOne({ userId: buyer._id });
    for (const p of products) await Product.deleteOne({ _id: p._id });
    await User.deleteOne({ _id: buyer._id });
  }

  test("a successful multi-item order is created with server-computed totals", async () => {
    const { buyer, productA, productB } = await makeBuyerAndProducts();
    try {
      const req = requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
        body: {
          items: [
            { productId: productA._id.toString(), variantId: productA.variants[0]._id.toString(), quantity: 2 },
            { productId: productB._id.toString(), variantId: productB.variants[0]._id.toString(), quantity: 1 },
          ],
          shippingAddress: address(),
        },
      });
      const res = await createOrderPOST(req);
      assert.equal(res.status, 201);
      const json = await res.json();
      assert.equal(json.order.items.length, 2);
      // basePrice 1000 USD each (tests/helpers/testDb.mjs's createTestProduct)
      // — services/orderService.js's toRegionCurrency() converts to BDT for
      // the "Bangladesh" shipping address at the default settings.currency.
      // usdToBdt rate of 120: (2*1000 + 1*1000) * 120 = 360000. Server-
      // computed either way, not client-supplied.
      assert.equal(json.order.subtotal, 360000);
    } finally {
      await cleanup(buyer, productA, productB);
    }
  });

  test("server-side price recalculation: the request body has no client-price field at all, and any extra fields sent are ignored", async () => {
    const { buyer, productA } = await makeBuyerAndProducts();
    try {
      const req = requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
        body: {
          items: [{ productId: productA._id.toString(), variantId: productA.variants[0]._id.toString(), quantity: 1, price: 1 }],
          shippingAddress: address(),
          total: 1, // a client-submitted total, if this field were ever read
        },
      });
      const res = await createOrderPOST(req);
      assert.equal(res.status, 201);
      const json = await res.json();
      // 1000 USD basePrice * 120 (BDT rate) = 120000 — see the subtotal
      // comment in the previous test for why this isn't a bare 1000.
      assert.equal(
        json.order.total,
        120000,
        "the server ignores the client-submitted `total`/`price` fields entirely — services/orderService.js's createOrder() destructures only { items, shippingAddress, shippingTier, couponCode, notes } and never reads a price/total from the request body; the real product basePrice is what's charged",
      );
    } finally {
      await cleanup(buyer, productA);
    }
  });

  test("atomic stock decrement: ordering quantity 3 decrements stock by exactly 3", async () => {
    const { buyer, productA } = await makeBuyerAndProducts();
    try {
      const req = requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
        body: { items: [{ productId: productA._id.toString(), variantId: productA.variants[0]._id.toString(), quantity: 3 }], shippingAddress: address() },
      });
      const res = await createOrderPOST(req);
      assert.equal(res.status, 201);
      const updated = await Product.findById(productA._id);
      assert.equal(updated.variants[0].stock, 7, "started at 10, ordered 3");
    } finally {
      await cleanup(buyer, productA);
    }
  });

  test("insufficient stock is rejected (400) and stock is left completely untouched", async () => {
    const { buyer, productA } = await makeBuyerAndProducts();
    try {
      const req = requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
        body: { items: [{ productId: productA._id.toString(), variantId: productA.variants[0]._id.toString(), quantity: 999 }], shippingAddress: address() },
      });
      const res = await createOrderPOST(req);
      assert.equal(res.status, 400);
      const unchanged = await Product.findById(productA._id);
      assert.equal(unchanged.variants[0].stock, 10);
    } finally {
      await cleanup(buyer, productA);
    }
  });

  test("rollback: if a later line item's guarded stock decrement fails mid-transaction, an EARLIER item's already-applied decrement is rolled back too", async () => {
    const { buyer, productA } = await makeBuyerAndProducts();
    try {
      // Two line items against the SAME product+variant (stock=10), 6 each.
      // calcTotals() checks each item against a fresh Product.findById() —
      // both individually pass (10 >= 6), since nothing has decremented yet
      // at that point. The actual decrement loop then processes them in
      // order: item 1's guarded updateOne (stock >= 6) succeeds, dropping
      // stock to 4; item 2's guarded updateOne then requires stock >= 6
      // against the NOW-current value of 4, fails, and throws inside the
      // transaction — which must roll back item 1's already-applied -6 too.
      const variantId = productA.variants[0]._id.toString();
      const req = requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
        body: {
          items: [
            { productId: productA._id.toString(), variantId, quantity: 6 },
            { productId: productA._id.toString(), variantId, quantity: 6 },
          ],
          shippingAddress: address(),
        },
      });
      const res = await createOrderPOST(req);
      assert.equal(res.status, 409, "the second item's guarded decrement fails with a conflict");

      const afterFailure = await Product.findById(productA._id);
      assert.equal(
        afterFailure.variants[0].stock,
        10,
        "ROLLBACK CONFIRMED: the first item's decrement was undone along with the second item's failure — stock is back to its pre-transaction value, not left at 4",
      );

      const orders = await Order.find({ user: buyer._id });
      assert.equal(orders.length, 0, "no Order document should exist for a rolled-back transaction");
    } finally {
      await cleanup(buyer, productA);
    }
  });

  test("cart is cleared only after a successful order commit", async () => {
    const { buyer, productA } = await makeBuyerAndProducts();
    try {
      await Cart.create({ userId: buyer._id, items: [{ productId: productA._id, variantId: productA.variants[0]._id, quantity: 1 }] });

      const req = requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
        body: { items: [{ productId: productA._id.toString(), variantId: productA.variants[0]._id.toString(), quantity: 1 }], shippingAddress: address() },
      });
      const res = await createOrderPOST(req);
      assert.equal(res.status, 201);

      const cart = await Cart.findOne({ userId: buyer._id });
      assert.deepEqual(cart.items, [], "cart must be emptied after a committed order");
    } finally {
      await cleanup(buyer, productA);
    }
  });

  test("cart is PRESERVED (untouched) when the order transaction rolls back", async () => {
    const { buyer, productA } = await makeBuyerAndProducts();
    try {
      await Cart.create({ userId: buyer._id, items: [{ productId: productA._id, variantId: productA.variants[0]._id, quantity: 1 }] });

      const req = requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
        body: { items: [{ productId: productA._id.toString(), variantId: productA.variants[0]._id.toString(), quantity: 999 }], shippingAddress: address() },
      });
      const res = await createOrderPOST(req);
      assert.equal(res.status, 400, "insufficient stock — the order is rejected before any commit");

      const cart = await Cart.findOne({ userId: buyer._id });
      assert.equal(cart.items.length, 1, "a rolled-back/rejected order must never touch the cart");
    } finally {
      await cleanup(buyer, productA);
    }
  });

  test("first-order promotion is claimed on the first order and NOT on a second, later order from the same user", async () => {
    const buyer = await createTestUser({ role: "customer" });
    // Deliberately a cheap product (basePrice 1 USD -> 120 BDT) — the
    // default 1000 USD product used elsewhere in this file converts to
    // 120,000 BDT, already well above the default settings.shippingZones
    // "Inside Dhaka" tier's freeAbove=2000 threshold, which would make
    // shipping free on its own and never actually exercise the promo-claim
    // code path (services/orderService.js's `ship.cost > 0` guard).
    const cheapProduct = await createTestProduct({ stock: 10, basePrice: 1 });
    const settings = await Settings.getSingleton();
    const priorPromoSetting = settings.promotions.firstOrderFreeShipping;
    settings.promotions.firstOrderFreeShipping = true;
    await settings.save();
    try {
      const place = async () =>
        createOrderPOST(
          requestAs({
            method: "POST",
            url: "http://test/api/orders",
            session: await createTestSession(buyer._id),
            body: { items: [{ productId: cheapProduct._id.toString(), variantId: cheapProduct.variants[0]._id.toString(), quantity: 1 }], shippingAddress: address() },
          }),
        );

      const first = await (await place()).json();
      const second = await (await place()).json();

      assert.equal(first.order.shippingCost, 0, "first order should win the free-shipping promo");
      const updatedUser = await User.findById(buyer._id);
      assert.equal(updatedUser.firstOrderPromoUsed, true);
      assert.notEqual(second.order.shippingCost, 0, "a second, sequential order from the same user must NOT get the promo again");
    } finally {
      settings.promotions.firstOrderFreeShipping = priorPromoSetting;
      await settings.save();
      await cleanup(buyer, cheapProduct);
    }
  });

  test("cancellation restores inventory exactly once", async () => {
    const { buyer, productA } = await makeBuyerAndProducts();
    try {
      const created = await (
        await createOrderPOST(
          requestAs({
            method: "POST",
            url: "http://test/api/orders",
            session: await createTestSession(buyer._id),
            body: { items: [{ productId: productA._id.toString(), variantId: productA.variants[0]._id.toString(), quantity: 4 }], shippingAddress: address() },
          }),
        )
      ).json();
      const afterOrder = await Product.findById(productA._id);
      assert.equal(afterOrder.variants[0].stock, 6, "10 - 4");

      const cancelReq = requestAs({ method: "POST", url: `http://test/api/orders/${created.order._id}/cancel`, session: await createTestSession(buyer._id) });
      const cancelRes = await cancelOrderPOST(cancelReq, { params: Promise.resolve({ id: created.order._id }) });
      assert.equal(cancelRes.status, 200);

      const afterCancel = await Product.findById(productA._id);
      assert.equal(afterCancel.variants[0].stock, 10, "cancellation must restore exactly the 4 units it decremented");
    } finally {
      await cleanup(buyer, productA);
    }
  });

  test("repeated cancellation of the same order is rejected — inventory cannot be restored twice", async () => {
    const { buyer, productA } = await makeBuyerAndProducts();
    try {
      const created = await (
        await createOrderPOST(
          requestAs({
            method: "POST",
            url: "http://test/api/orders",
            session: await createTestSession(buyer._id),
            body: { items: [{ productId: productA._id.toString(), variantId: productA.variants[0]._id.toString(), quantity: 2 }], shippingAddress: address() },
          }),
        )
      ).json();

      const cancelOnce = async () =>
        cancelOrderPOST(requestAs({ method: "POST", url: `http://test/api/orders/${created.order._id}/cancel`, session: await createTestSession(buyer._id) }), {
          params: Promise.resolve({ id: created.order._id }),
        });

      assert.equal((await cancelOnce()).status, 200);
      const secondAttempt = await cancelOnce();
      assert.equal(secondAttempt.status, 400, "cancelling an already-cancelled order must be rejected, not silently re-processed");

      const finalStock = await Product.findById(productA._id);
      assert.equal(finalStock.variants[0].stock, 10, "restored exactly once (10 - 2 + 2 = 10), not twice (which would be 12)");
    } finally {
      await cleanup(buyer, productA);
    }
  });

  test("order ownership: the owner can GET their own order, a stranger cannot (403), admin can (any order)", async () => {
    const { buyer, productA } = await makeBuyerAndProducts();
    const stranger = await createTestUser({ role: "customer" });
    const admin = await createTestUser({ role: "admin" });
    try {
      const created = await (
        await createOrderPOST(
          requestAs({
            method: "POST",
            url: "http://test/api/orders",
            session: await createTestSession(buyer._id),
            body: { items: [{ productId: productA._id.toString(), variantId: productA.variants[0]._id.toString(), quantity: 1 }], shippingAddress: address() },
          }),
        )
      ).json();
      const orderId = created.order._id;

      const ownerRes = await getOrderGET(requestAs({ method: "GET", url: `http://test/api/orders/${orderId}`, session: await createTestSession(buyer._id) }), {
        params: Promise.resolve({ id: orderId }),
      });
      assert.equal(ownerRes.status, 200);

      const strangerRes = await getOrderGET(requestAs({ method: "GET", url: `http://test/api/orders/${orderId}`, session: await createTestSession(stranger._id) }), {
        params: Promise.resolve({ id: orderId }),
      });
      assert.equal(strangerRes.status, 403);

      const adminRes = await getOrderGET(requestAs({ method: "GET", url: `http://test/api/orders/${orderId}`, session: await createTestSession(admin._id) }), {
        params: Promise.resolve({ id: orderId }),
      });
      assert.equal(adminRes.status, 200);
    } finally {
      await cleanup(buyer, productA);
      await User.deleteMany({ _id: { $in: [stranger._id, admin._id] } });
    }
  });
});
