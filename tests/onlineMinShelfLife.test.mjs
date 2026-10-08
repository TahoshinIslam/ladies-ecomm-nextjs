// Minimum remaining shelf life for online orders (ecom_erp migration 110, FUL-04 / workbook T018).
//
// An expiry-tracked item can require N days of life left before a web shopper may be given it. The shortfall must be
// invisible everywhere the website decides: availability (online_available), the price shown (online_next_price) and the
// checkout's own reservation, which skips a lot with too little life left and takes the earliest FIT lot instead.
// With no minimum (0) nothing changes.

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

describe("Online minimum shelf life", { skip: !dbReady && skipReason }, () => {
  let createOrderPOST;
  const locationIds = [];
  let counter = 0;
  const uid = () => `${Date.now().toString(36)}${(counter += 1)}`;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
  });

  after(async () => {
    await truncateAll();
    if (locationIds.length) await rawQuery("DELETE FROM stock_locations WHERE organization_id = ? AND id IN (?)", [ORG, locationIds]);
    await disconnectTestDb();
  });

  const address = () => ({ fullName: "Shelf Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" });
  const today = async () => String((await rawQuery("SELECT DATE_FORMAT(business_today(?), '%Y-%m-%d') AS d", [ORG]))[0].d);
  const plusDays = async (n) => String((await rawQuery("SELECT DATE_FORMAT(DATE_ADD(business_today(?), INTERVAL ? DAY), '%Y-%m-%d') AS d", [ORG, n]))[0].d);

  async function makeLocation() {
    const id = `loc_m${uid()}`;
    await rawQuery(
      `INSERT INTO stock_locations (id, organization_id, name, code, location_type, status, fulfils_online, fulfilment_priority, channel, created_by_name) VALUES (?, ?, ?, ?, 'warehouse', 'Active', 1, 1, 'online', 'test')`,
      [id, ORG, `Loc ${id}`, id.toUpperCase().slice(0, 30)],
    );
    await rawQuery(
      `INSERT INTO inventory_settings (organization_id, online_source_location_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE online_source_location_id = VALUES(online_source_location_id)`,
      [ORG, id],
    );
    locationIds.push(id);
    return id;
  }

  /** An expiry-tracked item with a short-dated lot (3 days left, price 10) and a fresh one (30 days, price 12), six units each. */
  async function stock(minDays) {
    const product = await createTestProduct({ stock: 0 });
    const variantId = product.variants[0]._id.toString();
    const productId = product._id.toString();
    await clearVariantStock(variantId);
    await rawQuery("UPDATE product_variants SET tracking = 'expiry', online_min_shelf_days = ? WHERE organization_id = ? AND id = ?", [minDays, ORG, variantId]);
    const location = await makeLocation();
    await seedBatch({ location, variantId, productId, quantity: 6, price: 10, lot: { id: `lot_n${uid()}`, ref: "NEAR", expiryDate: await plusDays(3) } });
    await seedBatch({ location, variantId, productId, quantity: 6, price: 12, lot: { id: `lot_f${uid()}`, ref: "FRESH", expiryDate: await plusDays(30) } });
    return { product, variantId, location };
  }

  async function place(buyer, product, quantity) {
    const res = await createOrderPOST(
      requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
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

  const lotsHeld = async (orderId) =>
    (
      await rawQuery(
        `SELECT lt.lot_ref AS lotRef, SUM(a.quantity) AS n FROM stock_reservations r
           JOIN stock_batch_allocations a ON a.holder_id = r.id AND a.holder_type = 'order_reservation' AND a.status = 'active'
           JOIN stock_batches b ON b.id = a.batch_id JOIN stock_lots lt ON lt.id = b.lot_id
          WHERE r.order_id = ? GROUP BY lt.lot_ref ORDER BY lt.lot_ref`,
        [orderId],
      )
    ).map((r) => `${r.lotRef}:${Number(r.n)}`);

  test("with a 5-day minimum the 3-day lot is not offered: availability, price and checkout all skip it", async () => {
    const { product, variantId } = await stock(5);
    const [avail] = await rawQuery("SELECT online_available(?, ?) AS n, online_next_price(?, ?) AS price", [ORG, variantId, ORG, variantId]);
    assert.equal(Number(avail.n), 6, "12 on hand, but only the fresh lot's 6 are offered");
    assert.equal(Number(avail.price), 12, "the price shown is the fresh lot's, not the short-dated lot's");
    await withShopper(async (buyer) => {
      const tooMany = await place(buyer, product, 7);
      assert.ok([400, 409].includes(tooMany.res.status), `7 cannot be promised (only 6 are fit): ${tooMany.res.status}`);
      const ok = await place(buyer, product, 4);
      assert.equal(ok.res.status, 201, JSON.stringify(ok.body));
      assert.deepEqual(await lotsHeld(ok.body.order?._id ?? ok.body.order?.id), ["FRESH:4"], "the reservation holds fresh stock only");
    });
    await deleteRows("products", "id", product._id);
  });

  test("with no minimum the earliest lot (the 3-day one) is allocated first, as before", async () => {
    const { product, variantId } = await stock(0);
    const [avail] = await rawQuery("SELECT online_available(?, ?) AS n, online_next_price(?, ?) AS price", [ORG, variantId, ORG, variantId]);
    assert.equal(Number(avail.n), 12);
    assert.equal(Number(avail.price), 10, "the earliest-expiring lot's price is next");
    await withShopper(async (buyer) => {
      const ok = await place(buyer, product, 4);
      assert.equal(ok.res.status, 201, JSON.stringify(ok.body));
      assert.deepEqual(await lotsHeld(ok.body.order?._id ?? ok.body.order?.id), ["NEAR:4"]);
    });
    await deleteRows("products", "id", product._id);
  });
});
