// Proves the cosmetics-generalization change: variant/snapshot `attributes`
// is now an arbitrary key/value bag driven by
// AttributeDefinition.derivedFromVariant, not a fixed color/size/fabric
// shape (see models/productModel.js, models/cartModel.js,
// models/orderModel.js, and scripts/migrateOrderSnapshotAttributes.mjs).
// This test creates its OWN department/category/attribute-definition data
// (never depends on scripts/seedCatalog.mjs having run) and exercises a
// non-clothing key ("shade") end to end: product facet-sync -> cart
// snapshot -> real order creation.
//
// scripts/migrateOrderSnapshotAttributes.mjs and its coverage here were
// removed during the Mongo -> MySQL migration: that script folded a
// legacy Mongo-only document shape (snapshot.color/size as raw top-level
// fields, pre-dating the cosmetics generalization) into snapshot.attributes.
// sql/schema.sql never had that legacy shape to begin with — orders.
// snapshot_attributes has always been the JSON `attributes` bag — so the
// script had nothing left to migrate against a SQL database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  createTestSession,
  requestAs,
  createTestUser,
  deleteRows,
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("Variant attributes generalize beyond color/size/fabric (cosmetics test case)", { skip: !canRun && reason }, () => {
  let Category, AttributeDefinition, Product;
  let cartPOST, orderCreatePOST;

  before(async () => {
    await connectTestDb();
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ default: AttributeDefinition } = await import("../models/attributeDefinitionModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ POST: cartPOST } = await import("../app/api/cart/route.js"));
    ({ POST: orderCreatePOST } = await import("../app/api/orders/route.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  test("a non-clothing derivedFromVariant attribute (shade) syncs to Product.attributes with no color/size/fabric facets", async () => {
    const department = await Category.create({ name: "Test Cosmetics", slug: `test-cosmetics-${Date.now()}` });
    const leaf = await Category.create({ name: "Test Lipstick", slug: `test-lipstick-${Date.now()}`, parent: department._id });
    const shadeDef = await AttributeDefinition.create({
      key: `shade${Date.now()}`,
      label: "Shade",
      type: "swatch",
      derivedFromVariant: true,
      appliesToCategories: [department._id],
    });

    let product;
    try {
      product = await Product.create({
        name: `Test Lipstick ${Date.now()}`,
        description: "A test lipstick with a shade-only variant axis.",
        category: leaf._id,
        basePrice: 10,
        images: ["https://placehold.co/400x400.png?text=lipstick"],
        variants: [
          { variantName: "Ruby Red", sku: `TEST-LIP-${Date.now()}-A`, attributes: { [shadeDef.key]: "ruby-red" }, stock: 5 },
          { variantName: "Coral", sku: `TEST-LIP-${Date.now()}-B`, attributes: { [shadeDef.key]: "coral" }, stock: 5 },
        ],
      });

      const facetKeys = product.attributes.map((a) => a.key);
      assert.ok(facetKeys.includes(shadeDef.key), "the shade facet must be synced from variants");
      const shadeFacet = product.attributes.find((a) => a.key === shadeDef.key);
      assert.deepEqual([...shadeFacet.values].sort(), ["coral", "ruby-red"]);
      assert.ok(!facetKeys.includes("color"), "color must not be synced — it doesn't apply to this department");
      assert.ok(!facetKeys.includes("size"), "size must not be synced — it doesn't apply to this department");
      assert.ok(!facetKeys.includes("fabric"), "fabric must not be synced — it doesn't apply to this department");
    } finally {
      if (product) await deleteRows("products", "id", product._id);
      await deleteRows("attribute_definitions", "id", shadeDef._id);
      await deleteRows("categories", "id", [department._id, leaf._id]);
    }
  });

  test("cart and a real order both carry the shade attribute through snapshot.attributes, with no color/size/fabric keys", async () => {
    const department = await Category.create({ name: "Test Cosmetics 2", slug: `test-cosmetics2-${Date.now()}` });
    const leaf = await Category.create({ name: "Test Foundation", slug: `test-foundation-${Date.now()}`, parent: department._id });
    const shadeDef = await AttributeDefinition.create({
      key: `shade2${Date.now()}`,
      label: "Shade",
      type: "swatch",
      derivedFromVariant: true,
      appliesToCategories: [department._id],
    });
    const product = await Product.create({
      name: `Test Foundation ${Date.now()}`,
      description: "A test foundation with a single shade variant.",
      category: leaf._id,
      basePrice: 20,
      images: ["https://placehold.co/400x400.png?text=foundation"],
      variants: [{ variantName: "Ivory", sku: `TEST-FND-${Date.now()}`, attributes: { [shadeDef.key]: "ivory" }, stock: 5 }],
    });
    const user = await createTestUser();

    try {
      const session = await createTestSession(user._id);
      const variantId = product.variants[0]._id.toString();

      const addRes = await cartPOST(
        requestAs({
          method: "POST",
          url: "http://test/api/cart",
          session,
          body: { productId: product._id.toString(), variantId, quantity: 1 },
        }),
      );
      assert.equal(addRes.status, 200);
      const cartBody = await addRes.json();
      const cartAttrs = cartBody.cart.items[0].variant.attributes;
      assert.equal(cartAttrs[shadeDef.key], "ivory");
      assert.ok(!("color" in cartAttrs) && !("size" in cartAttrs) && !("fabric" in cartAttrs));

      const orderRes = await orderCreatePOST(
        requestAs({
          method: "POST",
          url: "http://test/api/orders",
          session,
          body: {
            items: [{ productId: product._id.toString(), variantId, quantity: 1 }],
            shippingAddress: {
              fullName: "Test Buyer",
              phone: "0100000000",
              street: "1 Test Street",
              city: "Dhaka",
              postalCode: "1200",
              country: "Bangladesh",
            },
          },
        }),
      );
      assert.equal(orderRes.status, 201);
      const order = (await orderRes.json()).order;
      const orderAttrs = order.items[0].snapshot.attributes;
      assert.equal(orderAttrs[shadeDef.key], "ivory");
      assert.ok(!("color" in orderAttrs) && !("size" in orderAttrs) && !("fabric" in orderAttrs));

      await deleteRows("orders", "customer_id", user._id);
    } finally {
      await deleteRows("carts", "customer_id", user._id);
      await deleteRows("products", "id", product._id);
      await deleteRows("attribute_definitions", "id", shadeDef._id);
      await deleteRows("categories", "id", [department._id, leaf._id]);
      await deleteRows("customers", "id", user._id);
    }
  });
});
