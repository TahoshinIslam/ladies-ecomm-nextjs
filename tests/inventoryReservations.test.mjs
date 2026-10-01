// Checkout against the inventory model (ecom_erp migrations 064–066; this
// app's half is models/inventoryModel.js).
//
// What must hold, through the real POST /api/orders and
// POST /api/orders/[id]/cancel Route Handlers:
//
//   - placing an order RESERVES stock at the store's default location:
//     `reserved` rises, `on_hand` does not (the goods are still on the
//     shelf), and no ledger movement is written — nothing physically moved;
//   - `product_variants.stock`, which every listing reads, falls by the
//     reserved quantity in the same transaction (the stock_levels triggers);
//   - two different shoppers racing for the last unit cannot both win;
//   - cancelling releases the reservation exactly once;
//   - saving a product never overwrites stock an order has changed.

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

describe("Checkout reserves stock through the inventory model", { skip: !dbReady && skipReason }, () => {
  let createOrderPOST, cancelOrderPOST, Product;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ POST: cancelOrderPOST } = await import("../app/api/orders/[id]/cancel/route.js"));
    ({ default: Product } = await import("../models/productModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  const address = () => ({ fullName: "Stock Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" });

  async function level(variantId) {
    const rows = await rawQuery(
      `SELECT sl.on_hand AS onHand, sl.reserved, pv.stock AS projected
         FROM stock_levels sl
         JOIN inventory_settings s ON s.organization_id = sl.organization_id AND s.default_location_id = sl.location_id
         JOIN product_variants pv ON pv.id = sl.variant_id
        WHERE sl.variant_id = ?`,
      [variantId],
    );
    return rows[0] ?? null;
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

  test("a new product's stock is an opening balance at the default location", async () => {
    const product = await createTestProduct({ stock: 10 });
    const variantId = product.variants[0]._id.toString();
    assert.deepEqual({ ...(await level(variantId)) }, { onHand: 10, reserved: 0, projected: 10 });
    const moves = await rawQuery("SELECT movement_type AS type, quantity, unit_cost AS cost FROM stock_movements WHERE variant_id = ?", [variantId]);
    assert.deepEqual(moves.map((m) => ({ ...m })), [{ type: "opening", quantity: 10, cost: null }]);
    await deleteRows("products", "id", product._id);
  });

  test("placing an order reserves: on-hand unchanged, reserved up, storefront figure down, no movement", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 10 });
    const variantId = product.variants[0]._id.toString();
    try {
      const { res, body } = await placeOrder(buyer, product, 3);
      assert.equal(res.status, 201);
      assert.deepEqual({ ...(await level(variantId)) }, { onHand: 10, reserved: 3, projected: 7 });
      const reservations = await rawQuery("SELECT status, quantity FROM stock_reservations WHERE order_id = ?", [body.order._id]);
      assert.deepEqual(reservations.map((r) => ({ ...r })), [{ status: "active", quantity: 3 }]);
      const moves = await rawQuery("SELECT COUNT(*) AS n FROM stock_movements WHERE variant_id = ? AND movement_type <> 'opening'", [variantId]);
      assert.equal(Number(moves[0].n), 0, "a reservation is not a physical movement");
    } finally {
      await deleteRows("orders", "customer_id", buyer._id);
      await deleteRows("carts", "customer_id", buyer._id);
      await deleteRows("products", "id", product._id);
      await deleteRows("customers", "id", buyer._id);
    }
  });

  test("cancelling releases the reservation once; a second cancel changes nothing", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 5 });
    const variantId = product.variants[0]._id.toString();
    try {
      const { body } = await placeOrder(buyer, product, 2);
      const orderId = body.order._id;
      const session = await createTestSession(buyer._id);
      const first = await cancelOrderPOST(
        requestAs({ method: "POST", url: `http://test/api/orders/${orderId}/cancel`, session }),
        { params: Promise.resolve({ id: orderId }) },
      );
      assert.equal(first.status, 200);
      assert.deepEqual({ ...(await level(variantId)) }, { onHand: 5, reserved: 0, projected: 5 });
      const [reservation] = await rawQuery("SELECT status FROM stock_reservations WHERE order_id = ?", [orderId]);
      assert.equal(reservation.status, "released");

      const second = await cancelOrderPOST(
        requestAs({ method: "POST", url: `http://test/api/orders/${orderId}/cancel`, session }),
        { params: Promise.resolve({ id: orderId }) },
      );
      assert.equal(second.status, 400, "a cancelled order cannot be cancelled again");
      assert.deepEqual({ ...(await level(variantId)) }, { onHand: 5, reserved: 0, projected: 5 });
    } finally {
      await deleteRows("orders", "customer_id", buyer._id);
      await deleteRows("carts", "customer_id", buyer._id);
      await deleteRows("products", "id", product._id);
      await deleteRows("customers", "id", buyer._id);
    }
  });

  test("ten shoppers racing for the last unit: exactly one order, stock never negative", async () => {
    const product = await createTestProduct({ stock: 1 });
    const variantId = product.variants[0]._id.toString();
    const buyers = await Promise.all(Array.from({ length: 10 }, () => createTestUser({ role: "customer" })));
    try {
      const results = await Promise.all(buyers.map((buyer) => placeOrder(buyer, product, 1)));
      const created = results.filter((r) => r.res.status === 201);
      const refused = results.filter((r) => r.res.status === 409 || r.res.status === 400);
      assert.equal(created.length, 1, `statuses: ${results.map((r) => r.res.status).join(",")}`);
      assert.equal(refused.length, 9);
      assert.deepEqual({ ...(await level(variantId)) }, { onHand: 1, reserved: 1, projected: 0 });
      const reservations = await rawQuery("SELECT COUNT(*) AS n FROM stock_reservations WHERE variant_id = ?", [variantId]);
      assert.equal(Number(reservations[0].n), 1);
    } finally {
      for (const buyer of buyers) {
        await deleteRows("orders", "customer_id", buyer._id);
        await deleteRows("carts", "customer_id", buyer._id);
        await deleteRows("customers", "id", buyer._id);
      }
      await deleteRows("products", "id", product._id);
    }
  });

  test("saving a product keeps stock that an order changed, whatever the payload says", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await createTestProduct({ stock: 5 });
    const variantId = product.variants[0]._id.toString();
    try {
      const stale = await Product.findById(product._id); // loaded before the sale
      await placeOrder(buyer, product, 2);
      stale.description = "Edited after the sale";
      stale.variants[0].stock = 99; // a stale or hostile figure
      await stale.save();
      const after = await level(variantId);
      assert.deepEqual({ ...after }, { onHand: 5, reserved: 2, projected: 3 });
      const reloaded = await Product.findById(product._id);
      assert.equal(reloaded.variants[0]._id.toString(), variantId, "the variant keeps its identity");
    } finally {
      await deleteRows("orders", "customer_id", buyer._id);
      await deleteRows("carts", "customer_id", buyer._id);
      await deleteRows("products", "id", product._id);
      await deleteRows("customers", "id", buyer._id);
    }
  });
});
