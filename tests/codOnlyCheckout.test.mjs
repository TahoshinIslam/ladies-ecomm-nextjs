// Public checkout stays cash-on-delivery only.
//
// The shared schema now has a generic `online` payment method (ecom_erp migration 109) so staff can record a prepaid order. That
// is NOT a payment integration: the storefront has no gateway, and a shopper cannot choose it. Whatever a request claims — a
// `paymentMethod` of "online", "card", "bkash", a forged `payment` object — the order that results (if any) is COD, with a COD
// payment row.

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

describe("Public checkout is COD-only", { skip: !dbReady && skipReason }, () => {
  let createOrderPOST;
  let locationId;
  let n = 0;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    locationId = `loc_c${Date.now().toString(36)}`;
    await rawQuery(
      `INSERT INTO stock_locations (id, organization_id, name, code, location_type, status, fulfils_online, fulfilment_priority, channel, created_by_name) VALUES (?, ?, 'COD ONL', ?, 'warehouse', 'Active', 1, 1, 'online', 'test')`,
      [locationId, ORG, locationId.toUpperCase().slice(0, 30)],
    );
    await rawQuery(
      `INSERT INTO inventory_settings (organization_id, online_source_location_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE online_source_location_id = VALUES(online_source_location_id)`,
      [ORG, locationId],
    );
  });

  after(async () => {
    await truncateAll();
    await rawQuery("DELETE FROM stock_locations WHERE organization_id = ? AND id = ?", [ORG, locationId]);
    await disconnectTestDb();
  });

  async function place(extra) {
    const product = await createTestProduct({ stock: 0 });
    const variantId = product.variants[0]._id.toString();
    await clearVariantStock(variantId);
    await seedBatch({ location: locationId, variantId, productId: product._id.toString(), quantity: 5 });
    const buyer = await createTestUser({ role: "customer" });
    try {
      const res = await createOrderPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/orders",
          session: await createTestSession(buyer._id),
          body: { items: [{ productId: product._id.toString(), variantId, quantity: 1 }], shippingAddress: { fullName: "Cod Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" }, ...extra },
        }),
      );
      const body = await res.json();
      const orderId = body.order?._id ?? body.order?.id;
      const [order] = orderId ? await rawQuery("SELECT payment_method AS m FROM orders WHERE id = ?", [orderId]) : [];
      const payments = orderId ? await rawQuery("SELECT method, status FROM payments WHERE order_id = ?", [orderId]) : [];
      return { status: res.status, orderId, order, payments };
    } finally {
      await deleteRows("orders", "customer_id", buyer._id);
      await deleteRows("carts", "customer_id", buyer._id);
      await deleteRows("customers", "id", buyer._id);
      await deleteRows("products", "id", product._id);
      n += 1;
    }
  }

  for (const claim of [{ paymentMethod: "online" }, { paymentMethod: "card" }, { payment: { method: "online", status: "completed" } }, { paymentMethod: "bkash", paymentStatus: "completed" }]) {
    test(`a request claiming ${JSON.stringify(claim)} cannot make a prepaid or gateway order`, async () => {
      const r = await place(claim);
      if (r.orderId) {
        assert.ok(["", "cod"].includes(r.order.m), `the order's method is blank or COD whatever was claimed (got "${r.order.m}")`);
        assert.ok(r.payments.every((p) => p.method === "cod" && p.status !== "completed"), `payments: ${JSON.stringify(r.payments)} — COD, and not marked collected`);
      } else {
        assert.ok([400, 422].includes(r.status), `refused outright (${r.status}) — no order, no payment`);
      }
    });
  }
});
