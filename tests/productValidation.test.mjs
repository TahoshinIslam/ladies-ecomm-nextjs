// Phase 5B — POST/PUT /api/products validation (previously entirely
// unvalidated beyond Mongoose's own schema-level checks).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, truncateAll, createTestSession, requestAs, createTestUser, createTestCategory, deleteRows, rawQuery } from "./helpers/testDb.mjs";
import { generateObjectId } from "../lib/objectId.js";

const canRun = dbReady;
const reason = skipReason;

describe("POST/PUT /api/products — validation contract", { skip: !canRun && reason }, () => {
  let productsPOST, productPUT, productDELETE;
  let Product, User, Category;

  before(async () => {
    await connectTestDb();
    await truncateAll();
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
      await deleteRows("products", "id", json.product._id);
    } finally {
      await deleteRows("categories", "id", [category._id, child._id]);
      await deleteRows("users", "id", admin._id);
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
      await deleteRows("categories", "id", [category._id, child._id]);
      await deleteRows("users", "id", admin._id);
    }
  });

  test("a malformed category id (not an ObjectId) is rejected (400)", async () => {
    const admin = await createTestUser({ role: "admin" });
    try {
      const body = { ...validProductBody("not-an-object-id") };
      const res = await productsPOST(await createReq(admin, body));
      assert.equal(res.status, 400);
    } finally {
      await deleteRows("users", "id", admin._id);
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
      await deleteRows("categories", "id", [category._id, child._id]);
      await deleteRows("users", "id", admin._id);
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
      await deleteRows("categories", "id", [category._id, child._id]);
      await deleteRows("users", "id", admin._id);
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
      await deleteRows("categories", "id", [category._id, child._id]);
      await deleteRows("users", "id", admin._id);
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
      await deleteRows("categories", "id", [category._id, child._id]);
      await deleteRows("users", "id", admin._id);
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
      await deleteRows("users", "id", admin._id);
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
      if (product) await deleteRows("products", "id", product._id);
      await deleteRows("categories", "id", [category._id, child._id]);
      await deleteRows("users", "id", admin._id);
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
      await deleteRows("users", "id", admin._id);
    }
  });

  // Regression coverage for the ObjectId-vs-string defect: updateProduct()
  // fell back to the hydrated (non-.lean()) product's `category`, a real
  // Mongoose ObjectId instance, which failed resolveLeafCategory's
  // isObjectIdFormat() string check and wrongly 400'd any partial update
  // that omitted `category` — see services/productService.js.
  describe("PUT partial updates — category is optional and preserved", () => {
    let admin, category, child, product;

    before(async () => {
      admin = await createTestUser({ role: "admin" });
      category = await createTestCategory();
      child = await Category.create({ name: "Child", slug: `child-${Date.now()}-${Math.random()}`, parent: category._id });
    });

    after(async () => {
      await deleteRows("categories", "id", [category._id, child._id]);
      await deleteRows("users", "id", admin._id);
    });

    async function freshProduct() {
      const res = await productsPOST(await createReq(admin, validProductBody(child._id.toString())));
      assert.equal(res.status, 201);
      return (await res.json()).product;
    }

    test("PUT with only basePrice succeeds (200), preserves category, and does NOT corrupt topCategory", async () => {
      product = await freshProduct();
      try {
        const res = await productPUT(
          requestAs({ method: "PUT", url: `http://test/api/products/${product._id}`, session: await createTestSession(admin._id), body: { basePrice: 999 } }),
          { params: Promise.resolve({ idOrSlug: product._id }) },
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.product.basePrice, 999);
        assert.equal(String(json.product.category), child._id.toString());
        // Confirmed live bug, fixed: models/productModel.js's
        // resolveDerivedFields() previously received the already-hydrated
        // (populated-object) `category` from the pre-update Product.findById()
        // read whenever the request body didn't itself include `category`
        // — silently writing the literal string "[object Object]" into
        // top_category_id instead of the real department id, which broke
        // this product's storefront category-scoped visibility (see
        // services/productService.js's getStorefrontDepartmentIds()) while
        // leaving everything else about it looking normal.
        assert.equal(
          String(json.product.topCategory?._id ?? json.product.topCategory),
          category._id.toString(),
          "topCategory must remain the real department id — must never become the literal string \"[object Object]\"",
        );
        const [row] = await rawQuery("SELECT top_category_id FROM products WHERE id = ?", [product._id]);
        assert.equal(row.top_category_id, category._id.toString(), "the raw DB column itself must hold the real id, not a corrupted string");
      } finally {
        await deleteRows("products", "id", product._id);
      }
    });

    test("PUT with only isFeatured succeeds (200) and preserves category", async () => {
      product = await freshProduct();
      try {
        const res = await productPUT(
          requestAs({ method: "PUT", url: `http://test/api/products/${product._id}`, session: await createTestSession(admin._id), body: { isFeatured: true } }),
          { params: Promise.resolve({ idOrSlug: product._id }) },
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.product.isFeatured, true);
        assert.equal(String(json.product.category), child._id.toString());
      } finally {
        await deleteRows("products", "id", product._id);
      }
    });

    test("PUT with an explicit malformed category still 400", async () => {
      product = await freshProduct();
      try {
        const res = await productPUT(
          requestAs({ method: "PUT", url: `http://test/api/products/${product._id}`, session: await createTestSession(admin._id), body: { category: "not-an-object-id" } }),
          { params: Promise.resolve({ idOrSlug: product._id }) },
        );
        assert.equal(res.status, 400);
      } finally {
        await deleteRows("products", "id", product._id);
      }
    });

    test("PUT with an explicit valid-but-nonexistent category still 400 (not-found contract unchanged)", async () => {
      product = await freshProduct();
      try {
        const fakeId = generateObjectId();
        const res = await productPUT(
          requestAs({ method: "PUT", url: `http://test/api/products/${product._id}`, session: await createTestSession(admin._id), body: { category: fakeId } }),
          { params: Promise.resolve({ idOrSlug: product._id }) },
        );
        assert.equal(res.status, 400);
      } finally {
        await deleteRows("products", "id", product._id);
      }
    });

    test("PUT of a missing product still 404", async () => {
      const fakeId = generateObjectId();
      const res = await productPUT(
        requestAs({ method: "PUT", url: `http://test/api/products/${fakeId}`, session: await createTestSession(admin._id), body: { basePrice: 5 } }),
        { params: Promise.resolve({ idOrSlug: fakeId }) },
      );
      assert.equal(res.status, 404);
    });
  });
});
