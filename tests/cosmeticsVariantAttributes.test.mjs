// Proves the cosmetics-generalization change: variant/snapshot `attributes`
// is now an arbitrary key/value bag driven by
// AttributeDefinition.derivedFromVariant, not a fixed color/size/fabric
// shape (see models/productModel.js, models/cartModel.js,
// models/orderModel.js, and scripts/migrateOrderSnapshotAttributes.mjs).
// This test creates its OWN department/category/attribute-definition data
// (never depends on scripts/seedCatalog.mjs having run) and exercises a
// non-clothing key ("shade") end to end: product facet-sync -> cart
// snapshot -> real order creation -> the legacy-order migration script.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  createTestSession,
  requestAs,
  createTestUser,
} from "./helpers/testDb.mjs";

const execFileAsync = promisify(execFile);
const canRun = dbReady;
const reason = skipReason;
const MIGRATION_SCRIPT = new URL("../scripts/migrateOrderSnapshotAttributes.mjs", import.meta.url).pathname;

function runMigration(extraArgs = []) {
  return execFileAsync("node", [MIGRATION_SCRIPT, ...extraArgs], {
    env: { ...process.env, NODE_ENV: "test" },
  }).catch((err) => err);
}

describe("Variant attributes generalize beyond color/size/fabric (cosmetics test case)", { skip: !canRun && reason }, () => {
  let Category, AttributeDefinition, Product, Order, Cart, User;
  let cartPOST, orderCreatePOST;

  before(async () => {
    await connectTestDb();
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ default: AttributeDefinition } = await import("../models/attributeDefinitionModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ default: Order } = await import("../models/orderModel.js"));
    ({ default: Cart } = await import("../models/cartModel.js"));
    ({ default: User } = await import("../models/userModel.js"));
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
        images: ["https://placehold.co/400x400?text=lipstick"],
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
      if (product) await Product.deleteOne({ _id: product._id });
      await AttributeDefinition.deleteOne({ _id: shadeDef._id });
      await Category.deleteMany({ _id: { $in: [department._id, leaf._id] } });
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
      images: ["https://placehold.co/400x400?text=foundation"],
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

      await Order.deleteMany({ user: user._id });
    } finally {
      await Cart.deleteMany({ userId: user._id });
      await Product.deleteOne({ _id: product._id });
      await AttributeDefinition.deleteOne({ _id: shadeDef._id });
      await Category.deleteMany({ _id: { $in: [department._id, leaf._id] } });
      await User.deleteOne({ _id: user._id });
    }
  });

  describe("scripts/migrateOrderSnapshotAttributes.mjs — real behavior against a disposable test database", () => {
    test("dry-run reports legacy orders without writing; --apply folds color/size/fabric into attributes and is a safe no-op the second time", async () => {
      const user = await createTestUser();
      // Simulate a historical, pre-migration order document — inserted via
      // the raw collection (not Order.create) because the current schema no
      // longer declares snapshot.color/size/fabric, so Mongoose would strip
      // them on a normal save.
      const legacyOrder = {
        user: user._id,
        items: [
          {
            product: user._id, // any ObjectId; not dereferenced by this script
            variantId: user._id,
            quantity: 1,
            snapshot: { name: "Legacy Item", sku: "LEGACY-1", color: "black", size: "xl", price: 100, image: "" },
          },
        ],
        shippingAddress: {
          fullName: "Legacy Buyer",
          phone: "0100000000",
          street: "1 Legacy Street",
          city: "Dhaka",
          postalCode: "1200",
          country: "Bangladesh",
        },
        subtotal: 100,
        total: 100,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const inserted = await Order.collection.insertOne(legacyOrder);

      try {
        const dryRun = await runMigration();
        const dryOutput = (dryRun.stdout || "") + (dryRun.stderr || "");
        assert.equal(dryRun.code ?? 0, 0, `dry-run must exit 0:\n${dryOutput}`);
        assert.match(dryOutput, /Dry run only/);
        assert.match(dryOutput, /color, size/);

        const stillLegacy = await Order.collection.findOne({ _id: inserted.insertedId });
        assert.equal(stillLegacy.items[0].snapshot.color, "black", "dry-run must not write");

        const apply = await runMigration(["--apply"]);
        const applyOutput = (apply.stdout || "") + (apply.stderr || "");
        assert.equal(apply.code ?? 0, 0, `--apply must exit 0:\n${applyOutput}`);
        assert.match(applyOutput, /Migrated 1 order/);

        const migrated = await Order.collection.findOne({ _id: inserted.insertedId });
        assert.equal(migrated.items[0].snapshot.attributes.color, "black");
        assert.equal(migrated.items[0].snapshot.attributes.size, "xl");
        assert.equal(migrated.items[0].snapshot.color, undefined, "the old color field must be gone after migration");
        assert.equal(migrated.items[0].snapshot.size, undefined, "the old size field must be gone after migration");
        // Every other item field must survive untouched.
        assert.equal(migrated.items[0].snapshot.sku, "LEGACY-1");
        assert.equal(migrated.items[0].snapshot.price, 100);
        assert.equal(migrated.items[0].quantity, 1);

        const rerun = await runMigration();
        const rerunOutput = (rerun.stdout || "") + (rerun.stderr || "");
        assert.match(rerunOutput, /Nothing to do/, "re-running after migration must find no legacy documents left");
      } finally {
        await Order.collection.deleteOne({ _id: inserted.insertedId });
        await User.deleteOne({ _id: user._id });
      }
    });
  });
});
