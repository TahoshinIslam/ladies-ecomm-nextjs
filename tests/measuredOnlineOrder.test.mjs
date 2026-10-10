// Items sold by measure (kg, g, l, ml) are ordered online by AMOUNT — ecom_erp migration 120.
//
// One product, one stock pool (loose mango in kg); the shopper picks 0.5 kg, 1 kg, 2 kg … in steps of the item's smallest
// sellable pack, at the price per kg. Everything an order flows into is decimal already (reservations, batches); these tests
// pin the storefront half: what the product page carries, what a bag and a quote accept, what is reserved and given back,
// and that a piece is still ordered whole.

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

describe("Items sold by measure are ordered by amount", { skip: !dbReady && skipReason }, () => {
  let createOrderPOST, cancelOrderPOST, previewPOST;
  let getProductByIdOrSlug, checkItems, addToCart, updateCartItem;
  let ONL;
  let counter = 0;
  const uid = () => `${Date.now().toString(36)}${(counter += 1)}`;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ POST: cancelOrderPOST } = await import("../app/api/orders/[id]/cancel/route.js"));
    ({ POST: previewPOST } = await import("../app/api/orders/preview/route.js"));
    ({ getProductByIdOrSlug } = await import("../services/productService.js"));
    ({ checkItems, addToCart, updateCartItem } = await import("../services/cartService.js"));
    ONL = `loc_m${uid()}`;
    await rawQuery(
      `INSERT INTO stock_locations (id, organization_id, name, code, location_type, status, fulfils_online, fulfilment_priority, channel, created_by_name)
       VALUES (?, ?, 'ONL — online warehouse', ?, 'warehouse', 'Active', 1, 1, 'online', 'test')`,
      [ONL, ORG, ONL.toUpperCase().slice(0, 30)],
    );
    await rawQuery(
      `INSERT INTO inventory_settings (organization_id, default_location_id, online_source_location_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE default_location_id = VALUES(default_location_id), online_source_location_id = VALUES(online_source_location_id)`,
      [ORG, ONL, ONL],
    );
  });

  after(async () => {
    await truncateAll();
    await rawQuery("UPDATE inventory_settings SET online_source_location_id = NULL WHERE organization_id = ?", [ORG]).catch(() => {});
    await rawQuery("DELETE FROM stock_locations WHERE organization_id = ? AND id = ?", [ORG, ONL]).catch(() => {});
    await disconnectTestDb();
  });

  const address = () => ({ fullName: "Mango Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" });
  const reserved = async (variantId) => Number((await rawQuery("SELECT COALESCE(SUM(reserved), 0) AS r FROM stock_levels WHERE location_id = ? AND variant_id = ?", [ONL, variantId]))[0].r);
  const shown = async (variantId) => Number((await rawQuery("SELECT stock FROM product_variants WHERE id = ?", [variantId]))[0].stock);

  /** A loose item sold by the kilo with 0.5 / 1 / 2 kg packs, `kg` of it on the online warehouse's shelf, at ৳`price` a kg. */
  async function looseItem({ kg = 20, price = 500, packs = [0.5, 1, 2] } = {}) {
    const product = await createTestProduct({ stock: 0, basePrice: price });
    const variantId = product.variants[0]._id.toString();
    const productId = product._id.toString();
    await clearVariantStock(variantId);
    await rawQuery("UPDATE product_variants SET base_unit = 'kg', quantity_scale = 3, sold_by = 'weight', sell_online = 1, price = ? WHERE id = ?", [price, variantId]);
    for (const [i, base] of packs.entries()) {
      await rawQuery(
        `INSERT INTO variant_packagings (id, organization_id, variant_id, code, name, base_quantity, price, sells, receives, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
        [`pkg_${uid()}`, ORG, variantId, `p${i}`, base < 1 ? `${base * 1000} g` : `${base} kg`, base, price * base, i],
      );
    }
    await seedBatch({ location: ONL, variantId, productId, quantity: kg, price, cost: price - 100 });
    return { product, variantId, productId };
  }

  async function withShopper(fn) {
    const buyer = await createTestUser({ role: "customer" });
    try {
      return await fn(buyer);
    } finally {
      await deleteRows("orders", "customer_id", buyer._id);
      await deleteRows("carts", "customer_id", buyer._id);
      await deleteRows("customers", "id", buyer._id);
    }
  }

  async function place(buyer, { productId, variantId }, quantity) {
    const res = await createOrderPOST(
      requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
        headers: { "idempotency-key": `meas-${uid()}-${uid()}` },
        body: { items: [{ productId, variantId, quantity }], shippingAddress: address() },
      }),
    );
    return { res, body: await res.json() };
  }

  async function quote(buyer, { productId, variantId }, quantity) {
    const res = await previewPOST(
      requestAs({
        method: "POST",
        url: "http://test/api/orders/preview",
        session: await createTestSession(buyer._id),
        body: { items: [{ productId, variantId, quantity }], shippingAddress: { country: "Bangladesh" } },
      }),
    );
    return { res, body: await res.json() };
  }

  test("the product page carries the unit, the step and the pack sizes", async () => {
    const item = await looseItem();
    const page = await getProductByIdOrSlug(item.productId);
    const v = page.variants[0];
    assert.equal(v.unit, "kg");
    assert.equal(v.step, 0.5, "the smallest sellable pack is the step");
    assert.deepEqual(v.packs.map((p) => p.baseQuantity), [0.5, 1, 2]);
    assert.equal(v.stock, 20, "20 kg on the shelf");
    await deleteRows("products", "id", item.productId);
  });

  test("a bag takes amounts in steps of the smallest pack and refuses the rest", async () => {
    const item = await looseItem();
    await withShopper(async (buyer) => {
      const uidOf = buyer._id.toString();
      await addToCart(uidOf, item.productId, item.variantId, 0.5);
      const cart = await addToCart(uidOf, item.productId, item.variantId, 1);
      assert.equal(cart.items[0].quantity, 1.5, "0.5 kg + 1 kg is 1.5 kg");
      assert.deepEqual(cart.items[0].measure.unit, "kg");
      await assert.rejects(() => addToCart(uidOf, item.productId, item.variantId, 0.25), /steps of 0\.5 kg/, "a quarter kilo is not a step");
      await assert.rejects(() => updateCartItem(uidOf, item.productId, item.variantId, 1.3), /steps of 0\.5 kg/);
      const set = await updateCartItem(uidOf, item.productId, item.variantId, 2);
      assert.equal(set.items[0].quantity, 2);
      const stored = await rawQuery("SELECT quantity FROM cart_items WHERE variant_id = ?", [item.variantId]);
      assert.equal(Number(stored[0].quantity), 2, "kept as a decimal");
      await assert.rejects(() => addToCart(uidOf, item.productId, item.variantId, 19), /stock/i, "more than the 20 kg on the shelf is refused");
    });
    const [ok] = await checkItems([{ productId: item.productId, variantId: item.variantId, quantity: 1.5 }]);
    assert.equal(ok.status, "ok");
    assert.equal(ok.lineTotal, 750, "1.5 kg at ৳500 a kilo");
    const [limited] = await checkItems([{ productId: item.productId, variantId: item.variantId, quantity: 25 }]);
    assert.notEqual(limited.status, "ok");
    await deleteRows("products", "id", item.productId);
  });

  test("1.5 kg is quoted, ordered and reserved as 1.5 — and cancelling gives it back", async () => {
    const item = await looseItem({ kg: 10, price: 500 });
    await withShopper(async (buyer) => {
      const q = await quote(buyer, item, 1.5);
      assert.equal(q.res.status, 200, JSON.stringify(q.body));
      assert.equal(q.body.preview.subtotal, 750);
      const refused = await place(buyer, item, 0.25);
      assert.ok([400, 422].includes(refused.res.status), `a quarter kilo is refused at checkout (${refused.res.status})`);

      const placed = await place(buyer, item, 1.5);
      assert.equal(placed.res.status, 201, JSON.stringify(placed.body));
      const orderId = String(placed.body.order?._id ?? placed.body.order?.id);
      const lines = await rawQuery("SELECT quantity, snapshot_unit, snapshot_price FROM order_items WHERE order_id = ?", [orderId]);
      assert.equal(lines.length, 1);
      assert.equal(Number(lines[0].quantity), 1.5, "the order line holds 1.5");
      assert.equal(lines[0].snapshot_unit, "kg");
      assert.equal(Number(lines[0].snapshot_price), 500, "priced per kilo");
      assert.equal(await reserved(item.variantId), 1.5, "1.5 kg is held on the shelf");
      assert.equal(await shown(item.variantId), 8, "what the shop shows follows (10 − 1.5, whole kilos)");

      const cancelled = await cancelOrderPOST(
        requestAs({ method: "POST", url: `http://test/api/orders/${orderId}/cancel`, session: await createTestSession(buyer._id), body: {} }),
        { params: Promise.resolve({ id: orderId }) },
      );
      assert.ok(cancelled.status < 300, `cancelled (${cancelled.status})`);
      assert.equal(await reserved(item.variantId), 0, "the 1.5 kg is given back");
    });
    await deleteRows("products", "id", item.productId);
  });

  test("a piece is still ordered whole", async () => {
    const product = await createTestProduct({ stock: 0, basePrice: 100 });
    const variantId = product.variants[0]._id.toString();
    const productId = product._id.toString();
    await clearVariantStock(variantId);
    await rawQuery("UPDATE product_variants SET sell_online = 1 WHERE id = ?", [variantId]);
    await seedBatch({ location: ONL, variantId, productId, quantity: 5, price: 100, cost: 60 });
    await withShopper(async (buyer) => {
      await assert.rejects(() => addToCart(buyer._id.toString(), productId, variantId, 1.5), /whole number/);
      const ok = await addToCart(buyer._id.toString(), productId, variantId, 2);
      assert.equal(ok.items[0].quantity, 2);
      const q = await quote(buyer, { productId, variantId }, 1.5);
      assert.ok(q.res.status >= 400, "a fraction of a piece is refused");
    });
    await deleteRows("products", "id", product._id);
  });
});
