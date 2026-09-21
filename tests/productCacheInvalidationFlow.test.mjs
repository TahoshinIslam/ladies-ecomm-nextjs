// Cache behaviour of the product/category/attribute admin routes, against the
// real test DB and a TAG-FAITHFUL fake of next/cache (unstable_cache stores
// results per tag; revalidateTag drops every entry carrying that tag — the
// contract the real Data Cache honours). That lets these tests prove what a
// plain "was revalidateTag called" mock can't: that a listing/attribute read
// that was ALREADY cached stops being served stale once the mutation commits,
// with no `.next/cache` clearing.
//
// Also covers: invalidation happens only after a successful commit (a rejected
// write invalidates nothing), and the attribute admin routes accept the bodies
// the admin UI really sends (they used to reject labelBn / a boolean
// derivedFromVariant, so Color/Size could not be assigned to a new department).
import { test, describe, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const cacheStore = new Map(); // key -> { value, tags }
const revalidated = [];
let invalidationWorks = true;

let mockUsable = true;
try {
  await mock.module("next/cache", {
    namedExports: {
      unstable_cache:
        (fn, keyParts = [], opts = {}) =>
        async (...args) => {
          const key = JSON.stringify([keyParts, args]);
          if (cacheStore.has(key)) return structuredClone(cacheStore.get(key).value);
          const value = await fn(...args);
          cacheStore.set(key, { value: structuredClone(value), tags: opts.tags || [] });
          return value;
        },
      revalidateTag: (tag) => {
        revalidated.push(tag);
        if (!invalidationWorks) return;
        for (const [key, entry] of cacheStore) if (entry.tags.includes(tag)) cacheStore.delete(key);
      },
      revalidatePath: () => {},
    },
  });
  // The GET routes resolve the visitor's locale from next/headers' cookies(),
  // which only exists inside a real request — give them an empty cookie jar.
  await mock.module("next/headers", {
    namedExports: {
      cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }),
      headers: async () => new Headers(),
    },
  });
} catch {
  mockUsable = false;
}

const {
  dbReady, skipReason, connectTestDb, disconnectTestDb, createTestSession, requestAs, createTestUser, deleteRows, rawQuery,
} = await import("./helpers/testDb.mjs");

const skip = !dbReady ? skipReason : !mockUsable ? "node:test module mocking unavailable — run with --experimental-test-module-mocks" : false;
const IMG = "https://placehold.co/400x400.png?text=shoe";
const sfx = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe("product/category/attribute cache invalidation flow", { skip }, () => {
  let Category, AttributeDefinition, scope;
  let productsGET, productsPOST, productPUT, categoryPUT, categoryDELETE, attributesGET, attributesPOST, attributePUT;
  let admin;
  const madeProducts = [];
  const madeCategories = [];
  const madeDefs = [];

  const asAdmin = async (method, url, body) => requestAs({ method, url, session: await createTestSession(admin._id), body });
  const anon = (url) => requestAs({ method: "GET", url });
  const idParams = (id) => ({ params: Promise.resolve({ id: String(id), idOrSlug: String(id) }) });

  async function newShoeDepartment({ isActive = true } = {}) {
    const s = sfx();
    const dept = await Category.create({ name: "Shoes", slug: `shoes-${s}`, isActive });
    const leaf = await Category.create({ name: "Sneakers", slug: `sneakers-${s}`, parent: dept._id });
    madeCategories.push(leaf._id, dept._id);
    scope.resetStorefrontScopeCache();
    return { dept, leaf, s };
  }
  const shoeBody = (leaf, s, extra = {}) => ({
    name: `Cache Shoe ${s}`,
    description: "A shoe used to prove cache invalidation.",
    category: String(leaf._id),
    basePrice: 5000,
    images: [IMG],
    variants: [{ variantName: "Default", sku: `CS-${s}`, attributes: {}, stock: 4 }],
    ...extra,
  });
  async function createShoe(body) {
    const res = await productsPOST(await asAdmin("POST", "http://test/api/products", body));
    const json = await res.json();
    if (res.status === 201) madeProducts.push(json.product._id);
    return { res, json };
  }
  async function storefrontNames(deptId) {
    const res = await productsGET(anon(`http://test/api/products?category=${deptId}`));
    assert.equal(res.status, 200);
    return (await res.json()).products.map((p) => p.name);
  }

  before(async () => {
    await connectTestDb();
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ default: AttributeDefinition } = await import("../models/attributeDefinitionModel.js"));
    scope = await import("../services/storefrontScopeService.js");
    ({ GET: productsGET, POST: productsPOST } = await import("../app/api/products/route.js"));
    ({ PUT: productPUT } = await import("../app/api/products/[idOrSlug]/route.js"));
    ({ PUT: categoryPUT, DELETE: categoryDELETE } = await import("../app/api/categories/[id]/route.js"));
    ({ GET: attributesGET, POST: attributesPOST } = await import("../app/api/attributes/route.js"));
    ({ PUT: attributePUT } = await import("../app/api/attributes/[id]/route.js"));
    admin = await createTestUser({ role: "admin" });
  });

  beforeEach(() => {
    cacheStore.clear();
    revalidated.length = 0;
    invalidationWorks = true;
  });

  after(async () => {
    try {
      await deleteRows("products", "id", madeProducts);
      await deleteRows("attribute_definitions", "id", madeDefs);
      await deleteRows("categories", "id", madeCategories);
      await deleteRows("customers", "id", admin._id);
    } finally {
      await disconnectTestDb();
    }
  });

  describe("products", () => {
    test("creating a product invalidates the catalog tag, and an already-cached listing then includes it", async () => {
      const { dept, leaf, s } = await newShoeDepartment();
      assert.deepEqual(await storefrontNames(dept._id), [], "empty listing is now cached");
      assert.ok(cacheStore.size > 0, "the listing read really went through the cache");

      const { res } = await createShoe(shoeBody(leaf, s));
      assert.equal(res.status, 201);
      assert.ok(revalidated.includes("catalog"), "create must revalidate the catalog tag");
      assert.deepEqual(await storefrontNames(dept._id), [`Cache Shoe ${s}`]);
    });

    test("control: WITHOUT invalidation the cached listing stays stale (proves the test can detect a stale cache)", async () => {
      const { dept, leaf, s } = await newShoeDepartment();
      await storefrontNames(dept._id);
      invalidationWorks = false;
      await createShoe(shoeBody(leaf, s));
      assert.deepEqual(await storefrontNames(dept._id), [], "stale listing is served when nothing invalidates it");
      invalidationWorks = true;
      cacheStore.clear();
      assert.equal((await storefrontNames(dept._id)).length, 1, "the product itself is fine — only the cache was stale");
    });

    test("updating a product invalidates the catalog AND that product's own tag", async () => {
      const { leaf, s } = await newShoeDepartment();
      const { json } = await createShoe(shoeBody(leaf, s));
      revalidated.length = 0;
      const res = await productPUT(await asAdmin("PUT", `http://test/api/products/${json.product._id}`, { basePrice: 5200 }), idParams(json.product._id));
      assert.equal(res.status, 200);
      assert.ok(revalidated.includes("catalog"));
      assert.ok(revalidated.includes(`product:${json.product._id}`));
    });

    test("a rejected create or update (duplicate SKU) invalidates NOTHING — invalidation follows a successful commit only", async () => {
      const { leaf, s } = await newShoeDepartment();
      const first = await createShoe(shoeBody(leaf, s));
      const second = await createShoe(shoeBody(leaf, `${s}b`));
      revalidated.length = 0;

      const dup = await createShoe(shoeBody(leaf, `${s}c`, { variants: [{ variantName: "x", sku: `CS-${s}`, attributes: {}, stock: 1 }] }));
      assert.equal(dup.res.status, 400);
      const put = await productPUT(
        await asAdmin("PUT", `http://test/api/products/${second.json.product._id}`, {
          variants: [{ ...second.json.product.variants[0], sku: first.json.product.variants[0].sku }],
        }),
        idParams(second.json.product._id),
      );
      assert.equal(put.status, 400);
      assert.deepEqual(revalidated, []);
    });

    test("REPAIR SCENARIO: a shoe hidden by an inactive department appears immediately once the department is activated — no .next/cache clearing", async () => {
      const { dept, leaf, s } = await newShoeDepartment({ isActive: false });
      const { res } = await createShoe(shoeBody(leaf, s));
      assert.equal(res.status, 201);
      assert.deepEqual(await storefrontNames(dept._id), [], "hidden (and that empty answer is cached)");

      const activate = await categoryPUT(await asAdmin("PUT", `http://test/api/categories/${dept._id}`, { isActive: true }), idParams(dept._id));
      assert.equal(activate.status, 200);
      assert.ok(revalidated.includes("categories") && revalidated.includes("catalog"));
      assert.deepEqual(await storefrontNames(dept._id), [`Cache Shoe ${s}`]);
    });

    test("deleting a category also invalidates the attributes cache (its assignments are removed with it)", async () => {
      const s = sfx();
      const dept = await Category.create({ name: "Temp dept", slug: `temp-${s}` });
      madeCategories.push(dept._id);
      const def = await AttributeDefinition.create({ key: `tmp${s}`, label: "Tmp", type: "select", derivedFromVariant: true, appliesToCategories: [dept._id] });
      madeDefs.push(def._id);
      const res = await categoryDELETE(await asAdmin("DELETE", `http://test/api/categories/${dept._id}`), idParams(dept._id));
      assert.equal(res.status, 200);
      assert.ok(revalidated.includes("attributes"));
      const left = await rawQuery("SELECT COUNT(*) AS n FROM attribute_definition_categories WHERE category_id = ?", [String(dept._id)]);
      assert.equal(left[0].n, 0, "no dangling assignment survives the category (the exact corruption that hid Color/Size)");
    });
  });

  describe("attributes route (what the product form loads for the selected department)", () => {
    test("GET ?category=<Shoes> returns the department's Color and Size once assigned, with options, straight after the write", async () => {
      const { dept } = await newShoeDepartment();
      const s = sfx();
      const before = await (await attributesGET(await asAdmin("GET", `http://test/api/attributes?category=${dept._id}`))).json();
      assert.ok(!before.attributes.some((a) => a.key === `color${s}`));

      // Exactly the body the admin Attributes form / Product configuration sends.
      const create = async (key, label, type, options) => {
        const res = await attributesPOST(
          await asAdmin("POST", "http://test/api/attributes", {
            key, label, labelBn: "", type, options, appliesToCategories: [String(dept._id)],
            filterable: true, required: false, derivedFromVariant: true, sortOrder: 0,
          }),
        );
        assert.equal(res.status, 201, await res.clone().text());
        madeDefs.push((await res.json()).attribute._id);
      };
      await create(`color${s}`, "Color", "swatch", [{ value: "black", label: "Black", labelBn: "", swatchHex: "#111111" }]);
      await create(`size${s}`, "Size", "select", ["40", "41"].map((v) => ({ value: v, label: v, labelBn: "", swatchHex: "" })));

      const after = await (await attributesGET(await asAdmin("GET", `http://test/api/attributes?category=${dept._id}`))).json();
      const byKey = new Map(after.attributes.map((a) => [a.key, a]));
      assert.ok(byKey.get(`color${s}`)?.derivedFromVariant && byKey.get(`size${s}`)?.derivedFromVariant);
      assert.deepEqual(byKey.get(`size${s}`).options.map((o) => o.value), ["40", "41"]);
      assert.equal(byKey.get(`color${s}`).type, "swatch");
    });

    test("editing an attribute from the admin form (sends labelBn) is accepted and persists the Bangla label", async () => {
      const s = sfx();
      const def = await AttributeDefinition.create({ key: `edit${s}`, label: "Old", type: "select" });
      madeDefs.push(def._id);
      const res = await attributePUT(
        await asAdmin("PUT", `http://test/api/attributes/${def._id}`, { label: "New", labelBn: "নতুন", type: "select", options: [], appliesToCategories: [], filterable: true, required: false, sortOrder: 0 }),
        idParams(def._id),
      );
      assert.equal(res.status, 200, await res.clone().text());
      const [row] = await rawQuery("SELECT label, label_bn FROM attribute_definitions WHERE id = ?", [String(def._id)]);
      assert.deepEqual([row.label, row.label_bn], ["New", "নতুন"]);
      assert.ok(revalidated.includes("attributes"));
    });
  });
});
