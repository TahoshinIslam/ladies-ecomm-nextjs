// The Product Source Store (ecom_erp migrations 083–085).
//
// The dashboard chooses ONE store to supply the website. The storefront reads
// that choice from the shared database on every request — never from the
// environment — and from then on shows only what that store offers, with that
// store's availability, and reserves stock at that store and nowhere else.
//
// The dashboard side (switching, history, the replacement rule) is tested in
// ecom_erp (scripts/test-stores-and-source.mjs). Here the setting is written
// with SQL the way the dashboard writes it, and the storefront is the thing
// under test: catalog queries, variant availability, bag checks, checkout and
// the cache key.

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

describe("The website shows the Product Source Store", { skip: !dbReady && skipReason }, () => {
  let createOrderPOST;
  let listProducts;
  let getProductByIdOrSlug;
  let checkItems;
  let onlineSourceKey;
  const locationIds = [];
  let counter = 0;
  const uid = () => `${Date.now().toString(36)}${(counter += 1)}`;
  let store1;
  let store2;
  let originalSettings;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ listProducts, getProductByIdOrSlug } = await import("../services/productService.js"));
    ({ checkItems } = await import("../services/cartService.js"));
    ({ onlineSourceKey } = await import("../lib/onlineSource.js"));
    originalSettings = (await rawQuery("SELECT default_location_id, online_source_location_id FROM inventory_settings WHERE organization_id = ?", [ORG]))[0] ?? null;
    store1 = await makeLocation("Store 1 — Mirpur Warehouse");
    store2 = await makeLocation("Store 2 — Uttara Warehouse");
  });

  after(async () => {
    await setSource(null);
    await truncateAll();
    if (locationIds.length) {
      await rawQuery("DELETE FROM online_offer_policies WHERE organization_id = ?", [ORG]);
      await rawQuery("DELETE FROM variant_online_offers WHERE organization_id = ?", [ORG]);
      await rawQuery("UPDATE inventory_settings SET default_location_id = NULL WHERE organization_id = ? AND default_location_id IN (?)", [ORG, locationIds]);
      await rawQuery("DELETE FROM stock_locations WHERE organization_id = ? AND id IN (?)", [ORG, locationIds]);
    }
    await disconnectTestDb();
  });

  async function makeLocation(name, extra = {}) {
    const id = `loc_x${uid()}`;
    await rawQuery(
      `INSERT INTO stock_locations (id, organization_id, name, code, location_type, status, fulfils_online, fulfilment_priority, created_by_name)
       VALUES (?, ?, ?, ?, 'warehouse', ?, ?, 1, 'test')`,
      [id, ORG, name, id.toUpperCase().slice(0, 30), extra.status ?? "Active", extra.fulfilsOnline ?? 1],
    );
    locationIds.push(id);
    return id;
  }

  // Exactly what the dashboard's changeOnlineSource does to the database.
  async function setSource(locationId) {
    await rawQuery(
      `INSERT INTO inventory_settings (organization_id, online_source_location_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE online_source_location_id = VALUES(online_source_location_id)`,
      [ORG, locationId],
    );
  }

  async function stock(product, location, onHand) {
    const variantId = product.variants[0]._id.toString();
    // Quantities live on receipt batches; stock_levels is their projection. Replace what this location held.
    const [{ q }] = await rawQuery("SELECT COALESCE(SUM(quantity), 0) AS q FROM stock_batch_levels WHERE variant_id = ? AND location_id = ?", [variantId, location]);
    if (Number(q) > 0) await rawQuery("DELETE FROM stock_batch_levels WHERE variant_id = ? AND location_id = ?", [variantId, location]);
    await seedBatch({ location, variantId, productId: product._id.toString(), quantity: onHand });
  }

  const shownStock = async (product) => Number((await rawQuery("SELECT stock FROM product_variants WHERE id = ?", [product.variants[0]._id.toString()]))[0].stock);
  const offer = (product, location, offered) =>
    rawQuery(
      `INSERT INTO variant_online_offers (organization_id, location_id, variant_id, offered) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE offered = VALUES(offered)`,
      [ORG, location, product.variants[0]._id.toString(), offered ? 1 : 0],
    );
  const policy = (location, value) =>
    rawQuery(
      `INSERT INTO online_offer_policies (organization_id, location_id, policy) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE policy = VALUES(policy)`,
      [ORG, location, value],
    );
  const address = () => ({ fullName: "Source Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" });
  const names = async () => (await listProducts({ limit: 100 }, { isAdmin: false, includeFacets: false })).products.map((p) => p.name);

  async function place(buyer, product, quantity) {
    const res = await createOrderPOST(
      requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
        headers: { "idempotency-key": `key-${uid()}-${uid()}` },
        body: { items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity }], shippingAddress: address() },
      }),
    );
    return { res, body: await res.json() };
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

  // Three products with different assortments and quantities at the two stores.
  async function makeCatalog() {
    // Created with no source chosen: a new product is read back through the same
    // offer rule as everything else, so under a "selected" store it would not
    // even be visible to the fixture that is creating it.
    await setSource(null);
    const p1 = await createTestProduct({ stock: 0, basePrice: 1000 });
    const p2 = await createTestProduct({ stock: 0, basePrice: 2000 });
    const p3 = await createTestProduct({ stock: 0, basePrice: 3000 });
    await stock(p1, store1, 10);
    await stock(p2, store1, 0);
    await stock(p3, store1, 4);
    await stock(p1, store2, 0);
    await stock(p2, store2, 7);
    await stock(p3, store2, 9);
    // Store 2 offers only p2 and p3.
    await policy(store2, "selected");
    await offer(p2, store2, true);
    await offer(p3, store2, true);
    return { p1, p2, p3 };
  }

  test("with no source chosen the website behaves as before: any eligible store, the most one can supply", async () => {
    await setSource(null);
    const { p1, p2, p3 } = await makeCatalog();
    assert.equal(await shownStock(p1), 10);
    assert.equal(await shownStock(p2), 7);
    assert.equal(await shownStock(p3), 9, "the most ONE store can supply, not the sum");
    const listed = await names();
    for (const p of [p1, p2, p3]) assert.ok(listed.includes(p.name), "everything online-published is offered");
  });

  test("Store 1 as the source: its products and its availability, and never another store's stock", async () => {
    const { p1, p2, p3 } = await makeCatalog();
    await setSource(store1);
    assert.equal(await shownStock(p1), 10);
    assert.equal(await shownStock(p2), 0, "Store 2 holds 7 of p2; the website must not show them");
    assert.equal(await shownStock(p3), 4, "Store 1's own 4, not Store 2's 9");
    const listed = await names();
    for (const p of [p1, p2, p3]) assert.ok(listed.includes(p.name), "Store 1 offers all three by default");
    const full = await getProductByIdOrSlug(p2._id.toString());
    assert.equal(full.variants[0].stock, 0, "offered with none in stock: shown, as out of stock");
  });

  test("switching to Store 2 changes the catalog and the quantities at once — no restart", async () => {
    const { p1, p2, p3 } = await makeCatalog();
    await setSource(store1);
    const keyBefore = await onlineSourceKey();
    const before = await names();
    assert.ok(before.includes(p1.name));

    await setSource(store2);
    const after = await names();
    assert.ok(!after.includes(p1.name), "Store 2 does not offer p1, so the homepage and shop no longer list it");
    assert.ok(after.includes(p2.name) && after.includes(p3.name));
    assert.equal(await shownStock(p2), 7);
    assert.equal(await shownStock(p3), 9);
    assert.equal(await shownStock(p1), 0, "p1's 10 units are at Store 1, which is no longer the source");
    assert.notEqual(await onlineSourceKey(), keyBefore, "the cache key follows the source, so cached lists are not reused across stores");
    await assert.rejects(() => getProductByIdOrSlug(p1._id.toString()), /not found/i, "a product page for something this store does not offer is a 404");
    const detail = await getProductByIdOrSlug(p3._id.toString());
    assert.equal(detail.variants[0].stock, 9);
  });

  test("the cache key also moves when the assortment version does, but not for another organization's change", async () => {
    await setSource(store2);
    const a = await onlineSourceKey();
    await rawQuery("UPDATE inventory_settings SET online_assortment_version = online_assortment_version + 1 WHERE organization_id = ?", [ORG]);
    assert.notEqual(await onlineSourceKey(), a);
    await rawQuery("UPDATE inventory_settings SET online_assortment_version = online_assortment_version + 5 WHERE organization_id <> ?", [ORG]);
    const b = await onlineSourceKey();
    assert.equal(await onlineSourceKey(), b, "stable until this organization's own setting changes");
    assert.ok(a.startsWith(`${ORG}:`), "scoped by organization");
    assert.ok(a.includes(store2), "and by the selected store");
  });

  test("a bag is checked against the current source, with a reason a shopper can act on", async () => {
    const { p1, p2, p3 } = await makeCatalog();
    await setSource(store2);
    const item = (p, quantity) => ({ productId: p._id.toString(), variantId: p.variants[0]._id.toString(), quantity });
    const [r1, r2, r3, r4] = await checkItems([item(p1, 1), item(p2, 2), item(p3, 99), item(p3, 2)]);
    assert.equal(r1.status, "unavailable");
    assert.match(r1.message, /no longer available/i);
    assert.equal(r2.status, "ok");
    assert.equal(r3.status, "limited");
    assert.equal(r3.available, 9);
    assert.match(r3.message, /Only 9/);
    assert.equal(r4.status, "ok");

    await setSource(store1);
    const [again2] = await checkItems([item(p2, 1)]);
    assert.equal(again2.status, "out_of_stock", "Store 1 offers p2 but has none");
  });

  test("checkout reserves at the source and nowhere else; accepted orders keep their store when the source moves", async () => {
    const { p1, p3 } = await makeCatalog();
    await withShopper(async (buyer) => {
      await setSource(store1);
      const first = await place(buyer, p3, 3);
      assert.equal(first.res.status, 201, JSON.stringify(first.body));
      const reservedAt = await rawQuery("SELECT location_id, quantity, status FROM stock_reservations WHERE order_id = ?", [first.body.order?._id ?? first.body.order?.id ?? first.body.id]);
      assert.deepEqual(reservedAt.map((r) => r.location_id), [store1], "reserved at Store 1 although Store 2 holds more");

      await setSource(store2);
      const stillThere = await rawQuery("SELECT location_id, status FROM stock_reservations WHERE order_id = ?", [first.body.order?._id ?? first.body.order?.id ?? first.body.id]);
      assert.deepEqual(stillThere.map((r) => [r.location_id, r.status]), [[store1, "active"]], "switching moves nobody's order");

      const second = await place(buyer, p3, 2);
      assert.equal(second.res.status, 201, JSON.stringify(second.body));
      const secondAt = await rawQuery("SELECT DISTINCT location_id FROM stock_reservations WHERE order_id = ?", [second.body.order?._id ?? second.body.order?.id ?? second.body.id]);
      assert.deepEqual(secondAt.map((r) => r.location_id), [store2], "new orders follow the new source");

      const refused = await place(buyer, p1, 1);
      assert.equal(refused.res.status, 400, "p1 is not offered by Store 2");
      assert.match(refused.body.message, /not available online|unavailable/i);
    });
  });

  test("checkout never falls back to another store when the source cannot take orders", async () => {
    const { p3 } = await makeCatalog();
    const closed = await makeLocation("Store 3 — closed", { status: "Archived" });
    await stock(p3, closed, 50);
    await setSource(closed);
    await withShopper(async (buyer) => {
      const res = await place(buyer, p3, 1);
      assert.notEqual(res.res.status, 201, "no order may be accepted against a store that cannot fill it");
      assert.equal(await shownStock(p3), 0, "and the website shows nothing buyable rather than another store's stock");
    });
    await setSource(null);
  });

  test("switching never changes a price", async () => {
    const { p2 } = await makeCatalog();
    const price = async () => String((await rawQuery("SELECT base_price FROM products WHERE id = ?", [p2._id.toString()]))[0].base_price);
    const before = await price();
    await setSource(store1);
    await setSource(store2);
    assert.equal(await price(), before);
    const [listed] = (await listProducts({ limit: 100 }, { isAdmin: false, includeFacets: false })).products.filter((p) => String(p._id) === String(p2._id));
    assert.equal(Number(listed.basePrice), Number(before));
  });
});
