// End-to-end product + variant flow against the real (disposable) test DB,
// using the same Route Handlers the admin form and the storefront call.
//
// Regression coverage for the reported bug pair:
//   (1) the admin form showed no Color/Size/variant attribute fields, and
//   (2) a shoe created in a new "Shoes" department never appeared anywhere
//       on the storefront (it was filtered out by a hard-coded department
//       slug allowlist, so its top_category_id never matched).
// Everything here builds its OWN department / attribute / product data —
// nothing depends on the seed scripts having run.
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
  rawQuery, testOrganizationId } from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

const IMG = "https://placehold.co/400x400.png?text=shoe";
const sfx = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe("product create/edit + storefront visibility (shoes)", { skip: !canRun && reason }, () => {
  let Category, AttributeDefinition, Product, Cart;
  let productsPOST, productPUT, productDELETE, cartPOST;
  let svc, scope, attrSvc;
  let admin, customer;
  const madeProducts = [];
  const madeCategories = [];
  const madeDefs = [];
  const madeUsers = [];

  // A "Shoes" department (root, with a leaf) whose Color/Size definitions are
  // assigned to it — the state the migration/seed produces for real data.
  let shoes, sneakers, colorKey, sizeKey;

  const asAdmin = async (method, url, body) =>
    requestAs({ method, url, session: await createTestSession(admin._id), body });
  const paramsOf = (id) => ({ params: Promise.resolve({ idOrSlug: String(id) }) });

  const shoeBody = (over = {}) => {
    const s = sfx();
    return {
      name: `Test Runner ${s}`,
      description: "A test running shoe with colour and size variants.",
      category: String(sneakers._id),
      basePrice: 7000,
      images: [IMG],
      variants: [
        { variantName: "Black / 40", sku: `SHOE-${s}-BLK-40`, attributes: { [colorKey]: "black", [sizeKey]: "40" }, stock: 5 },
        { variantName: "Black / 41", sku: `SHOE-${s}-BLK-41`, attributes: { [colorKey]: "black", [sizeKey]: "41" }, stock: 3 },
        { variantName: "Brown / 40", sku: `SHOE-${s}-BRN-40`, attributes: { [colorKey]: "brown", [sizeKey]: "40" }, stock: 2 },
      ],
      ...over,
    };
  };
  async function createViaRoute(body) {
    const res = await productsPOST(await asAdmin("POST", "http://test/api/products", body));
    const json = await res.json();
    if (res.status === 201) madeProducts.push(json.product._id);
    return { res, json };
  }
  const listNames = async (raw = {}, { isAdmin = false } = {}) => {
    const q = await svc.parseProductListQuery(raw);
    const r = await svc.listProducts(q, { isAdmin });
    return r.products.map((p) => p.name);
  };

  before(async () => {
    await connectTestDb();
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ default: AttributeDefinition } = await import("../models/attributeDefinitionModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ default: Cart } = await import("../models/cartModel.js"));
    ({ POST: productsPOST } = await import("../app/api/products/route.js"));
    ({ PUT: productPUT, DELETE: productDELETE } = await import("../app/api/products/[idOrSlug]/route.js"));
    ({ POST: cartPOST } = await import("../app/api/cart/route.js"));
    svc = await import("../services/productService.js");
    scope = await import("../services/storefrontScopeService.js");
    attrSvc = await import("../services/attributeService.js");

    admin = await createTestUser({ role: "admin" });
    customer = await createTestUser({ role: "customer" });
    madeUsers.push(admin._id, customer._id);

    const s = sfx();
    // Deliberately NOT one of the seeded department slugs.
    shoes = await Category.create({ name: "Shoes", slug: `shoes-${s}` });
    sneakers = await Category.create({ name: "Sneakers", slug: `sneakers-${s}`, parent: shoes._id });
    madeCategories.push(sneakers._id, shoes._id);
    colorKey = `color${s}`;
    sizeKey = `shoesize${s}`;
    const color = await AttributeDefinition.create({
      key: colorKey, label: "Color", type: "swatch", derivedFromVariant: true, appliesToCategories: [shoes._id],
      options: [{ value: "black", label: "Black", swatchHex: "#111111" }, { value: "brown", label: "Brown", swatchHex: "#654321" }],
    });
    const size = await AttributeDefinition.create({
      key: sizeKey, label: "Size", type: "select", derivedFromVariant: true, appliesToCategories: [shoes._id],
      options: ["39", "40", "41", "42"].map((v) => ({ value: v, label: v })),
    });
    madeDefs.push(color._id, size._id);
    scope.resetStorefrontScopeCache();
  });

  after(async () => {
    try {
      await deleteRows("carts", "customer_id", madeUsers);
      await deleteRows("products", "id", madeProducts);
      await deleteRows("attribute_definitions", "id", madeDefs);
      await deleteRows("categories", "id", madeCategories);
      await deleteRows("customers", "id", madeUsers);
    } finally {
      await disconnectTestDb();
    }
  });

  describe("applicable variant fields", () => {
    test("selecting the Shoes department yields its Color and Size definitions, with options and a swatch type", async () => {
      const defs = await attrSvc.resolveAttributesForCategory(String(shoes._id));
      const byKey = new Map(defs.map((d) => [d.key, d]));
      assert.ok(byKey.has(colorKey) && byKey.has(sizeKey), "Color and Size must both apply to Shoes");
      assert.equal(byKey.get(colorKey).type, "swatch");
      assert.equal(byKey.get(colorKey).derivedFromVariant, true);
      assert.deepEqual(byKey.get(sizeKey).options.map((o) => o.value), ["39", "40", "41", "42"]);
      assert.equal(byKey.get(sizeKey).label, "Size");
    });

    test("another department does NOT receive Shoes' scoped attributes", async () => {
      const other = await Category.create({ name: "Other", slug: `other-${sfx()}` });
      madeCategories.push(other._id);
      const keys = (await attrSvc.resolveAttributesForCategory(String(other._id))).map((d) => d.key);
      assert.ok(!keys.includes(colorKey) && !keys.includes(sizeKey));
    });
  });

  describe("create", () => {
    test("persists every variant combination, its attributes, stock and the derived facet rows", async () => {
      const body = shoeBody();
      const { res, json } = await createViaRoute(body);
      assert.equal(res.status, 201, JSON.stringify(json));

      const variants = await rawQuery("SELECT * FROM product_variants WHERE product_id = ? ORDER BY position", [json.product._id]);
      assert.equal(variants.length, 3);
      assert.deepEqual(
        variants.map((v) => [v.sku, JSON.parse(v.attributes), v.stock]),
        body.variants.map((v) => [v.sku, v.attributes, v.stock]),
      );
      const facets = await rawQuery("SELECT attr_key, attr_value FROM product_attributes WHERE product_id = ? ORDER BY attr_key, attr_value", [json.product._id]);
      const grouped = {};
      for (const f of facets) (grouped[f.attr_key] ||= []).push(f.attr_value);
      assert.deepEqual(grouped[colorKey], ["black", "brown"]);
      assert.deepEqual(grouped[sizeKey], ["40", "41"]);

      const [row] = await rawQuery("SELECT top_category_id, category_id, is_active, price_currency, base_price, slug FROM products WHERE id = ?", [json.product._id]);
      assert.equal(row.top_category_id, String(shoes._id), "top_category_id must be the Shoes department, not the leaf");
      assert.equal(row.category_id, String(sneakers._id));
      assert.equal(row.is_active, 1);
      assert.equal(row.price_currency, "BDT");
      assert.equal(Number(row.base_price), 7000);
      assert.match(row.slug, /^test-runner-.+-[0-9a-f]{6}$/);
    });

    test("rejects an unknown variant attribute key, and a duplicate combination", async () => {
      const bad = shoeBody();
      bad.variants[0].attributes = { fabricX: "silk" };
      const r1 = await createViaRoute(bad);
      assert.equal(r1.res.status, 400);
      assert.match(JSON.stringify(r1.json), /fabricX/);

      const dupe = shoeBody();
      dupe.variants[1].attributes = { ...dupe.variants[0].attributes };
      const r2 = await createViaRoute(dupe);
      assert.equal(r2.res.status, 400);
      assert.match(JSON.stringify(r2.json), /Two variants are both/);
    });

    test("rejects negative / fractional stock and a missing SKU before anything is written", async () => {
      const before = (await rawQuery("SELECT COUNT(*) AS n FROM products"))[0].n;
      for (const patch of [{ stock: -1 }, { stock: 1.5 }, { sku: "" }]) {
        const body = shoeBody();
        Object.assign(body.variants[0], patch);
        const { res } = await createViaRoute(body);
        assert.equal(res.status, 400, JSON.stringify(patch));
      }
      assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM products"))[0].n, before);
    });
  });

  describe("duplicate SKUs", () => {
    test("two variants of one product sharing a SKU (even differing only by case) are rejected with the SKU named", async () => {
      const body = shoeBody();
      body.variants[1].sku = body.variants[0].sku.toLowerCase();
      const { res, json } = await createViaRoute(body);
      assert.equal(res.status, 400);
      assert.match(JSON.stringify(json), new RegExp(body.variants[1].sku, "i"));
    });

    test("a SKU already used by ANOTHER product is rejected on create and on edit, leaving no half-written product", async () => {
      const first = await createViaRoute(shoeBody());
      assert.equal(first.res.status, 201);
      const takenSku = first.json.product.variants[0].sku;

      const productsBefore = (await rawQuery("SELECT COUNT(*) AS n FROM products"))[0].n;
      const clash = shoeBody();
      clash.variants[2].sku = takenSku;
      const created = await createViaRoute(clash);
      assert.equal(created.res.status, 400);
      assert.match(JSON.stringify(created.json), /already used/i);
      assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM products"))[0].n, productsBefore);

      const second = await createViaRoute(shoeBody());
      const put = await productPUT(
        await asAdmin("PUT", `http://test/api/products/${second.json.product._id}`, {
          variants: second.json.product.variants.map((v, i) => ({ ...v, sku: i === 0 ? takenSku : v.sku })),
        }),
        paramsOf(second.json.product._id),
      );
      assert.equal(put.status, 400);
      const stored = await rawQuery("SELECT sku FROM product_variants WHERE product_id = ? ORDER BY position", [second.json.product._id]);
      assert.deepEqual(stored.map((r) => r.sku), second.json.product.variants.map((v) => v.sku), "a failed edit must change nothing");
    });

    test("the database itself enforces uniqueness (case-insensitive) — the constraint is real, not just app-level", async () => {
      const { json } = await createViaRoute(shoeBody());
      const [{ sku }] = await rawQuery("SELECT sku FROM product_variants WHERE product_id = ? LIMIT 1", [json.product._id]);
      await assert.rejects(
        rawQuery(
          "INSERT INTO product_variants (id, organization_id, product_id, variant_name, sku, attributes, stock, images, position) VALUES (?, ?, ?, 'x', ?, '{}', 1, '[]', 9)",
          [`ffffffffffffffffffff${String(Math.floor(Math.random() * 9000) + 1000)}`, testOrganizationId(), json.product._id, sku.toUpperCase()],
        ),
        (err) => err.code === "ER_DUP_ENTRY",
      );
    });
  });

  describe("atomicity", () => {
    test("Product.create rolls back the product row when a later variant insert fails (no variant-less orphan)", async () => {
      const s = sfx();
      const before = (await rawQuery("SELECT COUNT(*) AS n FROM products"))[0].n;
      await assert.rejects(
        Product.create({
          name: `Orphan check ${s}`, description: "must not survive", category: sneakers._id, basePrice: 10, images: [IMG],
          // Bypasses the service's checks on purpose: the DB constraint fires on the 2nd row.
          variants: [
            { variantName: "a", sku: `ORPH-${s}`, attributes: {}, stock: 1 },
            { variantName: "b", sku: `orph-${s}`, attributes: {}, stock: 1 },
          ],
        }),
        (err) => err.code === "ER_DUP_ENTRY",
      );
      assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM products"))[0].n, before);
      assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM products WHERE name = ?", [`Orphan check ${s}`]))[0].n, 0);
    });

    test("a failed save leaves the previous variants and product fields intact", async () => {
      const { json } = await createViaRoute(shoeBody());
      const product = await Product.findById(json.product._id);
      const originalName = product.name;
      product.name = "Renamed but must roll back";
      const s = sfx();
      // Three new rows whose 2nd and 3rd SKUs collide (case-insensitively) -> the 3rd insert fails
      // AFTER the product UPDATE and the old variants' DELETE already ran inside the transaction.
      product.variants = [
        { ...product.variants[0], sku: `n1-${s}` },
        { ...product.variants[1], sku: `n2-${s}` },
        { ...product.variants[2], sku: `N2-${s}` },
      ];
      await assert.rejects(product.save(), (err) => err.code === "ER_DUP_ENTRY");
      const after = await Product.findById(json.product._id);
      assert.equal(after.name, originalName);
      assert.equal(after.variants.length, 3);
      assert.deepEqual(after.variants.map((v) => v.sku), json.product.variants.map((v) => v.sku));
    });
  });

  describe("edit", () => {
    test("keeps variant ids, attributes and stock; changes only what was edited; deletes removed variants", async () => {
      const { json } = await createViaRoute(shoeBody());
      const original = json.product.variants;
      const edited = [
        { ...original[0], stock: 9 }, // edited stock, same identity
        { ...original[1] },
        // original[2] removed
        { variantName: "Brown / 41", sku: `NEW-${sfx()}`, attributes: { [colorKey]: "brown", [sizeKey]: "41" }, stock: 4 }, // added
      ];
      const res = await productPUT(
        await asAdmin("PUT", `http://test/api/products/${json.product._id}`, { variants: edited }),
        paramsOf(json.product._id),
      );
      assert.equal(res.status, 200, await res.clone().text());

      const rows = await rawQuery("SELECT id, sku, attributes, stock FROM product_variants WHERE product_id = ? ORDER BY position", [json.product._id]);
      assert.equal(rows.length, 3);
      assert.equal(rows[0].id, original[0]._id, "an edited variant keeps its id (carts/orders reference it)");
      assert.equal(rows[0].stock, 9);
      assert.equal(rows[1].id, original[1]._id);
      assert.ok(!rows.some((r) => r.id === original[2]._id), "removed variant is gone");
      assert.deepEqual(JSON.parse(rows[2].attributes), { [colorKey]: "brown", [sizeKey]: "41" });

      const facets = await rawQuery("SELECT attr_key, attr_value FROM product_attributes WHERE product_id = ? AND attr_key = ? ORDER BY attr_value", [json.product._id, sizeKey]);
      assert.deepEqual(facets.map((f) => f.attr_value), ["40", "41"], "facets follow the saved variants");
    });

    test("a client that sends no _id still keeps a variant's identity when its SKU is unchanged", async () => {
      const { json } = await createViaRoute(shoeBody());
      const stripped = json.product.variants.map(({ _id, ...rest }) => rest);
      const res = await productPUT(
        await asAdmin("PUT", `http://test/api/products/${json.product._id}`, { variants: stripped }),
        paramsOf(json.product._id),
      );
      assert.equal(res.status, 200, await res.clone().text());
      const rows = await rawQuery("SELECT id FROM product_variants WHERE product_id = ? ORDER BY position", [json.product._id]);
      assert.deepEqual(rows.map((r) => r.id), json.product.variants.map((v) => v._id));
    });

    test("a metadata-only edit does not touch variants; a variant _id from another product is rejected", async () => {
      const a = (await createViaRoute(shoeBody())).json.product;
      const b = (await createViaRoute(shoeBody())).json.product;
      const rename = await productPUT(
        await asAdmin("PUT", `http://test/api/products/${a._id}`, { name: "Edited name only" }),
        paramsOf(a._id),
      );
      assert.equal(rename.status, 200);
      const rows = await rawQuery("SELECT id FROM product_variants WHERE product_id = ? ORDER BY position", [a._id]);
      assert.deepEqual(rows.map((r) => r.id), a.variants.map((v) => v._id));

      const hijack = await productPUT(
        await asAdmin("PUT", `http://test/api/products/${a._id}`, {
          variants: [{ ...a.variants[0], _id: b.variants[0]._id }],
        }),
        paramsOf(a._id),
      );
      assert.equal(hijack.status, 400);
      assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM product_variants WHERE product_id = ?", [b._id]))[0].n, 3);
    });

    test("an in-cart variant survives an edit (same variantId still resolves and add-to-cart still works)", async () => {
      const { json } = await createViaRoute(shoeBody());
      const [v0] = json.product.variants;
      const before = await cartPOST(
        requestAs({ method: "POST", url: "http://test/api/cart", session: await createTestSession(customer._id), body: { productId: json.product._id, variantId: v0._id, quantity: 1 } }),
      );
      assert.equal(before.status, 200);
      await productPUT(
        await asAdmin("PUT", `http://test/api/products/${json.product._id}`, { basePrice: 7500, variants: json.product.variants.map((v) => ({ ...v })) }),
        paramsOf(json.product._id),
      );
      const cart = await Cart.findByUser(customer._id);
      const line = cart.items.find((i) => String(i.variantId) === v0._id);
      assert.ok(line);
      const product = await Product.findById(json.product._id);
      assert.ok(product.variants.some((v) => v._id === v0._id), "the cart's variant id still exists on the product");
    });
  });

  describe("storefront visibility", () => {
    test("a valid, active, in-stock shoe in a NEW (non-seeded) department shows in shop, department, style, search and facet filters", async () => {
      const { json } = await createViaRoute(shoeBody({ name: `Visible Shoe ${sfx()}` }));
      const name = json.product.name;
      scope.resetStorefrontScopeCache();

      // The exact former exclusion: this department's slug is not in the old
      // hard-coded allowlist, so `top_category_id IN (allowlisted ids)` could
      // never match it.
      const { STOREFRONT_DEPARTMENT_SLUGS } = await import("../lib/storefrontDepartments.js");
      assert.ok(!STOREFRONT_DEPARTMENT_SLUGS.includes(shoes.slug));

      assert.ok((await listNames({ limit: "100" })).includes(name), "main shop listing");
      assert.ok((await listNames({ category: String(shoes._id) })).includes(name), "department filter");
      assert.ok((await listNames({ category: String(shoes._id), style: String(sneakers._id) })).includes(name), "style filter");
      assert.ok((await listNames({ search: name })).includes(name), "search");
      assert.ok((await listNames({ [colorKey]: "brown" })).includes(name), "color facet");
      assert.ok((await listNames({ [sizeKey]: "41" })).includes(name), "size facet");
      assert.ok((await listNames({ [colorKey]: "black", [sizeKey]: "40" })).includes(name), "color + size facets together");
      assert.ok(!(await listNames({ [sizeKey]: "42" })).includes(name), "a size it doesn't have must not match");
      assert.ok((await listNames({ priceMin: "6000", priceMax: "8000" })).includes(name), "price range");

      const detail = await svc.getProductByIdOrSlug(json.product.slug);
      assert.equal(detail.name, name, "product-details route");
    });

    test("the old allowlist behaviour is gone: visibility follows data (is_active), not a slug list", async () => {
      const s = sfx();
      const hiddenDept = await Category.create({ name: "Hidden dept", slug: `hidden-${s}`, isActive: false });
      const hiddenLeaf = await Category.create({ name: "Hidden leaf", slug: `hidden-leaf-${s}`, parent: hiddenDept._id });
      madeCategories.push(hiddenLeaf._id, hiddenDept._id);
      scope.resetStorefrontScopeCache();
      const { res, json } = await createViaRoute(shoeBody({ name: `Under inactive dept ${s}`, category: String(hiddenLeaf._id), variants: [{ variantName: "One", sku: `HID-${s}`, attributes: {}, stock: 1 }] }));
      assert.equal(res.status, 201, JSON.stringify(json));
      assert.ok(!(await listNames({ search: s })).length, "product under an inactive department is hidden");
      // ...but the admin still sees it (admin scope is unfiltered).
      assert.ok((await listNames({ search: s }, { isAdmin: true })).length === 1);

      // Reactivating the department (through the service, as the admin UI does) makes it appear at once.
      const { updateCategory } = await import("../services/categoryService.js");
      await updateCategory(String(hiddenDept._id), { isActive: true });
      assert.equal((await listNames({ search: s })).length, 1, "visible right after activation, no restart/TTL wait");
    });

    test("a category change made by ANOTHER process/bundle (no in-process reset call) is seen on the very next read", async () => {
      // In a production build the categories API route and the /shop page render run in
      // separate bundles, each with its own copy of the visible-set memo, so resetting one
      // never reset the other. The memo is therefore validated against the table itself.
      const s = sfx();
      const dept = await Category.create({ name: "Late dept", slug: `late-${s}`, isActive: false });
      const leaf = await Category.create({ name: "Late leaf", slug: `late-leaf-${s}`, parent: dept._id });
      madeCategories.push(leaf._id, dept._id);
      scope.resetStorefrontScopeCache();
      const { res } = await createViaRoute(shoeBody({ name: `Late shoe ${s}`, category: String(leaf._id), variants: [{ variantName: "One", sku: `LATE-${s}`, attributes: {}, stock: 1 }] }));
      assert.equal(res.status, 201);
      assert.equal((await listNames({ search: s })).length, 0, "hidden while its department is inactive (memo now warm)");

      await rawQuery("UPDATE categories SET is_active = 1 WHERE id = ?", [String(dept._id)]); // no resetStorefrontScopeCache()
      assert.equal((await listNames({ search: s })).length, 1, "visible on the next read, without waiting for any TTL");

      await rawQuery("UPDATE categories SET is_active = 0 WHERE id = ?", [String(dept._id)]);
      assert.equal((await listNames({ search: s })).length, 0, "and hidden again just as promptly");
    });

    test("an inactive product, or one under an inactive style, is hidden; a sold-out product is still listed", async () => {
      const s = sfx();
      const inactive = await createViaRoute(shoeBody({ name: `Inactive ${s}`, isActive: false }));
      assert.equal(inactive.res.status, 201);
      assert.ok(!(await listNames({ search: s })).length);

      const deadStyle = await Category.create({ name: "Dead style", slug: `dead-${s}`, parent: shoes._id, isActive: false });
      madeCategories.push(deadStyle._id);
      scope.resetStorefrontScopeCache();
      const inDeadStyle = await createViaRoute(shoeBody({ name: `Dead style item ${s}`, category: String(deadStyle._id) }));
      assert.equal(inDeadStyle.res.status, 201);
      assert.ok(!(await listNames({ search: s })).length, "a deactivated style hides its products even though the department is active");

      const body = shoeBody({ name: `Sold out ${s}` });
      body.variants.forEach((v) => (v.stock = 0));
      const soldOut = await createViaRoute(body);
      assert.equal(soldOut.res.status, 201);
      // Deliberate policy: sold-out products stay listed (the PDP shows the
      // "out of stock" state) rather than silently vanishing from the shop.
      assert.equal((await listNames({ search: s })).length, 1);
    });
  });

  describe("delete", () => {
    test("removes the product from every list, keeps a full snapshot in deleted_products, and clears carts", async () => {
      const { json } = await createViaRoute(shoeBody());
      const p = json.product;
      await cartPOST(requestAs({ method: "POST", url: "http://test/api/cart", session: await createTestSession(customer._id), body: { productId: p._id, variantId: p.variants[0]._id, quantity: 1 } }));

      const res = await productDELETE(await asAdmin("DELETE", `http://test/api/products/${p._id}`), paramsOf(p._id));
      assert.equal(res.status, 200);

      assert.ok(!(await listNames({ search: p.name.split(" ").pop() }, { isAdmin: true })).includes(p.name), "gone from the ADMIN list too");
      assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM products WHERE id = ?", [p._id]))[0].n, 0);
      assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM product_variants WHERE product_id = ?", [p._id]))[0].n, 0);
      assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM cart_items WHERE product_id = ?", [p._id]))[0].n, 0);

      const [log] = await rawQuery("SELECT * FROM deleted_products WHERE product_id = ?", [p._id]);
      assert.equal(log.name, p.name);
      assert.equal(log.deleted_by, String(admin._id));
      const snap = JSON.parse(log.snapshot);
      assert.equal(snap.variants.length, 3);
      assert.deepEqual(snap.variants.map((v) => v.sku), p.variants.map((v) => v.sku));
      assert.equal(snap.basePrice, 7000);
      await rawQuery("DELETE FROM deleted_products WHERE product_id = ?", [p._id]);

      const again = await productDELETE(await asAdmin("DELETE", `http://test/api/products/${p._id}`), paramsOf(p._id));
      assert.equal(again.status, 404);
    });
  });

  describe("product details and cart use the selected variant", () => {
    test("each variant resolves to its own id/sku/attributes; the cart stores that snapshot and enforces that variant's stock", async () => {
      const { getVariantAxes, resolveVariant, getAxisOptions } = await import("../lib/utils.js");
      const { json } = await createViaRoute(shoeBody());
      const detail = await svc.getProductByIdOrSlug(json.product.slug);
      const axes = getVariantAxes(detail.variants, [colorKey, sizeKey]);
      assert.deepEqual(axes, [colorKey, sizeKey]);
      assert.deepEqual(getAxisOptions(detail.variants, colorKey).map((o) => o.value).sort(), ["black", "brown"]);

      for (const v of detail.variants) {
        const picked = resolveVariant(detail.variants, v.attributes, axes);
        assert.equal(picked._id, v._id, `selection ${JSON.stringify(v.attributes)} must resolve to that exact variant`);
      }

      const chosen = resolveVariant(detail.variants, { [colorKey]: "brown", [sizeKey]: "40" }, axes); // stock 2
      const session = await createTestSession(customer._id);
      const add = await cartPOST(requestAs({ method: "POST", url: "http://test/api/cart", session, body: { productId: detail._id, variantId: chosen._id, quantity: 2 } }));
      assert.equal(add.status, 200, await add.clone().text());
      const { cart } = await add.json().then((j) => ({ cart: j.cart ?? j }));
      const line = cart.items.find((i) => i.variantId === chosen._id);
      assert.ok(line, "the cart line is keyed by the selected variant id");
      assert.equal(line.quantity, 2);
      assert.equal(line.variant.sku, chosen.sku);
      assert.deepEqual(line.variant.attributes, { [colorKey]: "brown", [sizeKey]: "40" });
      assert.equal(line.variant.price, null, "no variant price override -> the product's base price applies");
      assert.equal(line.product.basePrice, 7000);

      const tooMany = await cartPOST(requestAs({ method: "POST", url: "http://test/api/cart", session, body: { productId: detail._id, variantId: chosen._id, quantity: 1 } }));
      assert.equal(tooMany.status, 400, "stock is enforced per variant (2 in stock, 3rd unit refused)");
      assert.match(await tooMany.text(), /Only 2 in stock/);
    });

    test("a variant price override is what the cart snapshot records", async () => {
      const body = shoeBody();
      body.variants[0].price = 6500;
      const { json } = await createViaRoute(body);
      const v = json.product.variants[0];
      const add = await cartPOST(requestAs({ method: "POST", url: "http://test/api/cart", session: await createTestSession(customer._id), body: { productId: json.product._id, variantId: v._id, quantity: 1 } }));
      assert.equal(add.status, 200);
      const payload = await add.json();
      const cart = payload.cart ?? payload;
      assert.equal(cart.items.find((i) => i.variantId === v._id).variant.price, 6500);
    });
  });
});
