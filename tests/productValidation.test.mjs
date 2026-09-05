// Phase 5B — POST/PUT /api/products validation (previously entirely
// unvalidated beyond Mongoose's own schema-level checks).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestSession, requestAs, createTestUser, createTestCategory } from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("POST/PUT /api/products — validation contract", { skip: !canRun && reason }, () => {
  let productsPOST, productPUT, productDELETE;
  let Product, User, Category;

  before(async () => {
    await connectTestDb();
    ({ POST: productsPOST } = await import("../app/api/products/route.js"));
    ({ PUT: productPUT, DELETE: productDELETE } = await import("../app/api/products/[idOrSlug]/route.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Category } = await import("../models/categoryModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  function validProductBody(categoryId) {
    return {
      name: "Test Abaya",
      description: "A test product",
      category: categoryId,
      basePrice: 1000,
      images: ["https://example.test/a.jpg"],
      variants: [{ variantName: "Default", sku: `SKU-${Date.now()}`, stock: 10 }],
    };
  }

  async function createReq(admin, body) {
    return requestAs({ method: "POST", url: "http://test/api/products", session: await createTestSession(admin._id), body });
  }

  test("a valid product succeeds (201)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const category = await createTestCategory();
    const child = await Category.create({ name: "Child", slug: `child-${Date.now()}`, parent: category._id });
    try {
      const res = await productsPOST(await createReq(admin, validProductBody(child._id.toString())));
      assert.equal(res.status, 201);
      const json = await res.json();
      await Product.deleteOne({ _id: json.product._id });
    } finally {
      await Category.deleteMany({ _id: { $in: [category._id, child._id] } });
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("negative basePrice is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const category = await createTestCategory();
    const child = await Category.create({ name: "Child", slug: `child-${Date.now()}`, parent: category._id });
    try {
      const body = { ...validProductBody(child._id.toString()), basePrice: -5 };
      const res = await productsPOST(await createReq(admin, body));
      assert.equal(res.status, 400);
    } finally {
      await Category.deleteMany({ _id: { $in: [category._id, child._id] } });
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("a malformed category id (not an ObjectId) is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const body = { ...validProductBody("not-an-object-id") };
      const res = await productsPOST(await createReq(admin, body));
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("empty variants array is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const category = await createTestCategory();
    const child = await Category.create({ name: "Child", slug: `child-${Date.now()}`, parent: category._id });
    try {
      const body = { ...validProductBody(child._id.toString()), variants: [] };
      const res = await productsPOST(await createReq(admin, body));
      assert.equal(res.status, 400);
    } finally {
      await Category.deleteMany({ _id: { $in: [category._id, child._id] } });
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("a Mongo-operator-shaped field is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const category = await createTestCategory();
    const child = await Category.create({ name: "Child", slug: `child-${Date.now()}`, parent: category._id });
    try {
      const body = { ...validProductBody(child._id.toString()), basePrice: { $gt: 0 } };
      const res = await productsPOST(await createReq(admin, body));
      assert.equal(res.status, 400);
    } finally {
      await Category.deleteMany({ _id: { $in: [category._id, child._id] } });
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("negative variant stock is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const category = await createTestCategory();
    const child = await Category.create({ name: "Child", slug: `child-${Date.now()}`, parent: category._id });
    try {
      const body = validProductBody(child._id.toString());
      body.variants[0].stock = -1;
      const res = await productsPOST(await createReq(admin, body));
      assert.equal(res.status, 400);
    } finally {
      await Category.deleteMany({ _id: { $in: [category._id, child._id] } });
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("an unknown field is rejected (mass-assignment guard)", async () => {
    const admin = await createTestUser({ role: "admin" });
    const category = await createTestCategory();
    const child = await Category.create({ name: "Child", slug: `child-${Date.now()}`, parent: category._id });
    try {
      const body = { ...validProductBody(child._id.toString()), notARealField: "x" };
      const res = await productsPOST(await createReq(admin, body));
      assert.equal(res.status, 400);
    } finally {
      await Category.deleteMany({ _id: { $in: [category._id, child._id] } });
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("PUT with a malformed product id -> 400", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await productPUT(
        requestAs({ method: "PUT", url: "http://test/api/products/not-a-valid-id", session: await createTestSession(admin._id), body: { name: "x" } }),
        { params: Promise.resolve({ idOrSlug: "not-a-valid-id" }) },
      );
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("PUT with an empty body is rejected (400) — 'at least one field' guard", async () => {
    const admin = await createTestUser({ role: "admin" });
    const category = await createTestCategory();
    const child = await Category.create({ name: "Child", slug: `child-${Date.now()}`, parent: category._id });
    let product;
    try {
      const res = await productsPOST(await createReq(admin, validProductBody(child._id.toString())));
      product = (await res.json()).product;

      const emptyRes = await productPUT(
        requestAs({ method: "PUT", url: `http://test/api/products/${product._id}`, session: await createTestSession(admin._id), body: {} }),
        { params: Promise.resolve({ idOrSlug: product._id }) },
      );
      assert.equal(emptyRes.status, 400);
    } finally {
      if (product) await Product.deleteOne({ _id: product._id });
      await Category.deleteMany({ _id: { $in: [category._id, child._id] } });
      await User.deleteOne({ _id: admin._id });
    }
  });

  test("DELETE with a malformed product id -> 400", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const res = await productDELETE(
        requestAs({ method: "DELETE", url: "http://test/api/products/not-a-valid-id", session: await createTestSession(admin._id) }),
        { params: Promise.resolve({ idOrSlug: "not-a-valid-id" }) },
      );
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: admin._id });
    }
  });
});
