// The online store sells from ONE dedicated, Online-only warehouse (ecom_erp migration 108) — the storefront's half of
// acceptance scenarios OWH-02, OWH-03, OWH-06, OWH-08 and OWH-09.
//
// The dashboard side (choosing the source, the guards on it, tills, transfers, authority) is tested in ecom_erp
// (scripts/test-online-warehouse.mjs). Here the setting is written with SQL the way the dashboard writes it, and the
// storefront's real route handlers are the thing under test: product page, listing, bag check, quote and checkout —
// including requests that try to name a different warehouse, branch or location themselves.
//
// Each refusal must leave no order, no reservation, no payment and no stock movement behind.

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

describe("The online store sells from its dedicated warehouse only", { skip: !dbReady && skipReason }, () => {
  let createOrderPOST, cancelOrderPOST, previewPOST;
  let listProducts, getProductByIdOrSlug, checkItems;
  const locationIds = [];
  let counter = 0;
  const uid = () => `${Date.now().toString(36)}${(counter += 1)}`;
  let ONL;
  let BRANCH_SHOP;
  let MIX;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ POST: cancelOrderPOST } = await import("../app/api/orders/[id]/cancel/route.js"));
    ({ POST: previewPOST } = await import("../app/api/orders/preview/route.js"));
    ({ listProducts, getProductByIdOrSlug } = await import("../services/productService.js"));
    ({ checkItems } = await import("../services/cartService.js"));
    ONL = await makeLocation("ONL — dedicated online warehouse", { channel: "online" });
    BRANCH_SHOP = await makeLocation("Branch A shop", { channel: "shop", fulfils: 0 });
    MIX = await makeLocation("MIX — shared warehouse", { channel: "both" });
    // The fixture default is ONL, so the product helper never promotes (or reclassifies) any of the other locations.
    await rawQuery(
      `INSERT INTO inventory_settings (organization_id, default_location_id, online_source_location_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE default_location_id = VALUES(default_location_id), online_source_location_id = VALUES(online_source_location_id)`,
      [ORG, ONL, ONL],
    );
  });

  after(async () => {
    await truncateAll();
    await rawQuery("UPDATE inventory_settings SET online_source_location_id = NULL WHERE organization_id = ?", [ORG]).catch(() => {});
    if (locationIds.length) await rawQuery("DELETE FROM stock_locations WHERE organization_id = ? AND id IN (?)", [ORG, locationIds]).catch(() => {});
    await disconnectTestDb();
  });

  async function makeLocation(name, { channel = "both", fulfils = 1, status = "Active" } = {}) {
    const id = `loc_w${uid()}`;
    await rawQuery(
      `INSERT INTO stock_locations (id, organization_id, name, code, location_type, status, fulfils_online, fulfilment_priority, channel, created_by_name)
       VALUES (?, ?, ?, ?, 'warehouse', ?, ?, 1, ?, 'test')`,
      [id, ORG, name, id.toUpperCase().slice(0, 30), status, fulfils, channel],
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

  const address = () => ({ fullName: "Owh Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" });

  async function stock(variantId, productId, location, quantity) {
    await rawQuery("DELETE FROM stock_batch_levels WHERE variant_id = ? AND location_id = ?", [variantId, location]);
    if (quantity > 0) await seedBatch({ location, variantId, productId, quantity });
  }

  const reserved = async (location, variantId) => Number((await rawQuery("SELECT COALESCE(SUM(reserved), 0) AS r FROM stock_levels WHERE location_id = ? AND variant_id = ?", [location, variantId]))[0].r);
  const shown = async (variantId) => Number((await rawQuery("SELECT stock FROM product_variants WHERE id = ?", [variantId]))[0].stock);
  const counts = async () => ({
    orders: Number((await rawQuery("SELECT COUNT(*) n FROM orders WHERE organization_id = ?", [ORG]))[0].n),
    reservations: Number((await rawQuery("SELECT COUNT(*) n FROM stock_reservations WHERE organization_id = ?", [ORG]))[0].n),
    payments: Number((await rawQuery("SELECT COUNT(*) n FROM payments WHERE organization_id = ?", [ORG]).catch(() => [{ n: 0 }]))[0].n),
    movements: Number((await rawQuery("SELECT COUNT(*) n FROM stock_movements WHERE organization_id = ?", [ORG]))[0].n),
  });

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

  async function place(buyer, product, quantity, extra = {}, itemExtra = {}) {
    const res = await createOrderPOST(
      requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
        headers: { "idempotency-key": `owh-${uid()}-${uid()}` },
        body: { items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity, ...itemExtra }], shippingAddress: address(), ...extra },
      }),
    );
    return { res, body: await res.json() };
  }

  async function quote(buyer, product, quantity) {
    const res = await previewPOST(
      requestAs({
        method: "POST",
        url: "http://test/api/orders/preview",
        session: await createTestSession(buyer._id),
        body: { items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity }], shippingAddress: { country: "Bangladesh" } },
      }),
    );
    return { res, body: await res.json() };
  }

  test("OWH-02/03: zero online stock with 20 at a branch and 20 at a shared warehouse — nothing online can use them", async () => {
    await setSource(ONL);
    const product = await createTestProduct({ stock: 0 });
    const v = product.variants[0]._id.toString();
    const p = product._id.toString();
    await clearVariantStock(v);
    await stock(v, p, BRANCH_SHOP, 20);
    await stock(v, p, MIX, 20);
    await stock(v, p, ONL, 0);

    assert.equal(await shown(v), 0, "the stored figure the shop lists is the dedicated warehouse's: 0");
    const page = await getProductByIdOrSlug(p);
    assert.equal(page.variants[0].stock, 0, "the product page shows the variant as out of stock");
    const listed = (await listProducts({ limit: 100 }, { isAdmin: false, includeFacets: false })).products.find((x) => String(x._id) === p);
    assert.ok(!listed || (listed.variants?.[0]?.stock ?? 0) === 0, "the listing never shows the 40 elsewhere");
    const [bag] = await checkItems([{ productId: p, variantId: v, quantity: 1 }]);
    assert.notEqual(bag.status, "ok", "the bag check refuses it");

    await withShopper(async (buyer) => {
      const before = await counts();
      const q = await quote(buyer, product, 1);
      assert.ok(q.res.status >= 400, `the quote is refused (${q.res.status})`);
      const refused = await place(buyer, product, 1);
      assert.ok([400, 409].includes(refused.res.status), `checkout is refused (${refused.res.status}): ${JSON.stringify(refused.body)}`);
      assert.deepEqual(await counts(), before, "no order, reservation, payment or movement was created");
      assert.equal(await reserved(BRANCH_SHOP, v), 0);
      assert.equal(await reserved(MIX, v), 0);
    });
    await deleteRows("products", "id", product._id);
  });

  test("OWH-02: forged warehouse / branch / location ids in the request cannot redirect the order", async () => {
    await setSource(ONL);
    const product = await createTestProduct({ stock: 0 });
    const v = product.variants[0]._id.toString();
    const p = product._id.toString();
    await clearVariantStock(v);
    await stock(v, p, BRANCH_SHOP, 20);
    await stock(v, p, MIX, 20);
    await withShopper(async (buyer) => {
      const before = await counts();
      const forgeries = [
        [{ locationId: MIX, warehouseId: MIX, branchId: BRANCH_SHOP, fulfilmentLocationId: BRANCH_SHOP, siteId: MIX }, {}],
        [{}, { locationId: BRANCH_SHOP, warehouseId: MIX, branchId: BRANCH_SHOP }],
        [{ shippingAddress: { ...address(), locationId: MIX, warehouseId: MIX } }, {}],
      ];
      for (const [extra, itemExtra] of forgeries) {
        const r = await place(buyer, product, 1, extra, itemExtra);
        assert.ok([400, 409].includes(r.res.status), `forged request refused (${r.res.status}): ${JSON.stringify(r.body)}`);
      }
      assert.deepEqual(await counts(), before, "nothing was created by any forged request");
      assert.equal(await reserved(MIX, v), 0, "the shared warehouse was never claimed");
      assert.equal(await reserved(BRANCH_SHOP, v), 0, "nor the branch");
    });
    await deleteRows("products", "id", product._id);
  });

  test("OWH-06: no valid source — nothing is offered, quoted or ordered, and nothing falls back", async () => {
    const product = await createTestProduct({ stock: 0 });
    const v = product.variants[0]._id.toString();
    const p = product._id.toString();
    await clearVariantStock(v);
    await stock(v, p, ONL, 10);
    await stock(v, p, MIX, 50);
    await stock(v, p, BRANCH_SHOP, 50);
    const archived = await makeLocation("Archived online warehouse", { channel: "online", status: "Archived" });
    await stock(v, p, archived, 10);

    const cases = [
      ["no source at all", null],
      ["a legacy source pointing at the shared warehouse", MIX],
      ["a source that is a shop-only warehouse", BRANCH_SHOP],
      ["an archived Online-only source", archived],
    ];
    for (const [label, source] of cases) {
      await setSource(source);
      await withShopper(async (buyer) => {
        const before = await counts();
        const r = await place(buyer, product, 1);
        assert.ok([400, 409].includes(r.res.status), `${label}: checkout refused (${r.res.status}) ${JSON.stringify(r.body)}`);
        const q = await quote(buyer, product, 1);
        assert.ok(q.res.status >= 400, `${label}: quote refused (${q.res.status})`);
        assert.deepEqual(await counts(), before, `${label}: nothing created`);
      });
      assert.equal(await shown(v), 0, `${label}: the shop shows nothing`);
    }
    // An explicit repair makes it work again.
    await setSource(ONL);
    assert.equal(await shown(v), 10);
    await withShopper(async (buyer) => {
      const ok = await place(buyer, product, 2);
      assert.equal(ok.res.status, 201, JSON.stringify(ok.body));
      const at = await rawQuery("SELECT DISTINCT location_id AS l FROM stock_reservations WHERE order_id = ?", [ok.body.order?._id ?? ok.body.order?.id]);
      assert.deepEqual(at.map((r) => r.l), [ONL], "reserved at ONL and nowhere else");
      const [snap] = await rawQuery("SELECT source_location_id AS s FROM orders WHERE id = ?", [ok.body.order?._id ?? ok.body.order?.id]);
      assert.equal(snap.s, ONL, "the order's own record names the warehouse it was served from (immutable snapshot)");
    });
    await deleteRows("products", "id", product._id);
  });

  test("OWH-08: two shoppers race for ONL's last unit while the branch and shared warehouse hold plenty — one wins, at ONL", async () => {
    await setSource(ONL);
    const product = await createTestProduct({ stock: 0 });
    const v = product.variants[0]._id.toString();
    const p = product._id.toString();
    await clearVariantStock(v);
    await stock(v, p, ONL, 1);
    await stock(v, p, MIX, 30);
    await stock(v, p, BRANCH_SHOP, 30);
    const buyers = [await createTestUser({ role: "customer" }), await createTestUser({ role: "customer" }), await createTestUser({ role: "customer" })];
    try {
      const results = await Promise.all(buyers.map((b) => place(b, product, 1)));
      assert.equal(results.filter((r) => r.res.status === 201).length, 1, JSON.stringify(results.map((r) => r.res.status)));
      assert.equal(await reserved(ONL, v), 1);
      assert.equal(await reserved(MIX, v), 0, "the losers were not given the shared warehouse's stock");
      assert.equal(await reserved(BRANCH_SHOP, v), 0);
    } finally {
      for (const b of buyers) {
        await deleteRows("orders", "customer_id", b._id);
        await deleteRows("carts", "customer_id", b._id);
        await deleteRows("customers", "id", b._id);
      }
    }
    await deleteRows("products", "id", product._id);
  });

  test("OWH-09: variants are independent — red-M 1, red-L 10, blue-M 0 online; 20 blue-M at the branch change nothing", async () => {
    await setSource(ONL);
    // Three stocked combinations of one parent, each its own SKU, built the way the dashboard stores them.
    const parent = await createTestProduct({ stock: 0 });
    const parentId = parent._id.toString();
    const redM = parent.variants[0]._id.toString();
    const mk = async (sku, name) => {
      const id = `var_${uid()}${Math.random().toString(16).slice(2, 8)}`.slice(0, 32);
      await rawQuery(
        `INSERT INTO product_variants (id, organization_id, product_id, variant_name, sku, price, stock, sell_online, position, attributes, images) SELECT ?, organization_id, product_id, ?, ?, price, 0, 1, 9, attributes, images FROM product_variants WHERE id = ?`,
        [id, name, sku, redM],
      );
      return id;
    };
    const redL = await mk(`SKU-RL-${uid()}`, "Red / L");
    const blueM = await mk(`SKU-BM-${uid()}`, "Blue / M");
    await rawQuery("UPDATE product_variants SET variant_name = 'Red / M' WHERE id = ?", [redM]);
    for (const id of [redM, redL, blueM]) await clearVariantStock(id);
    await stock(redM, parentId, ONL, 1);
    await stock(redL, parentId, ONL, 10);
    await stock(blueM, parentId, ONL, 0);
    await stock(blueM, parentId, BRANCH_SHOP, 20);
    assert.deepEqual([await shown(redM), await shown(redL), await shown(blueM)], [1, 10, 0], "each SKU shows its own online stock; the branch's 20 blue-M do not count");

    await withShopper(async (buyer) => {
      const item = (variantId, quantity) => ({ productId: parentId, variantId, quantity });
      const [r1, r2, r3] = await checkItems([item(redM, 1), item(redL, 10), item(blueM, 1)]);
      assert.equal(r1.status, "ok");
      assert.equal(r2.status, "ok");
      assert.notEqual(r3.status, "ok", "blue-M is out of stock online although the branch holds 20");

      const buyRedM = await createOrderPOST(requestAs({ method: "POST", url: "http://test/api/orders", session: await createTestSession(buyer._id), headers: { "idempotency-key": `owh-${uid()}-${uid()}` }, body: { items: [item(redM, 1)], shippingAddress: address() } }));
      assert.equal(buyRedM.status, 201);
      assert.equal(await reserved(ONL, redM), 1, "red-M's balance moved");
      assert.equal(await reserved(ONL, redL), 0, "red-L's did not");
      assert.equal(await reserved(ONL, blueM), 0);
      assert.deepEqual([await shown(redM), await shown(redL), await shown(blueM)], [0, 10, 0]);

      const blue = await createOrderPOST(requestAs({ method: "POST", url: "http://test/api/orders", session: await createTestSession(buyer._id), headers: { "idempotency-key": `owh-${uid()}-${uid()}` }, body: { items: [item(blueM, 1)], shippingAddress: address() } }));
      assert.ok([400, 409].includes(blue.status), `blue-M is refused online (${blue.status})`);
      assert.equal(await reserved(BRANCH_SHOP, blueM), 0, "and the branch's 20 are never claimed");

      const undefined_ = await createOrderPOST(requestAs({ method: "POST", url: "http://test/api/orders", session: await createTestSession(buyer._id), headers: { "idempotency-key": `owh-${uid()}-${uid()}` }, body: { items: [item("var_does_not_exist_blue_l", 1)], shippingAddress: address() } }));
      assert.ok(undefined_.status >= 400 && undefined_.status < 500, `an undefined combination (blue-L) cannot be ordered (${undefined_.status})`);
    });
    await deleteRows("products", "id", parent._id);
  });
});
