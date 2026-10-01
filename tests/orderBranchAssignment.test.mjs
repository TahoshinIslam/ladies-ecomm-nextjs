// Which branch fulfils a website order — through the real POST /api/orders
// and POST /api/orders/[id]/cancel Route Handlers.
//
// What must hold:
//
//   - a new order is saved with the branch of the stock location it actually
//     RESERVED from (orders.branch_id, written in the checkout transaction);
//   - its reservation and stock quantities are exactly what they were before
//     this existed (assignment changes nothing about stock);
//   - the assignment is a fact about that order: switching the store's default
//     location later moves new orders, never old ones, and cancelling keeps it;
//   - a location with no valid branch (none, suspended, deleted) leaves the
//     order explicitly unassigned (NULL) — the order is still taken;
//   - an order is never assigned to another organization's branch.

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

describe("Website orders are assigned to their fulfilment branch", { skip: !dbReady && skipReason }, () => {
  let createOrderPOST, cancelOrderPOST;
  const branchIds = [];
  let counter = 0;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ POST: cancelOrderPOST } = await import("../app/api/orders/[id]/cancel/route.js"));
  });

  after(async () => {
    // Orders first: a branch that has orders cannot be deleted (migration 068).
    await truncateAll();
    for (const id of branchIds) await rawQuery("DELETE FROM branches WHERE id = ?", [id]);
    await disconnectTestDb();
  });

  const address = () => ({ fullName: "Branch Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" });

  async function makeBranch(status = "Active") {
    const id = `brn_t${Date.now().toString(36)}${(counter += 1)}`;
    await rawQuery(
      `INSERT INTO branches (id, organization_id, name, code, status, created_by_name) VALUES (?, ?, ?, ?, ?, 'test')`,
      [id, ORG, `Branch ${id}`, id.toUpperCase().slice(0, 30), status],
    );
    branchIds.push(id);
    return id;
  }

  /** Make a location (optionally on a branch) the store's default. Stock is created afterwards. */
  async function makeDefaultLocation(branchId) {
    const id = `loc_t${Date.now().toString(36)}${(counter += 1)}`;
    await rawQuery(
      `INSERT INTO stock_locations (id, organization_id, branch_id, name, code, location_type, status, fulfils_online, fulfilment_priority, created_by_name)
       VALUES (?, ?, ?, ?, ?, 'store', 'Active', 1, 1, 'test')`,
      [id, ORG, branchId, `Loc ${id}`, id.toUpperCase().slice(0, 30)],
    );
    await rawQuery(
      `INSERT INTO inventory_settings (organization_id, default_location_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE default_location_id = VALUES(default_location_id)`,
      [ORG, id],
    );
    return id;
  }

  async function placeOrder(buyer, product, quantity) {
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

  async function orderRow(orderId) {
    const [o] = await rawQuery("SELECT branch_id AS branchId, status FROM orders WHERE id = ?", [orderId]);
    const [r] = await rawQuery("SELECT location_id AS locationId, status, quantity FROM stock_reservations WHERE order_id = ?", [orderId]);
    return { ...o, reservation: r };
  }

  async function level(variantId) {
    const [l] = await rawQuery(
      `SELECT sl.on_hand AS onHand, sl.reserved, pv.stock AS projected FROM stock_levels sl
         JOIN product_variants pv ON pv.id = sl.variant_id WHERE sl.variant_id = ?`,
      [variantId],
    );
    return { ...l };
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

  test("a new order gets the branch of the location it reserved from; stock is unchanged by that", async () => {
    const branch = await makeBranch();
    const location = await makeDefaultLocation(branch);
    const product = await createTestProduct({ stock: 10 });
    await withShopper(async (buyer) => {
      const { res, body } = await placeOrder(buyer, product, 3);
      assert.equal(res.status, 201);
      const order = await orderRow(body.order._id);
      assert.equal(order.branchId, branch, "the order carries its fulfilment branch");
      assert.equal(order.reservation.locationId, location, "reserved at that branch's location");
      assert.deepEqual(await level(product.variants[0]._id.toString()), { onHand: 10, reserved: 3, projected: 7 });
    });
    await deleteRows("products", "id", product._id);
  });

  test("the branch is derived from the ACTUAL reservation location, whatever the order's own default lookup would say", async () => {
    const branch = await makeBranch();
    const location = await makeDefaultLocation(branch);
    const product = await createTestProduct({ stock: 4 });
    await withShopper(async (buyer) => {
      const { body } = await placeOrder(buyer, product, 1);
      const [{ branchOfReservation }] = await rawQuery(
        `SELECT l.branch_id AS branchOfReservation FROM stock_reservations r
           JOIN stock_locations l ON l.id = r.location_id WHERE r.order_id = ?`,
        [body.order._id],
      );
      const order = await orderRow(body.order._id);
      assert.equal(order.reservation.locationId, location);
      assert.equal(order.branchId, branchOfReservation, "orders.branch_id is the reservation location's branch");
    });
    await deleteRows("products", "id", product._id);
  });

  test("changing the default location later moves NEW orders only; the old order keeps its branch, even after cancelling", async () => {
    const branchA = await makeBranch();
    await makeDefaultLocation(branchA);
    const productA = await createTestProduct({ stock: 5 });
    await withShopper(async (buyer) => {
      const first = await placeOrder(buyer, productA, 1);
      assert.equal((await orderRow(first.body.order._id)).branchId, branchA);

      const branchB = await makeBranch();
      await makeDefaultLocation(branchB);
      const productB = await createTestProduct({ stock: 5 });
      const second = await placeOrder(buyer, productB, 1);
      assert.equal((await orderRow(second.body.order._id)).branchId, branchB, "a new order follows the new default");
      assert.equal((await orderRow(first.body.order._id)).branchId, branchA, "the earlier order did not move");

      const session = await createTestSession(buyer._id);
      const cancel = await cancelOrderPOST(
        requestAs({ method: "POST", url: `http://test/api/orders/${first.body.order._id}/cancel`, session }),
        { params: Promise.resolve({ id: first.body.order._id }) },
      );
      assert.equal(cancel.status, 200);
      const cancelled = await orderRow(first.body.order._id);
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.branchId, branchA, "cancelling keeps the assignment");
      await deleteRows("products", "id", productB._id);
    });
    await deleteRows("products", "id", productA._id);
  });

  test("archiving the fulfilment branch keeps its orders; new checkouts follow the active branch; the branch itself cannot be deleted", async () => {
    const branchA = await makeBranch();
    await makeDefaultLocation(branchA);
    const productA = await createTestProduct({ stock: 6 });
    await withShopper(async (buyer) => {
      const first = await placeOrder(buyer, productA, 1);
      assert.equal((await orderRow(first.body.order._id)).branchId, branchA);

      // The branch is archived. Its order, payment and stock stay; it stays assigned.
      await rawQuery("UPDATE branches SET status = 'Archived' WHERE id = ?", [branchA]);
      assert.equal((await orderRow(first.body.order._id)).branchId, branchA, "archiving leaves the order on its branch");

      // …and cannot be erased while it has orders (the shared schema's rule, migration 068).
      const deletion = await rawQuery("DELETE FROM branches WHERE id = ?", [branchA]).then(() => null, (error) => error);
      assert.ok(deletion, "a branch with orders must not be deletable");
      assert.match(deletion.sqlMessage ?? deletion.message, /cannot be deleted/);
      const [{ stillThere }] = await rawQuery("SELECT COUNT(*) AS stillThere FROM orders WHERE id = ?", [first.body.order._id]);
      assert.equal(Number(stillThere), 1, "the refused delete removed no order");

      // A checkout that still reserves at the archived branch's location is unassigned, not mis-assigned.
      const second = await placeOrder(buyer, productA, 1);
      assert.equal(second.res.status, 201);
      assert.equal((await orderRow(second.body.order._id)).branchId, null, "an archived branch is not a fulfilment branch");

      // Pointing the default at an active branch restores assignment for new orders.
      const branchB = await makeBranch();
      await makeDefaultLocation(branchB);
      const productB = await createTestProduct({ stock: 6 });
      const third = await placeOrder(buyer, productB, 1);
      assert.equal((await orderRow(third.body.order._id)).branchId, branchB, "new checkouts follow the active fulfilment branch");
      assert.equal((await orderRow(first.body.order._id)).branchId, branchA, "the archived branch's order is unchanged");
      await deleteRows("products", "id", productB._id);
    });
    await deleteRows("products", "id", productA._id);
  });

  test("a location with no branch leaves the order explicitly unassigned — and the order is still taken", async () => {
    await makeDefaultLocation(null);
    const product = await createTestProduct({ stock: 6 });
    await withShopper(async (buyer) => {
      const { res, body } = await placeOrder(buyer, product, 2);
      assert.equal(res.status, 201, "a missing branch must not block a sale");
      const order = await orderRow(body.order._id);
      assert.equal(order.branchId, null);
      assert.equal(order.reservation.status, "active");
      assert.deepEqual(await level(product.variants[0]._id.toString()), { onHand: 6, reserved: 2, projected: 4 });
    });
    await deleteRows("products", "id", product._id);
  });

  test("a suspended or deleted branch is not a valid fulfilment branch", async () => {
    for (const make of [
      async () => makeBranch("Suspended"),
      async () => {
        const id = await makeBranch();
        await rawQuery("UPDATE branches SET deleted_at = NOW(3) WHERE id = ?", [id]);
        return id;
      },
    ]) {
      await makeDefaultLocation(await make());
      const product = await createTestProduct({ stock: 3 });
      await withShopper(async (buyer) => {
        const { res, body } = await placeOrder(buyer, product, 1);
        assert.equal(res.status, 201);
        assert.equal((await orderRow(body.order._id)).branchId, null);
      });
      await deleteRows("products", "id", product._id);
    }
  });

  test("a location pointing at another organization's branch never assigns it", async () => {
    // stock_locations.branch_id references branches(id) alone, so a location
    // CAN name a branch of a different organization. The lookup must require
    // the same organization and so yield nothing.
    const foreignOrg = `org_fb${Date.now().toString(36)}`;
    const foreignBranch = `brn_fb${Date.now().toString(36)}`;
    await rawQuery("INSERT INTO organizations (id, name, code, status) VALUES (?, 'Foreign', ?, 'Active')", [foreignOrg, foreignOrg.toUpperCase().slice(0, 30)]);
    await rawQuery(
      "INSERT INTO branches (id, organization_id, name, code, status, created_by_name) VALUES (?, ?, 'Foreign', 'FRGN', 'Active', 'test')",
      [foreignBranch, foreignOrg],
    );
    try {
      const location = await makeDefaultLocation(null);
      await rawQuery("UPDATE stock_locations SET branch_id = ? WHERE id = ?", [foreignBranch, location]);
      const product = await createTestProduct({ stock: 3 });
      await withShopper(async (buyer) => {
        const { res, body } = await placeOrder(buyer, product, 1);
        assert.equal(res.status, 201);
        assert.equal((await orderRow(body.order._id)).branchId, null, "a foreign branch is never assigned");
      });
      await deleteRows("products", "id", product._id);
    } finally {
      await rawQuery("UPDATE stock_locations SET branch_id = NULL WHERE branch_id = ?", [foreignBranch]);
      await rawQuery("DELETE FROM branches WHERE id = ?", [foreignBranch]);
      await rawQuery("DELETE FROM organizations WHERE id = ?", [foreignOrg]);
    }
  });
});
