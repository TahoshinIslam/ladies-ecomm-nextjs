// Public checkout needs the MERCHANT's plan to include online sales.
//
// The shopper has no plan and no staff permission, so what is checked is the selling organization's entitlement, read fresh on every
// request (models/entitlementModel.js, the dashboard's own expression). A store that is not entitled takes no order, whatever its
// stock and configuration say — and nothing is written: no order, no payment, no reservation. Changing the plan changes the answer on
// the very next request, with no restart and no cached state, and nothing the store already holds is touched.

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
const TEST_PLAN = "plan_test000000000000000001"; // includes mod.storefront (scripts/setupTestDb.mjs)
const NO_ONLINE_PLAN = "plan_test_noonline0000000001"; // a plan with no modules at all, like Free

describe("Public checkout follows the merchant's plan", { skip: !dbReady && skipReason }, () => {
  let createOrderPOST;
  let locationId;
  let product;
  let variantId;
  let buyer;

  const setPlan = (planId) => rawQuery("UPDATE subscriptions SET plan_id = ? WHERE organization_id = ?", [planId, ORG]);
  const order = async () => {
    const res = await createOrderPOST(
      requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(buyer._id),
        body: { items: [{ productId: product._id.toString(), variantId, quantity: 1 }], shippingAddress: { fullName: "Plan Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" } },
      }),
    );
    return { status: res.status, body: await res.json() };
  };
  const counts = async () => {
    const [o] = await rawQuery("SELECT COUNT(*) AS n FROM orders WHERE organization_id = ?", [ORG]);
    const [p] = await rawQuery("SELECT COUNT(*) AS n FROM payments WHERE organization_id = ?", [ORG]);
    const [r] = await rawQuery("SELECT COALESCE(SUM(reserved), 0) AS n FROM stock_levels WHERE organization_id = ?", [ORG]);
    return { orders: Number(o.n), payments: Number(p.n), reserved: Number(r.n) };
  };

  before(async () => {
    // Many orders from one buyer here; the ceiling on pending orders has its
    // own test (tests/orderPendingCap.test.mjs) and is lifted for this file.
    process.env.ORDER_MAX_PENDING_PER_CUSTOMER = "1000";
    await connectTestDb();
    await truncateAll();
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    locationId = `loc_p${Date.now().toString(36)}`;
    await rawQuery(
      `INSERT INTO stock_locations (id, organization_id, name, code, location_type, status, fulfils_online, fulfilment_priority, channel, created_by_name) VALUES (?, ?, 'Plan ONL', ?, 'warehouse', 'Active', 1, 1, 'online', 'test')`,
      [locationId, ORG, locationId.toUpperCase().slice(0, 30)],
    );
    await rawQuery(
      `INSERT INTO inventory_settings (organization_id, online_source_location_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE online_source_location_id = VALUES(online_source_location_id)`,
      [ORG, locationId],
    );
    await rawQuery(`INSERT INTO plans (id, name, slug, description, price_monthly, currency) VALUES (?, 'No online', 'no-online', 'Test fixture', 0, 'USD') ON DUPLICATE KEY UPDATE name = VALUES(name)`, [NO_ONLINE_PLAN]);
    product = await createTestProduct({ stock: 0 });
    variantId = product.variants[0]._id.toString();
    await clearVariantStock(variantId);
    await seedBatch({ location: locationId, variantId, productId: product._id.toString(), quantity: 20 });
    buyer = await createTestUser({ role: "customer" });
  });

  after(async () => {
    delete process.env.ORDER_MAX_PENDING_PER_CUSTOMER;
    await setPlan(TEST_PLAN);
    await rawRestoreGrants();
    await deleteRows("orders", "customer_id", buyer._id);
    await deleteRows("carts", "customer_id", buyer._id);
    await deleteRows("customers", "id", buyer._id);
    await deleteRows("products", "id", product._id);
    await truncateAll();
    await rawQuery("DELETE FROM stock_locations WHERE organization_id = ? AND id = ?", [ORG, locationId]);
    await rawQuery("DELETE FROM plans WHERE id = ?", [NO_ONLINE_PLAN]);
    await disconnectTestDb();
  });

  async function rawRestoreGrants() {
    await rawQuery("DELETE FROM organization_module_grants WHERE organization_id = ? AND module_id = 'mod.storefront'", [ORG]);
  }

  test("a store whose plan includes online sales takes the order", async () => {
    await setPlan(TEST_PLAN);
    const r = await order();
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.order?._id ?? r.body.order?.id);
  });

  test("a store on a plan without it is refused — with valid stock, a valid source and a valid order — and nothing is written", async () => {
    await setPlan(NO_ONLINE_PLAN);
    const before = await counts();
    const r = await order();
    assert.equal(r.status, 403, JSON.stringify(r.body));
    assert.deepEqual(await counts(), before, "no order, no payment and no reservation");
  });

  test("the answer follows the plan at once: upgrading lets the next order through, with the store's earlier orders untouched", async () => {
    await setPlan(NO_ONLINE_PLAN);
    const before = await counts();
    assert.equal((await order()).status, 403);
    await setPlan(TEST_PLAN);
    const ok = await order();
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const after = await counts();
    assert.equal(after.orders, before.orders + 1, "exactly the one new order");
  });

  test("a DISABLE grant on the module refuses it even on a plan that includes it, and an ENABLE grant admits it on a plan that does not", async () => {
    await setPlan(TEST_PLAN);
    await rawQuery("INSERT INTO organization_module_grants (id, organization_id, module_id, grant_type) VALUES ('omg_plantest000000000000001', ?, 'mod.storefront', 'DISABLE')", [ORG]);
    assert.equal((await order()).status, 403, "disabled for this store");
    await rawRestoreGrants();
    await setPlan(NO_ONLINE_PLAN);
    await rawQuery("INSERT INTO organization_module_grants (id, organization_id, module_id, grant_type) VALUES ('omg_plantest000000000000002', ?, 'mod.storefront', 'ENABLE')", [ORG]);
    assert.equal((await order()).status, 201, "enabled for this store by a grant");
    await rawRestoreGrants();
    assert.equal((await order()).status, 403, "and refused again once the grant is gone");
  });

  test("an order that was already made still answers its own retry after the plan changes", async () => {
    await setPlan(TEST_PLAN);
    const key = `plan-replay-${Date.now()}`;
    const send = async () => {
      const res = await createOrderPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/orders",
          session: await createTestSession(buyer._id),
          body: { items: [{ productId: product._id.toString(), variantId, quantity: 1 }], shippingAddress: { fullName: "Plan Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" } },
          idempotencyKey: key,
        }),
      );
      return { status: res.status, body: await res.json() };
    };
    const first = await send();
    assert.equal(first.status, 201, JSON.stringify(first.body));
    await setPlan(NO_ONLINE_PLAN);
    const again = await send();
    assert.ok([200, 201].includes(again.status), `a retry of an order that exists is answered with it (${again.status})`);
    assert.equal(again.body.order?._id ?? again.body.order?.id, first.body.order?._id ?? first.body.order?.id);
  });
});
