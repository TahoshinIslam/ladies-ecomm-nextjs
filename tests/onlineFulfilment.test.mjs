// Which location fills a website order, and what the shop may promise —
// through the real POST /api/orders and POST /api/orders/[id]/cancel handlers.
//
// The policy under test (documented in ecom_erp/docs/retail-plan.md):
//
//   - an online order is filled from ONE location: the first eligible one, by
//     priority, that can cover the WHOLE order. Split fulfilment is not
//     supported, so an order no single location can cover is refused and
//     nothing is reserved anywhere;
//   - eligible = active, marked fulfils_online, at no branch or an active one;
//     a disabled, archived or suspended-branch location is never used;
//   - units sitting in a lot past its expiry date are never promised;
//   - what the shop shows (product_variants.stock) is the most ONE eligible
//     location can supply, and follows eligibility changes at once;
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

  async function makeLocation({ priority = 1, fulfils = 1, branch = null, status = "Active" } = {}) {
    const id = `loc_f${uid()}`;
    await rawQuery(
      `INSERT INTO stock_locations (id, organization_id, branch_id, name, code, location_type, status, fulfils_online, fulfilment_priority, created_by_name)
       VALUES (?, ?, ?, ?, ?, 'warehouse', ?, ?, ?, 'test')`,
      [id, ORG, branch, `Loc ${id}`, id.toUpperCase().slice(0, 30), status, fulfils, fulfils ? priority : null],
    );
    locationIds.push(id);
    return id;
  }

  async function holdStock(location, product, quantity) {
    const v = product.variants[0]._id.toString();
    await rawQuery(
      `INSERT INTO stock_levels (organization_id, location_id, variant_id, product_id, on_hand, reserved) VALUES (?, ?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE on_hand = VALUES(on_hand)`,
      [ORG, location, v, product._id.toString(), quantity],
    );
  }

  async function newProduct() {
    const product = await createTestProduct({ stock: 0 });
    // The product helper opens at the store's default location; clear that so each test sets its own stock.
    await rawQuery("DELETE FROM stock_levels WHERE variant_id = ?", [product.variants[0]._id.toString()]);
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

  test("the first eligible location, by priority, that can cover the order is used", async () => {
    const product = await newProduct();
    const low = await makeLocation({ priority: 2 });
    const high = await makeLocation({ priority: 1 });
    await holdStock(low, product, 10);
    await holdStock(high, product, 10);
    await withShopper(async (buyer) => {
      const { res, body } = await place(buyer, [[product, 3]]);
      assert.equal(res.status, 201);
      assert.deepEqual((await reservations(body.order._id)).map((r) => r.locationId), [high], "priority 1 fills it");
      assert.equal(await reservedAt(high, product), 3);
      assert.equal(await reservedAt(low, product), 0);
    });
    await deleteRows("products", "id", product._id);
  });

  test("when the best location cannot cover it, the next one that can does", async () => {
    const product = await newProduct();
    const high = await makeLocation({ priority: 1 });
    const low = await makeLocation({ priority: 2 });
    await holdStock(high, product, 2);
    await holdStock(low, product, 10);
    await withShopper(async (buyer) => {
      const { res, body } = await place(buyer, [[product, 5]]);
      assert.equal(res.status, 201);
      assert.deepEqual((await reservations(body.order._id)).map((r) => r.locationId), [low]);
      assert.equal(await reservedAt(high, product), 0, "the location that fell short holds nothing");
    });
    await deleteRows("products", "id", product._id);
  });

  test("a whole order comes from one location: items spread across two locations are refused, and nothing is reserved", async () => {
    const a = await newProduct();
    const b = await newProduct();
    const first = await makeLocation({ priority: 1 });
    const second = await makeLocation({ priority: 2 });
    await holdStock(first, a, 5);
    await holdStock(second, b, 5);
    await withShopper(async (buyer) => {
      const { res, body } = await place(buyer, [[a, 1], [b, 1]]);
      assert.equal(res.status, 409, JSON.stringify(body));
      assert.match(body.error ?? body.message ?? JSON.stringify(body), /no single location|Insufficient stock/i);
      assert.equal(await reservedAt(first, a), 0, "the first location was abandoned cleanly");
      assert.equal(await reservedAt(second, b), 0);
      assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?", [buyer._id]))[0].n, 0, "no order was left behind");
    });
    await deleteRows("products", "id", a._id);
    await deleteRows("products", "id", b._id);
  });

  test("a location not marked for online orders is never used, however much it holds", async () => {
    const product = await newProduct();
    const closed = await makeLocation({ fulfils: 0 });
    await holdStock(closed, product, 100);
    await withShopper(async (buyer) => {
      const { res } = await place(buyer, [[product, 1]]);
      assert.ok([400, 409].includes(res.status), `refused (${res.status})`);
      assert.equal(await reservedAt(closed, product), 0);
    });
    await deleteRows("products", "id", product._id);
  });

  test("an archived location is skipped", async () => {
    const product = await newProduct();
    const archived = await makeLocation({ priority: 1, status: "Archived" });
    const fine = await makeLocation({ priority: 2 });
    await holdStock(archived, product, 10);
    await holdStock(fine, product, 10);
    await withShopper(async (buyer) => {
      const { res, body } = await place(buyer, [[product, 2]]);
      assert.equal(res.status, 201);
      assert.deepEqual((await reservations(body.order._id)).map((r) => r.locationId), [fine]);
      assert.equal(await reservedAt(archived, product), 0);
    });
    await deleteRows("products", "id", product._id);
  });

  test("a location at a suspended branch still fills the order — which is saved unassigned; at an active branch it is assigned", async () => {
    const product = await newProduct();
    const suspendedBranch = await makeBranch("Suspended");
    const suspended = await makeLocation({ priority: 1, branch: suspendedBranch });
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
    const location = await makeLocation();
    await holdStock(location, product, 5);
    const lotId = `lot_f${uid()}`;
    const variantId = product.variants[0]._id.toString();
    await rawQuery(
      "INSERT INTO stock_lots (id, organization_id, variant_id, product_id, lot_ref, expiry_date) VALUES (?, ?, ?, ?, 'EXPIRED-1', DATE_SUB(UTC_DATE(), INTERVAL 1 DAY))",
      [lotId, ORG, variantId, product._id.toString()],
    );
    await rawQuery("INSERT INTO stock_lot_levels (organization_id, location_id, lot_id, variant_id, on_hand) VALUES (?, ?, ?, ?, 3)", [ORG, location, lotId, variantId]);
    await rawQuery("UPDATE stock_levels SET on_hand = on_hand WHERE location_id = ? AND variant_id = ?", [location, variantId]);
    await withShopper(async (buyer) => {
      const tooMany = await place(buyer, [[product, 3]]);
      assert.ok([400, 409].includes(tooMany.res.status), "5 on hand, 3 of them expired: only 2 can be promised");
      assert.equal(await projected(product), 2, "the shop itself shows 2, not 5");
      const ok = await place(buyer, [[product, 2]]);
      assert.equal(ok.res.status, 201);
    });
    await rawQuery("DELETE FROM stock_lots WHERE id = ?", [lotId]);
    await deleteRows("products", "id", product._id);
  });

  test("two shoppers racing for the last unit: exactly one wins", async () => {
    const product = await newProduct();
    const location = await makeLocation();
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

  test("cancelling gives the units back at the location that held them", async () => {
    const product = await newProduct();
    const high = await makeLocation({ priority: 1 });
    const low = await makeLocation({ priority: 2 });
    await holdStock(high, product, 1);
    await holdStock(low, product, 8);
    await withShopper(async (buyer) => {
      const { body } = await place(buyer, [[product, 4]]);
      assert.deepEqual((await reservations(body.order._id)).map((r) => r.locationId), [low]);
      const res = await cancelOrderPOST(
        requestAs({ method: "POST", url: `http://test/api/orders/${body.order._id}/cancel`, session: await createTestSession(buyer._id), body: {} }),
        { params: Promise.resolve({ id: body.order._id }) },
      );
      assert.equal(res.status, 200);
      assert.equal(await reservedAt(low, product), 0);
      assert.equal((await reservations(body.order._id))[0].status, "released");
    });
    await deleteRows("products", "id", product._id);
  });

  test("the figure the shop shows is the most ONE eligible location can supply, and follows eligibility", async () => {
    const product = await newProduct();
    const a = await makeLocation({ priority: 1 });
    const b = await makeLocation({ priority: 2 });
    await holdStock(a, product, 4);
    await holdStock(b, product, 7);
    assert.equal(await projected(product), 7, "not 11: an order is filled from one location");
    await rawQuery("UPDATE stock_locations SET fulfils_online = 0, fulfilment_priority = NULL WHERE id = ?", [b]);
    assert.equal(await projected(product), 4, "taking a location off online orders lowers it at once");
    await rawQuery("UPDATE stock_locations SET fulfils_online = 1, fulfilment_priority = 5 WHERE id = ?", [b]);
    assert.equal(await projected(product), 7, "and putting it back raises it");
    await rawQuery("UPDATE stock_locations SET status = 'Archived' WHERE id = ?", [b]);
    assert.equal(await projected(product), 4, "archiving removes it");
    await deleteRows("products", "id", product._id);
  });

  test("a variant not offered online cannot be bought here, and a product with none is not listed", async () => {
    const product = await newProduct();
    const location = await makeLocation();
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
