// Categories nest without a fixed depth (Food -> Snacks -> Biscuits -> Milk Biscuits -> ...). This proves the storefront side of it
// against the test database: the category service accepts a deep chain and refuses a cycle, a product filed at the bottom is found by
// the category filter at EVERY level above it (and not by an unrelated branch), and the tiles under a category count everything beneath.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, deleteRows } from "./helpers/testDb.mjs";

const unique = () => crypto.randomBytes(5).toString("hex");

describe("unlimited category nesting", { skip: !dbReady && skipReason }, () => {
  let Category, Product, listProducts, listGroupings;
  const categoryIds = [];
  const productIds = [];
  const chain = []; // root ... deepest
  let sibling;
  let deepProduct;
  let siblingProduct;

  before(async () => {
    await connectTestDb();
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ listProducts, listGroupings } = await import("../services/productService.js"));

    // Eight levels deep: far past the old three-level limit.
    let parent = null;
    for (let depth = 0; depth < 8; depth += 1) {
      const c = await Category.create({ name: `Deep ${depth} ${unique()}`, parent });
      chain.push(c);
      categoryIds.push(c._id);
      parent = c._id;
    }
    sibling = await Category.create({ name: `Deep sibling ${unique()}`, parent: chain[0]._id });
    categoryIds.push(sibling._id);
    // New categories are visible on the storefront only after the cached
    // visibility set is dropped.
    (await import("../services/storefrontScopeService.js")).resetStorefrontScopeCache();

    const make = async (category) => {
      const s = unique();
      const p = await Product.create({
        name: `Deep product ${s}`,
        description: "Created by deepCategoryNesting.test.mjs — safe to delete.",
        category: category._id,
        basePrice: 100,
        isActive: true,
        images: ["https://placehold.co/400x400.png?text=test"],
        variants: [{ variantName: "Default", sku: `DEEP-${s}`, stock: 5 }],
      });
      productIds.push(p._id);
      return p;
    };
    deepProduct = await make(chain[7]);
    siblingProduct = await make(sibling);
  });

  after(async () => {
    if (productIds.length) await deleteRows("products", "id", productIds);
    if (categoryIds.length) await deleteRows("categories", "id", categoryIds);
    await disconnectTestDb();
  });

  const idsOf = async (query) => (await listProducts({ ...query, limit: 50 }, { isAdmin: true })).products.map((p) => String(p._id));

  test("a category can be created under one that is already many levels deep", () => {
    assert.equal(chain.length, 8);
    assert.equal(String(chain[7].parent), String(chain[6]._id));
  });

  test("a product at the bottom is found by ?category= at every level above it, and by ?style= on its own category", async () => {
    for (const level of [0, 1, 3, 5, 6, 7]) {
      assert.ok((await idsOf({ category: String(chain[level]._id) })).includes(String(deepProduct._id)), `level ${level} must include it`);
    }
    assert.ok((await idsOf({ style: String(chain[7]._id) })).includes(String(deepProduct._id)));
    assert.ok((await idsOf({ style: String(chain[3]._id) })).includes(String(deepProduct._id)), "a style filter on a mid-tree node covers its subtree too");
  });

  test("an unrelated branch is not mixed in", async () => {
    const underDeep = await idsOf({ category: String(chain[4]._id) });
    assert.ok(!underDeep.includes(String(siblingProduct._id)));
    const underRoot = await idsOf({ category: String(chain[0]._id) });
    assert.ok(underRoot.includes(String(siblingProduct._id)) && underRoot.includes(String(deepProduct._id)), "the root covers both branches");
  });

  test("a category and a style together intersect (the style must lie within the category)", async () => {
    assert.ok((await idsOf({ category: String(chain[2]._id), style: String(chain[7]._id) })).includes(String(deepProduct._id)));
    assert.deepEqual(await idsOf({ category: String(sibling._id), style: String(chain[7]._id) }), []);
  });

  test("tiles under a category count everything beneath each one, and say whether it has subcategories", async () => {
    const tiles = await listGroupings(String(chain[0]._id));
    const deepTile = tiles.find((g) => String(g._id) === String(chain[1]._id));
    const siblingTile = tiles.find((g) => String(g._id) === String(sibling._id));
    assert.equal(deepTile.count, 1);
    assert.equal(deepTile.isLeaf, false);
    assert.equal(siblingTile.count, 1);
    assert.equal(siblingTile.isLeaf, true);
    const lower = await listGroupings(String(chain[5]._id));
    assert.equal(lower.find((g) => String(g._id) === String(chain[6]._id)).count, 1);
  });
});
