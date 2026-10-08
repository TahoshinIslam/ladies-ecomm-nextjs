// Online checkout and the store's business day (ecom_erp migration 079).
//
// A lot with a printed expiry date is sellable THROUGH that date and expired from
// the start of the next day in the store's own timezone (default Asia/Dhaka) —
// not the UTC date. Checkout applies that rule itself, at the moment it reserves,
// whether or not any sweep has run: these tests never run a sweep.
//
// "Midnight" is crossed by moving the organisation's stored UTC offset, which is
// what the database's business_today() reads, so the real reservation statement is
// the thing under test.

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

describe("Online checkout uses the store's business day, with no sweep", { skip: !dbReady && skipReason }, () => {
  let createOrderPOST;
  const locationIds = [];
  let counter = 0;
  const uid = () => `${Date.now().toString(36)}${(counter += 1)}`;
  let originalOffset;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    [{ originalOffset }] = await rawQuery("SELECT business_utc_offset_minutes AS originalOffset FROM organizations WHERE id = ?", [ORG]); // not "AS offset": OFFSET is reserved in MariaDB 10.6+
  });

  after(async () => {
    await rawQuery("UPDATE organizations SET business_utc_offset_minutes = ? WHERE id = ?", [originalOffset, ORG]);
    await truncateAll();
    if (locationIds.length) await rawQuery("DELETE FROM stock_locations WHERE organization_id = ? AND id IN (?)", [ORG, locationIds]);
    await disconnectTestDb();
  });

  const setOffset = (minutes) => rawQuery("UPDATE organizations SET business_utc_offset_minutes = ? WHERE id = ?", [minutes, ORG]);
  const address = () => ({ fullName: "Expiry Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" });
  const businessDate = async () => String((await rawQuery("SELECT DATE_FORMAT(business_today(?), '%Y-%m-%d') AS d", [ORG]))[0].d);

  async function makeLocation() {
    const id = `loc_x${uid()}`;
    await rawQuery(
      `INSERT INTO stock_locations (id, organization_id, name, code, location_type, status, fulfils_online, fulfilment_priority, channel, created_by_name) VALUES (?, ?, ?, ?, 'warehouse', 'Active', 1, 1, 'online', 'test')`,
      [id, ORG, `Loc ${id}`, id.toUpperCase().slice(0, 30)],
    );
    // The online store sells from ONE dedicated Online-only warehouse: this is it.
    await rawQuery(
      `INSERT INTO inventory_settings (organization_id, online_source_location_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE online_source_location_id = VALUES(online_source_location_id)`,
      [ORG, id],
    );
    locationIds.push(id);
    return id;
  }

  async function stockWithLot(location, product, { onHand, lotUnits, expiryDate }) {
    const variantId = product.variants[0]._id.toString();
    const productId = product._id.toString();
    await clearVariantStock(variantId);
    // `onHand` units in all; `lotUnits` of them belong to a lot with a printed expiry date (its own batch), the rest
    // to an undated batch — two receipts of the same item.
    const lotId = `lot_x${uid()}`;
    const lot = { id: lotId, ref: "DATED", expiryDate };
    await seedBatch({ location, variantId, productId, quantity: lotUnits, lot });
    if (onHand > lotUnits) await seedBatch({ location, variantId, productId, quantity: onHand - lotUnits });
    return lotId;
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

  test("the database's business date is the store's, not UTC's", async () => {
    await setOffset(360);
    const expectedLocal = new Date(Date.now() + 360 * 60000).toISOString().slice(0, 10);
    assert.equal(await businessDate(), expectedLocal);
    // 01:00 on the NEXT UTC day, in a zone ahead of UTC: the two dates must be able to differ.
    const now = new Date();
    const minutesToUtcMidnight = 24 * 60 - (now.getUTCHours() * 60 + now.getUTCMinutes());
    await setOffset(minutesToUtcMidnight + 60);
    assert.equal(await businessDate(), new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    assert.notEqual(await businessDate(), now.toISOString().slice(0, 10), "the business date is the next day while the UTC date is still today");
    await setOffset(360);
  });

  test("a lot expiring today is sellable online; after the store's midnight it is not — checked at reservation, with no sweep", async () => {
    await setOffset(360);
    const today = await businessDate();
    const product = await createTestProduct({ stock: 0 });
    const location = await makeLocation();
    await stockWithLot(location, product, { onHand: 6, lotUnits: 6, expiryDate: today });
    await withShopper(async (buyer) => {
      const before = await place(buyer, product, 2);
      assert.equal(before.res.status, 201, "through its printed date the lot is still sellable");

      // Local midnight passes (the stored offset moves the database's own clock). Nothing sweeps.
      const minutesToLocalMidnight = Math.ceil((Date.parse(`${today}T00:00:00Z`) + 86400000 - (Date.now() + 360 * 60000)) / 60000);
      await setOffset(360 + minutesToLocalMidnight + 1);
      assert.notEqual(await businessDate(), today);
      const after = await place(buyer, product, 1);
      assert.ok([400, 409].includes(after.res.status), `the same lot is expired the next business day: ${after.res.status}`);
      const [lot] = await rawQuery("SELECT on_hand AS n FROM stock_lot_levels WHERE lot_id IS NOT NULL AND variant_id = ? AND organization_id = ?", [product.variants[0]._id.toString(), ORG]);
      assert.equal(Number(lot.n), 6, "and no sweep ran: the lot still sits in sellable lot stock, simply never offered");
    });
    await setOffset(360);
    await deleteRows("products", "id", product._id);
  });

  test("stock in a fresh lot beside an expired one is promised exactly (expired units never counted)", async () => {
    await setOffset(360);
    const today = await businessDate();
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const product = await createTestProduct({ stock: 0 });
    const location = await makeLocation();
    const variantId = product.variants[0]._id.toString();
    // 9 on hand: 4 in a lot that expired yesterday, 5 in a fresh lot.
    await stockWithLot(location, product, { onHand: 4, lotUnits: 4, expiryDate: yesterday });
    const freshLot = `lot_x${uid()}`;
    await seedBatch({ location, variantId, productId: product._id.toString(), quantity: 5, lot: { id: freshLot, ref: "FRESH", expiryDate: new Date(Date.parse(`${today}T00:00:00Z`) + 10 * 86400000).toISOString().slice(0, 10) } });
    await withShopper(async (buyer) => {
      const tooMany = await place(buyer, product, 6);
      assert.ok([400, 409].includes(tooMany.res.status), "9 on hand, 4 expired: 6 cannot be promised");
      const exactly = await place(buyer, product, 5);
      assert.equal(exactly.res.status, 201, "exactly the 5 unexpired can");
    });
    await deleteRows("products", "id", product._id);
  });
});
