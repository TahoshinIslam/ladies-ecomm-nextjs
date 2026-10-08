// Which location fills a website order, and what the shop may promise —
// through the real POST /api/orders and POST /api/orders/[id]/cancel handlers.
//
// The policy under test (documented in ecom_erp/docs/retail-plan.md):
//
//   - an online order is filled from ONE place: the store's dedicated online
//     warehouse (inventory_settings.online_source_location_id), and only while
//     it is active and classified Online only (migration 108). If it cannot
//     cover the WHOLE order the order is refused and nothing is reserved
//     anywhere — never moved to another location, however much that holds;
//   - a shared, shop-only or archived warehouse is never used, and with no
//     valid dedicated warehouse nothing can be ordered at all;
//   - a location at a suspended branch can still be the source (the order is
//     saved unassigned);
//   - units sitting in a lot past its expiry date are never promised;
//   - what the shop shows (product_variants.stock) is the dedicated
//     warehouse's stock and nobody else's, and follows its state at once;
//   - a variant not offered online cannot be bought here.

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

describe("Online orders are filled from one eligible location", { skip: !dbReady && skipReason }, () => {
  let createOrderPOST, cancelOrderPOST;
  const branchIds = [];
  const locationIds = [];
  let counter = 0;
  const uid = () => `${Date.now().toString(36)}${(counter += 1)}`;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ POST: cancelOrderPOST } = await import("../app/api/orders/[id]/cancel/route.js"));
  });

  after(async () => {
    // Orders first (a branch with orders cannot be deleted), then the locations this suite made.
    await truncateAll();
    await rawQuery("UPDATE inventory_settings SET online_source_location_id = NULL WHERE organization_id = ?", [ORG]).catch(() => {});
    if (locationIds.length) await rawQuery("DELETE FROM stock_locations WHERE organization_id = ? AND id IN (?)", [ORG, locationIds]);
    for (const id of branchIds) await rawQuery("DELETE FROM branches WHERE id = ?", [id]);
    await disconnectTestDb();
  });

  const address = () => ({ fullName: "Fulfil Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" });

  async function makeBranch(status = "Active") {
    const id = `brn_f${uid()}`;
    await rawQuery(`INSERT INTO branches (id, organization_id, name, code, status, created_by_name) VALUES (?, ?, ?, ?, ?, 'test')`, [id, ORG, `Branch ${id}`, id.toUpperCase().slice(0, 30), status]);
    branchIds.push(id);
    return id;
  }

  async function makeLocation({ priority = 1, fulfils = 1, branch = null, status = "Active", channel = "both", dedicate = false } = {}) {
    const id = `loc_f${uid()}`;
    await rawQuery(
      `INSERT INTO stock_locations (id, organization_id, branch_id, name, code, location_type, status, fulfils_online, fulfilment_priority, channel, created_by_name)
       VALUES (?, ?, ?, ?, ?, 'warehouse', ?, ?, ?, ?, 'test')`,
      [id, ORG, branch, `Loc ${id}`, id.toUpperCase().slice(0, 30), status, fulfils, fulfils ? priority : null, dedicate ? "online" : channel],
    );
    locationIds.push(id);
    if (dedicate) await setSource(id);
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

  async function holdStock(location, product, quantity) {
    const v = product.variants[0]._id.toString();
    // What this location holds of the item is exactly `quantity`: its batches are replaced by one.
    await rawQuery("DELETE FROM stock_batch_levels WHERE variant_id = ? AND location_id = ?", [v, location]);
    await seedBatch({ location, variantId: v, productId: product._id.toString(), quantity });
  }

  async function newProduct() {
    // A fresh product is only visible to the shop while the store has a valid dedicated warehouse: start each test from
    // the fixture default (the test then points the source wherever it needs).
    await rawQuery("UPDATE inventory_settings SET online_source_location_id = NULL WHERE organization_id = ?", [ORG]);
    const product = await createTestProduct({ stock: 0 });
    // The product helper opens at the store's default location; clear that so each test sets its own stock.
    await clearVariantStock(product.variants[0]._id.toString());
    return product;
  }

  async function place(buyer, lines) {
    const res = await createOrderPOST(
      requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
        body: { items: lines.map(([product, quantity]) => ({ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity })), shippingAddress: address() },
      }),
    );
    return { res, body: await res.json() };
  }

  const reservations = (orderId) => rawQuery("SELECT location_id AS locationId, variant_id AS variantId, quantity, status FROM stock_reservations WHERE order_id = ? ORDER BY variant_id", [orderId]);
  const reservedAt = async (location, product) => Number((await rawQuery("SELECT reserved FROM stock_levels WHERE location_id = ? AND variant_id = ?", [location, product.variants[0]._id.toString()]))[0]?.reserved ?? 0);
  const projected = async (product) => Number((await rawQuery("SELECT stock FROM product_variants WHERE id = ?", [product.variants[0]._id.toString()]))[0].stock);

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

  test("the dedicated warehouse fills the order, even when another location holds more and has a better priority", async () => {
    const product = await newProduct();
    const other = await makeLocation({ priority: 1 });
    const dedicated = await makeLocation({ priority: 2, dedicate: true });
    await holdStock(other, product, 50);
    await holdStock(dedicated, product, 10);
    await withShopper(async (buyer) => {
      const { res, body } = await place(buyer, [[product, 3]]);
      assert.equal(res.status, 201);
      assert.deepEqual((await reservations(body.order._id)).map((r) => r.locationId), [dedicated], "only the dedicated warehouse");
      assert.equal(await reservedAt(dedicated, product), 3);
      assert.equal(await reservedAt(other, product), 0);
    });
    await deleteRows("products", "id", product._id);
  });

  test("when the dedicated warehouse cannot cover it, the order is refused — never moved to another location", async () => {
    const product = await newProduct();
    const dedicated = await makeLocation({ dedicate: true });
    const other = await makeLocation({ priority: 1 });
    await holdStock(dedicated, product, 2);
    await holdStock(other, product, 100);
    await withShopper(async (buyer) => {
      const { res, body } = await place(buyer, [[product, 5]]);
      assert.ok([400, 409].includes(res.status), JSON.stringify(body));
      assert.equal(await reservedAt(other, product), 0, "the other warehouse is never touched");
      assert.equal(await reservedAt(dedicated, product), 0);
      assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?", [buyer._id]))[0].n, 0, "no order was left behind");
    });
    await deleteRows("products", "id", product._id);
  });

  test("a whole order comes from the dedicated warehouse: an item it lacks is refused whole, even if another warehouse has it", async () => {
    const a = await newProduct();
    const b = await newProduct();
    const dedicated = await makeLocation({ dedicate: true });
    const second = await makeLocation({ priority: 2 });
    await holdStock(dedicated, a, 5);
    await holdStock(second, b, 5);
    await withShopper(async (buyer) => {
      const { res, body } = await place(buyer, [[a, 1], [b, 1]]);
      assert.ok([400, 409].includes(res.status), JSON.stringify(body));
      assert.match(body.error ?? body.message ?? JSON.stringify(body), /Insufficient stock/i);
      assert.equal(await reservedAt(dedicated, a), 0, "the line it could cover was abandoned cleanly");
      assert.equal(await reservedAt(second, b), 0);
      assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?", [buyer._id]))[0].n, 0, "no order was left behind");
    });
    await deleteRows("products", "id", a._id);
    await deleteRows("products", "id", b._id);
  });

  test("a warehouse that is not Online only is never used — even marked for online orders as the source", async () => {
    const product = await newProduct();
    const shared = await makeLocation({ channel: "both" });
    const shopOnly = await makeLocation({ channel: "shop", fulfils: 0 });
    await holdStock(shared, product, 100);
    await holdStock(shopOnly, product, 100);
    for (const legacy of [shared, shopOnly]) {
      await setSource(legacy);
      await withShopper(async (buyer) => {
        const { res } = await place(buyer, [[product, 1]]);
        assert.ok([400, 409].includes(res.status), `refused (${res.status})`);
        assert.equal(await reservedAt(legacy, product), 0);
      });
    }
    assert.equal(await projected(product), 0, "and the shop shows nothing from them");
    await deleteRows("products", "id", product._id);
  });

  test("with no source at all, nothing can be ordered and nothing falls back to a warehouse that fills online orders", async () => {
    const product = await newProduct();
    const eligibleLooking = await makeLocation({ priority: 1 });
    await holdStock(eligibleLooking, product, 100);
    await rawQuery("UPDATE inventory_settings SET online_source_location_id = NULL WHERE organization_id = ?", [ORG]);
    await withShopper(async (buyer) => {
      const { res, body } = await place(buyer, [[product, 1]]);
      assert.ok([400, 409].includes(res.status), JSON.stringify(body));
      assert.match(JSON.stringify(body), /no online warehouse|not available online/i);
      assert.equal(await reservedAt(eligibleLooking, product), 0);
    });
    assert.equal(await projected(product), 0);
    await deleteRows("products", "id", product._id);
  });

  test("an archived dedicated warehouse is never used, and no other location takes over", async () => {
    const product = await newProduct();
    const archived = await makeLocation({ status: "Archived", dedicate: true });
    const fine = await makeLocation({ priority: 2 });
    await holdStock(archived, product, 10);
    await holdStock(fine, product, 10);
    await withShopper(async (buyer) => {
      const { res } = await place(buyer, [[product, 2]]);
      assert.ok([400, 409].includes(res.status), `refused (${res.status})`);
      assert.equal(await reservedAt(archived, product), 0);
      assert.equal(await reservedAt(fine, product), 0);
    });
    await deleteRows("products", "id", product._id);
  });

  test("a location at a suspended branch still fills the order — which is saved unassigned; at an active branch it is assigned", async () => {
    const product = await newProduct();
    const suspendedBranch = await makeBranch("Suspended");
    const suspended = await makeLocation({ priority: 1, branch: suspendedBranch, dedicate: true });
    await holdStock(suspended, product, 10);
    await withShopper(async (buyer) => {
      const first = await place(buyer, [[product, 1]]);
      assert.equal(first.res.status, 201, "a suspended branch does not stop a sale");
      assert.deepEqual((await reservations(first.body.order._id)).map((r) => r.locationId), [suspended]);
      const [a] = await rawQuery("SELECT branch_id AS branchId FROM orders WHERE id = ?", [first.body.order._id]);
      assert.equal(a.branchId, null, "…it is explicitly unassigned, not mis-assigned");

      const activeBranch = await makeBranch("Active");
      await rawQuery("UPDATE stock_locations SET branch_id = ? WHERE id = ?", [activeBranch, suspended]);
      const second = await place(buyer, [[product, 1]]);
      const [b] = await rawQuery("SELECT branch_id AS branchId FROM orders WHERE id = ?", [second.body.order._id]);
      assert.equal(b.branchId, activeBranch, "once its branch is active again, new orders are assigned to it");
    });
    await deleteRows("products", "id", product._id);
  });

  test("units in a lot past their expiry date are not promised", async () => {
    const product = await newProduct();
    const location = await makeLocation({ dedicate: true });
    // 5 on hand: 2 undated, and 3 in a lot whose printed date was yesterday.
    const lotId = `lot_f${uid()}`;
    const variantId = product.variants[0]._id.toString();
    await holdStock(location, product, 2);
    await seedBatch({ location, variantId, productId: product._id.toString(), quantity: 3, lot: { id: lotId, ref: "EXPIRED-1", expiryDate: new Date(Date.now() + 6 * 3600000 - 86400000).toISOString().slice(0, 10) } });
    await withShopper(async (buyer) => {
      const tooMany = await place(buyer, [[product, 3]]);
      assert.ok([400, 409].includes(tooMany.res.status), "5 on hand, 3 of them expired: only 2 can be promised");
      assert.equal(await projected(product), 2, "the shop itself shows 2, not 5");
      const ok = await place(buyer, [[product, 2]]);
      assert.equal(ok.res.status, 201);
    });
    await clearVariantStock(variantId);
    await rawQuery("DELETE FROM stock_lots WHERE id = ?", [lotId]);
    await deleteRows("products", "id", product._id);
  });

  test("two shoppers racing for the last unit: exactly one wins", async () => {
    const product = await newProduct();
    const location = await makeLocation({ dedicate: true });
    await holdStock(location, product, 1);
    const buyers = [await createTestUser({ role: "customer" }), await createTestUser({ role: "customer" }), await createTestUser({ role: "customer" })];
    try {
      const results = await Promise.all(buyers.map((b) => place(b, [[product, 1]])));
      assert.equal(results.filter((r) => r.res.status === 201).length, 1, JSON.stringify(results.map((r) => r.res.status)));
      assert.equal(await reservedAt(location, product), 1);
    } finally {
      for (const b of buyers) {
        await deleteRows("orders", "customer_id", b._id);
        await deleteRows("carts", "customer_id", b._id);
        await deleteRows("customers", "id", b._id);
      }
    }
    await deleteRows("products", "id", product._id);
  });

  test("cancelling gives the units back at the dedicated warehouse that held them", async () => {
    const product = await newProduct();
    const dedicated = await makeLocation({ dedicate: true });
    await holdStock(dedicated, product, 8);
    await withShopper(async (buyer) => {
      const { body } = await place(buyer, [[product, 4]]);
      assert.deepEqual((await reservations(body.order._id)).map((r) => r.locationId), [dedicated]);
      const res = await cancelOrderPOST(
        requestAs({ method: "POST", url: `http://test/api/orders/${body.order._id}/cancel`, session: await createTestSession(buyer._id), body: {} }),
        { params: Promise.resolve({ id: body.order._id }) },
      );
      assert.equal(res.status, 200);
      assert.equal(await reservedAt(dedicated, product), 0);
      assert.equal((await reservations(body.order._id))[0].status, "released");
    });
    await deleteRows("products", "id", product._id);
  });

  test("the figure the shop shows is the dedicated warehouse's stock — nobody else's — and follows its state at once", async () => {
    const product = await newProduct();
    const dedicated = await makeLocation({ priority: 1, dedicate: true });
    const b = await makeLocation({ priority: 2 });
    await holdStock(dedicated, product, 4);
    await holdStock(b, product, 7);
    assert.equal(await projected(product), 4, "not 11 and not 7: only the dedicated warehouse counts");
    await rawQuery("UPDATE stock_locations SET channel = 'both' WHERE id = ?", [dedicated]);
    assert.equal(await projected(product), 0, "a source that is no longer Online only offers nothing");
    await rawQuery("UPDATE stock_locations SET channel = 'online' WHERE id = ?", [dedicated]);
    assert.equal(await projected(product), 4, "and returns when it is again");
    await rawQuery("UPDATE stock_locations SET status = 'Archived' WHERE id = ?", [dedicated]);
    assert.equal(await projected(product), 0, "archiving removes it — and the 7 elsewhere never take over");
    await rawQuery("UPDATE stock_locations SET status = 'Active' WHERE id = ?", [dedicated]);
    await deleteRows("products", "id", product._id);
  });

  test("a variant not offered online cannot be bought here, and a product with none is not listed", async () => {
    const product = await newProduct();
    const location = await makeLocation({ dedicate: true });
    await holdStock(location, product, 5);
    const { listProducts, getProductByIdOrSlug } = await import("../services/productService.js");
    const listed = async () => (await listProducts({ limit: "100" })).products?.some((p) => String(p._id) === String(product._id)) ?? false;
    assert.equal(await listed(), true, "listed while a variant is offered online");
    await rawQuery("UPDATE product_variants SET sell_online = 0 WHERE id = ?", [product.variants[0]._id.toString()]);
    await withShopper(async (buyer) => {
      const { res, body } = await place(buyer, [[product, 1]]);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(JSON.stringify(body), /not available online/i);
    });
    assert.equal(await listed(), false, "not listed once none of its variants is offered online");
    await assert.rejects(() => getProductByIdOrSlug(String(product._id)), /not found/i);
    await deleteRows("products", "id", product._id);
  });
});
