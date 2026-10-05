// Online selling from receipt batches (ecom_erp migrations 087–090; this app's half is
// models/inventoryModel.js and services/orderService.js).
//
// One product, received twice at different costs and prices — Shirt, Batch A 50 @ cost ৳400 / price ৳500,
// Batch B 50 @ cost ৳450 / price ৳550 — sold online from the same stock the dashboard's till sells from.
//
// What must hold, through the real route handlers:
//
//   - the shop shows the NEXT batch's price, and the cart/preview show a quantity that spans two batches as
//     two prices ("50 × ৳500 + 10 × ৳550"), never an average — and no batch, lot or cost reaches the browser;
//   - checkout prices the same way under lock, and reserves exactly those batches (a reservation names them);
//   - a quote that is no longer true (a batch was used up, a price moved) is refused with the NEW quote and
//     creates nothing — never a silent difference; an order that WAS accepted keeps the price it was agreed at;
//   - a promotional price is one price for every batch;
//   - two shoppers racing for the last unit cannot both win; cancelling releases each batch once.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  truncateAll,
  createTestSession,
  requestAs,
  createTestUser,
  createTestProduct,
  deleteRows,
  rawQuery,
  seedBatch,
  clearVariantStock,
} from "./helpers/testDb.mjs";

const ORG = process.env.STORE_ORGANIZATION_ID;

describe("Online orders are priced and reserved batch by batch", { skip: !dbReady && skipReason }, () => {
  let createOrderPOST, cancelOrderPOST, previewPOST, cartCheckPOST, getProductByIdOrSlug;
  const locations = [];

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ POST: cancelOrderPOST } = await import("../app/api/orders/[id]/cancel/route.js"));
    ({ POST: previewPOST } = await import("../app/api/orders/preview/route.js"));
    ({ POST: cartCheckPOST } = await import("../app/api/cart/check/route.js"));
    ({ getProductByIdOrSlug } = await import("../services/productService.js"));
  });

  after(async () => {
    for (const id of locations) await rawQuery("DELETE FROM stock_locations WHERE id = ?", [id]).catch(() => {});
    await disconnectTestDb();
  });

  const address = () => ({ fullName: "Shirt Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" });

  async function makeLocation() {
    const id = `loc_b${Math.random().toString(16).slice(2, 12)}`;
    await rawQuery(
      `INSERT INTO stock_locations (id, organization_id, name, code, location_type, status, fulfils_online, fulfilment_priority, created_by_name) VALUES (?, ?, ?, ?, 'warehouse', 'Active', 1, 1, 'test')`,
      [id, ORG, `Loc ${id}`, id.toUpperCase().slice(0, 30)],
    );
    locations.push(id);
    return id;
  }

  /** The shirt: 50 @ ৳500 (cost 400) received first, then 50 @ ৳550 (cost 450), at one location. */
  async function shirt({ qtyA = 50, qtyB = 50 } = {}) {
    const product = await createTestProduct({ stock: 0, basePrice: 500 });
    const variantId = product.variants[0]._id.toString();
    const productId = product._id.toString();
    const location = await makeLocation();
    const a = qtyA ? await seedBatch({ location, variantId, productId, quantity: qtyA, price: 500, cost: 400, receivedAt: "2026-01-01 10:00:00" }) : null;
    const b = qtyB ? await seedBatch({ location, variantId, productId, quantity: qtyB, price: 550, cost: 450, receivedAt: "2026-02-01 10:00:00" }) : null;
    return { product, variantId, productId, location, a, b };
  }

  const itemsOf = (s, quantity) => [{ productId: s.productId, variantId: s.variantId, quantity }];
  const post = async (handler, url, body, buyer, headers) =>
    handler(requestAs({ method: "POST", url, session: buyer ? await createTestSession(buyer._id) : undefined, body, ...(headers ? { headers } : {}) }));
  const preview = async (s, quantity, buyer) => {
    const res = await post(previewPOST, "http://test/api/orders/preview", { items: itemsOf(s, quantity), shippingAddress: { country: "Bangladesh" } }, buyer);
    return { res, body: await res.json() };
  };
  const place = async (s, buyer, quantity, extra = {}) => {
    const res = await createOrderPOST(
      requestAs({ method: "POST", url: "http://test/api/orders", session: await createTestSession(buyer._id), body: { items: itemsOf(s, quantity), shippingAddress: address(), ...extra } }),
    );
    return { res, body: await res.json() };
  };
  const levels = async (s) =>
    Object.fromEntries((await rawQuery("SELECT batch_id, quantity, reserved FROM stock_batch_levels WHERE variant_id = ? AND item_condition = 'sellable'", [s.variantId])).map((r) => [r.batch_id, { quantity: Number(r.quantity), reserved: Number(r.reserved) }]));
  const cleanup = async (s, buyer) => {
    await deleteRows("orders", "customer_id", buyer._id);
    await deleteRows("carts", "customer_id", buyer._id);
    await clearVariantStock(s.variantId);
    await deleteRows("products", "id", s.product._id);
    await deleteRows("customers", "id", buyer._id);
  };

  test("the shop shows the next batch's price, and moves on when that batch is used up", async () => {
    const s = await shirt({ qtyA: 2, qtyB: 5 });
    const buyer = await createTestUser({ role: "customer" });
    try {
      const shown = async () => (await getProductByIdOrSlug(s.productId)).variants[0].price;
      assert.equal(Number(await shown()), 500, "the first batch's price is what is on sale");
      assert.equal(Number((await rawQuery("SELECT online_next_price(?, ?) AS p", [ORG, s.variantId]))[0].p), 500);
      const version = async () => Number((await rawQuery("SELECT COALESCE(MAX(version), 0) AS v FROM online_price_versions WHERE organization_id = ?", [ORG]))[0].v);
      const before = await version();
      // Using up batch A (as a till sale would) hands the next price to B — and moves the cache counter.
      await rawQuery("UPDATE stock_batch_levels SET quantity = 0 WHERE batch_id = ?", [s.a]);
      assert.equal(Number(await shown()), 550, "with A gone, B's price is the one on sale");
      assert.ok((await version()) > before, "using a batch up tells the website's caches the price may have changed");
    } finally {
      await cleanup(s, buyer);
    }
  });

  test("60 shirts are priced 50 × ৳500 + 10 × ৳550 before the shopper confirms, with nothing internal showing", async () => {
    const s = await shirt();
    const buyer = await createTestUser({ role: "customer" });
    try {
      const { res, body } = await preview(s, 60, buyer);
      assert.equal(res.status, 200);
      assert.deepEqual(body.preview.lines.map((l) => [l.quantity, l.unitPrice, l.lineTotal]), [[50, 500, 25000], [10, 550, 5500]]);
      assert.equal(body.preview.subtotal, 30500, "৳25,000 + ৳5,500 — not 60 × an average");
      assert.match(body.preview.quote, /^[0-9a-f]{32}$/);
      const text = JSON.stringify(body);
      assert.ok(!text.includes(s.a) && !text.includes(s.b), "no batch id reaches the browser");
      assert.ok(!/unit_?cost|cost_?state|purchase|"cost"/i.test(text), "no purchase cost reaches the browser");

      const check = await post(cartCheckPOST, "http://test/api/cart/check", { items: itemsOf(s, 60) });
      const item = (await check.json()).items[0];
      assert.equal(item.status, "ok");
      assert.deepEqual(item.segments, [{ quantity: 50, unitPrice: 500 }, { quantity: 10, unitPrice: 550 }], "the bag shows the same breakdown");
      assert.equal(item.lineTotal, 30500);
      assert.ok(!JSON.stringify(item).includes(s.a), "…without naming a batch");
    } finally {
      await cleanup(s, buyer);
    }
  });

  test("checkout reserves exactly the batches it priced: two order lines, a reservation naming A and B", async () => {
    const s = await shirt();
    const buyer = await createTestUser({ role: "customer" });
    try {
      const { body: p } = await preview(s, 60, buyer);
      const { res, body } = await place(s, buyer, 60, { quote: p.preview.quote });
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.equal(body.order.subtotal, 30500);
      assert.deepEqual(body.order.items.map((i) => [i.quantity, i.snapshot.price]), [[50, 500], [10, 550]], "one order line per price");
      const lines = await rawQuery("SELECT quantity, snapshot_price, batch_id FROM order_items WHERE order_id = ? ORDER BY position", [body.order._id]);
      assert.deepEqual(lines.map((l) => [l.batch_id]), [[s.a], [s.b]], "each single-batch line names its batch");
      const held = await rawQuery(
        `SELECT a.batch_id, a.quantity, a.unit_price, a.unit_cost, a.cost_state, a.status
           FROM stock_batch_allocations a JOIN stock_reservations r ON r.id = a.holder_id AND a.holder_type = 'order_reservation'
          WHERE r.order_id = ? ORDER BY a.id`,
        [body.order._id],
      );
      assert.deepEqual(held.map((h) => [h.batch_id, Number(h.quantity), Number(h.unit_price), Number(h.unit_cost), h.cost_state, h.status]), [
        [s.a, 50, 500, 400, "provisional", "active"],
        [s.b, 10, 550, 450, "provisional", "active"],
      ]);
      const now = await levels(s);
      assert.deepEqual(now[s.a], { quantity: 50, reserved: 50 }, "A is fully reserved, nothing left the shelf");
      assert.deepEqual(now[s.b], { quantity: 50, reserved: 10 });
      const [{ reserved, onHand, stock }] = await rawQuery(
        "SELECT sl.reserved, sl.on_hand AS onHand, pv.stock FROM stock_levels sl JOIN product_variants pv ON pv.id = sl.variant_id WHERE sl.variant_id = ?",
        [s.variantId],
      );
      assert.deepEqual([Number(onHand), Number(reserved), Number(stock)], [100, 60, 40], "on-hand 100, reserved 60, the shop shows the 40 that remain");
      assert.ok(!/unit_?cost|cost_?state|purchase/i.test(JSON.stringify(body)), "the order response carries no cost");
    } finally {
      await cleanup(s, buyer);
    }
  });

  test("a stale quote is refused with the new quote and creates nothing", async () => {
    const s = await shirt();
    const buyer = await createTestUser({ role: "customer" });
    try {
      const { body: p } = await preview(s, 60, buyer);
      // Meanwhile the till sells 30 of batch A (a dashboard sale): the same 60 now cost 20 × ৳500 + 40 × ৳550 = ৳32,000.
      await rawQuery("UPDATE stock_batch_levels SET quantity = quantity - 30 WHERE batch_id = ?", [s.a]);
      const before = Number((await rawQuery("SELECT COUNT(*) AS n FROM orders"))[0].n);
      const { res, body } = await place(s, buyer, 60, { quote: p.preview.quote });
      assert.equal(res.status, 409);
      assert.equal(body.errors.code, "QUOTE_CHANGED");
      assert.deepEqual(body.errors.preview.lines.map((l) => [l.quantity, l.unitPrice]), [[20, 500], [40, 550]], "the new quote is returned for the shopper to review");
      assert.equal(body.errors.preview.subtotal, 32000);
      assert.equal(Number((await rawQuery("SELECT COUNT(*) AS n FROM orders"))[0].n), before, "no order was made");
      assert.equal(Number((await rawQuery("SELECT COUNT(*) AS n FROM stock_reservations WHERE variant_id = ?", [s.variantId]))[0].n), 0, "no stock was reserved");
      assert.equal(Number((await rawQuery("SELECT COALESCE(SUM(reserved), 0) AS n FROM stock_batch_levels WHERE variant_id = ?", [s.variantId]))[0].n), 0);
      // Accepting the new quote works, at the new price.
      const again = await place(s, buyer, 60, { quote: body.errors.preview.quote });
      assert.equal(again.res.status, 201);
      assert.equal(again.body.order.subtotal, 32000);
    } finally {
      await cleanup(s, buyer);
    }
  });

  test("an accepted order keeps the price it was agreed at, whatever happens to the batch later", async () => {
    const s = await shirt();
    const buyer = await createTestUser({ role: "customer" });
    try {
      const { body: p } = await preview(s, 4, buyer);
      const { res, body } = await place(s, buyer, 4, { quote: p.preview.quote });
      assert.equal(res.status, 201);
      // The dashboard reprices batch A, and its default price changes: the agreed order is untouched.
      await rawQuery("UPDATE stock_batches SET selling_price = 999, price_source = 'repriced' WHERE id = ?", [s.a]);
      await rawQuery("UPDATE product_variants SET price = 777 WHERE id = ?", [s.variantId]);
      const [line] = await rawQuery("SELECT snapshot_price AS price FROM order_items WHERE order_id = ?", [body.order._id]);
      assert.equal(Number(line.price), 500);
      const [alloc] = await rawQuery("SELECT unit_price FROM stock_batch_allocations a JOIN stock_reservations r ON r.id = a.holder_id WHERE r.order_id = ?", [body.order._id]);
      assert.equal(Number(alloc.unit_price), 500, "the reservation remembers the price quoted from the batch");
      const [{ total }] = await rawQuery("SELECT total FROM orders WHERE id = ?", [body.order._id]);
      assert.equal(Number(total), 2000 + Number(body.order.shippingCost ?? 0) + Number(body.order.tax || 0) * 0);
    } finally {
      await cleanup(s, buyer);
    }
  });

  test("a promotional price is one price for every batch: one line", async () => {
    const s = await shirt();
    const buyer = await createTestUser({ role: "customer" });
    try {
      await rawQuery("UPDATE product_variants SET discount_price = 450 WHERE id = ?", [s.variantId]);
      const { body } = await preview(s, 60, buyer);
      assert.deepEqual(body.preview.lines.map((l) => [l.quantity, l.unitPrice]), [[60, 450]]);
      assert.equal(body.preview.subtotal, 27000);
      const { res, body: ordered } = await place(s, buyer, 60, { quote: body.preview.quote });
      assert.equal(res.status, 201);
      assert.equal(ordered.order.items.length, 1);
      const held = await rawQuery("SELECT a.batch_id FROM stock_batch_allocations a JOIN stock_reservations r ON r.id = a.holder_id WHERE r.order_id = ? ORDER BY a.id", [ordered.order._id]);
      assert.deepEqual(held.map((h) => h.batch_id), [s.a, s.b], "still taken from both batches, each with its own cost");
    } finally {
      await cleanup(s, buyer);
    }
  });

  test("two shoppers racing for the last unit: exactly one wins, and the other batch is untouched", async () => {
    const s = await shirt({ qtyA: 1, qtyB: 0 });
    const one = await createTestUser({ role: "customer" });
    const two = await createTestUser({ role: "customer" });
    try {
      const [r1, r2] = await Promise.all([place(s, one, 1), place(s, two, 1)]);
      const statuses = [r1.res.status, r2.res.status].sort();
      assert.deepEqual(statuses.map((x) => (x === 201 ? "won" : "refused")).sort(), ["refused", "won"]);
      assert.ok([400, 409].includes(Math.max(...statuses)));
      assert.deepEqual(await levels(s), { [s.a]: { quantity: 1, reserved: 1 } });
    } finally {
      await deleteRows("orders", "customer_id", two._id);
      await cleanup(s, one);
      await deleteRows("customers", "id", two._id);
    }
  });

  test("cancelling releases every batch the order held, once", async () => {
    const s = await shirt();
    const buyer = await createTestUser({ role: "customer" });
    try {
      const { body } = await place(s, buyer, 60);
      const orderId = body.order._id;
      assert.deepEqual((await levels(s))[s.a], { quantity: 50, reserved: 50 });
      const session = await createTestSession(buyer._id);
      const cancel = () => cancelOrderPOST(requestAs({ method: "POST", url: `http://test/api/orders/${orderId}/cancel`, session }), { params: Promise.resolve({ id: orderId }) });
      assert.equal((await cancel()).status, 200);
      assert.deepEqual(await levels(s), { [s.a]: { quantity: 50, reserved: 0 }, [s.b]: { quantity: 50, reserved: 0 } });
      const allocations = await rawQuery("SELECT a.status FROM stock_batch_allocations a JOIN stock_reservations r ON r.id = a.holder_id WHERE r.order_id = ? ORDER BY a.id", [orderId]);
      assert.deepEqual(allocations.map((a) => a.status), ["released", "released"]);
      assert.equal((await cancel()).status, 400, "a cancelled order cannot be cancelled again");
      assert.deepEqual(await levels(s), { [s.a]: { quantity: 50, reserved: 0 }, [s.b]: { quantity: 50, reserved: 0 } });
    } finally {
      await cleanup(s, buyer);
    }
  });

  test("a quantity the batches cannot cover is refused whole, with nothing reserved", async () => {
    const s = await shirt({ qtyA: 3, qtyB: 2 });
    const buyer = await createTestUser({ role: "customer" });
    try {
      const { res } = await place(s, buyer, 6);
      assert.ok([400, 409].includes(res.status));
      assert.deepEqual(await levels(s), { [s.a]: { quantity: 3, reserved: 0 }, [s.b]: { quantity: 2, reserved: 0 } });
    } finally {
      await cleanup(s, buyer);
    }
  });

  test("an order without a quote is accepted at the server's current price (the quote is the shopper's protection, not a requirement)", async () => {
    const s = await shirt();
    const buyer = await createTestUser({ role: "customer" });
    try {
      const { res, body } = await place(s, buyer, 51);
      assert.equal(res.status, 201);
      assert.equal(body.order.subtotal, 25000 + 550);
    } finally {
      await cleanup(s, buyer);
    }
  });

  // The shop's everyday case, in plain numbers: juice sells at ৳40 and there are 50; the same juice arrives again, 20 of it,
  // selling at ৳50. The website must see ONE juice with 70 in stock, at ৳40 now and ৳50 once the first 50 are gone.
  test("the same juice at ৳40 (50) and then at ৳50 (20): one item, 70 in stock, two prices that never average", async () => {
    const product = await createTestProduct({ stock: 0, basePrice: 40 });
    const variantId = product.variants[0]._id.toString();
    const productId = product._id.toString();
    const location = await makeLocation();
    await seedBatch({ location, variantId, productId, quantity: 50, price: 40, cost: 30, receivedAt: "2026-09-10 10:00:00" });
    await seedBatch({ location, variantId, productId, quantity: 20, price: 50, cost: 35, receivedAt: "2026-10-02 10:00:00" });
    const s = { product, variantId, productId };
    const buyer = await createTestUser({ role: "customer" });
    try {
      const shown = (await getProductByIdOrSlug(productId)).variants[0];
      assert.equal(Number(shown.stock), 70, "the shop shows one juice with all 70 in stock");
      assert.equal(Number(shown.price), 40, "…offered at the first batch's price");
      const { res, body } = await preview(s, 60, buyer);
      assert.equal(res.status, 200);
      assert.deepEqual(body.preview.lines.map((l) => [l.quantity, l.unitPrice, l.lineTotal]), [[50, 40, 2000], [10, 50, 500]]);
      assert.equal(body.preview.subtotal, 2500, "50 × ৳40 + 10 × ৳50, not 60 × an average");
      // An order for 60 holds 60 of the 70; what is still on offer is 10, at the second batch's price.
      const placed = await place(s, buyer, 60);
      assert.equal(placed.res.status, 201);
      assert.equal(placed.body.order.subtotal, 2500);
      const after = (await getProductByIdOrSlug(productId)).variants[0];
      assert.equal(Number(after.stock), 10, "the website now offers the 10 that are left");
      assert.equal(Number(after.price), 50, "…at the second batch's price");
      // Cancelling gives all of it back: 70 again, at ৳40 again.
      const orderId = placed.body.order._id ?? placed.body.order.id;
      const cancel = await cancelOrderPOST(requestAs({ method: "POST", url: `http://test/api/orders/${orderId}/cancel`, session: await createTestSession(buyer._id) }), { params: Promise.resolve({ id: orderId }) });
      assert.equal(cancel.status, 200);
      const back = (await getProductByIdOrSlug(productId)).variants[0];
      assert.equal(Number(back.stock), 70);
      assert.equal(Number(back.price), 40);
    } finally {
      await cleanup(s, buyer);
    }
  });
});
