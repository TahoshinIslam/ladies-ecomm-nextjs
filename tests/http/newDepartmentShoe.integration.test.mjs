// A shoe created in a brand-new, admin-made "Shoes" department must show up on
// the storefront — proven over real HTTP against the actual `next start`
// process and its real Data Cache (the regression: a hard-coded department slug
// allowlist hid every product in an admin-created department, and the
// Attributes admin form couldn't save, so Color/Size were never assignable).
// Everything goes through the same admin routes the UI calls.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestUser, deleteRows, rawQuery } from "../helpers/testDb.mjs";

const BASE_URL = process.env.HTTP_TEST_BASE_URL || "http://localhost:3000";

let serverUp = false;
try {
  const res = await fetch(`${BASE_URL}/api/settings/public`);
  serverUp = res.ok || res.status < 500;
} catch {
  serverUp = false;
}
let dbConnectable = false;
if (serverUp && dbReady) {
  try {
    await connectTestDb();
    dbConnectable = true;
  } catch {
    dbConnectable = false;
  }
}
const skip = !serverUp ? "test server not reachable — run via `npm run test:http`" : !dbConnectable ? skipReason || "test DB not reachable" : false;

class Jar {
  constructor() { this.cookies = new Map(); }
  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
}
async function http(jar, path, { method = "GET", body } = {}) {
  const headers = new Headers();
  if (jar) {
    headers.set("cookie", jar.header());
    if (method !== "GET") headers.set("x-csrf-token", jar.cookies.get("tahos_csrf") ?? "");
  }
  if (body !== undefined) headers.set("content-type", "application/json");
  if (method !== "GET") headers.set("origin", BASE_URL);
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  jar?.absorb(res);
  return res;
}

describe("new admin-created department + shoe (real server, real cache)", { skip }, () => {
  let admin, jar;
  const productIds = [];
  const categoryIds = [];
  const defIds = [];
  const suffix = crypto.randomBytes(4).toString("hex");
  let deptId, leafId, colorKey, sizeKey;

  const post = async (path, body, expected = 201) => {
    const res = await http(jar, path, { method: "POST", body });
    assert.equal(res.status, expected, `${path}: ${await res.clone().text()}`);
    return res.json();
  };
  const shoeBody = (name, sku, attrs = {}) => ({
    name,
    description: "A shoe created through the admin API in a new department.",
    category: leafId,
    basePrice: 7000,
    images: ["https://placehold.co/400x400.png?text=shoe"],
    variants: [
      { variantName: "Black / 40", sku, attributes: { [colorKey]: "black", [sizeKey]: "40", ...attrs }, stock: 5 },
      { variantName: "Black / 41", sku: `${sku}-41`, attributes: { [colorKey]: "black", [sizeKey]: "41" }, stock: 2 },
    ],
  });
  const shopHtml = async (qs) => (await fetch(`${BASE_URL}/shop?${qs}`)).text();
  const apiNames = async (qs) => {
    const res = await fetch(`${BASE_URL}/api/products?${qs}`);
    const json = await res.json();
    assert.equal(res.status, 200, `GET /api/products?${qs} -> ${JSON.stringify(json)}`);
    return json.products.map((p) => p.name);
  };

  before(async () => {
    admin = await createTestUser({ role: "admin" });
    jar = new Jar();
    const login = await http(jar, "/api/users/login", { method: "POST", body: { email: admin.email, password: "TestPassword123!" } });
    assert.equal(login.status, 200, "fixture admin login");

    // The admin does exactly what the UI does: create the department and a style...
    const dept = (await post("/api/categories", { name: "Shoes", isActive: true })).category;
    deptId = dept._id;
    categoryIds.push(deptId);
    const leaf = (await post("/api/categories", { name: "Sneakers", parent: deptId, isActive: true })).category;
    leafId = leaf._id;
    categoryIds.push(leafId);

    // ...then gives it Color and Size, with the body the Attributes form sends.
    colorKey = `color${suffix}`;
    sizeKey = `shoesize${suffix}`;
    const attrBody = (key, label, type, options) => ({
      key, label, labelBn: "", type, options, appliesToCategories: [deptId], filterable: true, required: false, derivedFromVariant: true, sortOrder: 0,
    });
    for (const body of [
      attrBody(colorKey, "Color", "swatch", [{ value: "black", label: "Black", labelBn: "", swatchHex: "#111111" }]),
      attrBody(sizeKey, "Size", "select", ["40", "41", "42"].map((v) => ({ value: v, label: v, labelBn: "", swatchHex: "" }))),
    ]) defIds.push((await post("/api/attributes", body)).attribute._id);
  });

  after(async () => {
    try {
      await deleteRows("products", "id", productIds);
      await deleteRows("attribute_definitions", "id", defIds);
      await deleteRows("categories", "id", categoryIds);
      await deleteRows("users", "id", admin._id);
    } finally {
      await disconnectTestDb();
    }
  });

  test("the product form's attribute request for the new department returns Color and Size straight after they were created", async () => {
    const { attributes } = await (await http(jar, `/api/attributes?category=${deptId}`)).json();
    const byKey = new Map(attributes.map((a) => [a.key, a]));
    assert.equal(byKey.get(colorKey)?.derivedFromVariant, true);
    assert.deepEqual(byKey.get(sizeKey)?.options.map((o) => o.value), ["40", "41", "42"]);
  });

  test("the first shoe appears in shop, department page, search and its product page", async () => {
    const name = `Nike Test ${suffix}`;
    const { product } = await post("/api/products", shoeBody(name, `SHOE-${suffix}-A`));
    productIds.push(product._id);

    // A non-fashion department's own URL is the style-landing page (tiles of its styles);
    // the product grid is the style URL — the same links the mega-menu renders.
    assert.ok((await shopHtml(`category=${deptId}`)).includes("Sneakers"), "department landing lists its style");
    assert.ok((await shopHtml(`category=${deptId}&style=${leafId}`)).includes(name), "style (category) page");
    assert.ok((await apiNames("limit=100&sort=-createdAt")).includes(name), "main shop listing");
    assert.ok((await apiNames(`category=${deptId}&style=${leafId}`)).includes(name), "style filter");
    assert.ok((await apiNames(`search=${suffix}`)).includes(name), "search");
    assert.ok((await apiNames(`${colorKey}=black&${sizeKey}=41`)).includes(name), "color + size facets");
    assert.ok(!(await apiNames(`${sizeKey}=42`)).includes(name), "a size it lacks must not match");
    const detail = await fetch(`${BASE_URL}/product/${product.slug}`);
    assert.equal(detail.status, 200);
    assert.ok((await detail.text()).includes(name));
  });

  test("a second shoe shows up right after creation even though the department listing was already cached (no manual cache clearing)", async () => {
    await shopHtml(`category=${deptId}&style=${leafId}`);
    await apiNames(`category=${deptId}`); // both reads are now warm

    const name = `Adidas Test ${suffix}`;
    const { product } = await post("/api/products", shoeBody(name, `SHOE-${suffix}-B`));
    productIds.push(product._id);

    assert.ok((await shopHtml(`category=${deptId}&style=${leafId}`)).includes(name), "cached HTML listing must be refreshed by the create");
    assert.ok((await apiNames(`category=${deptId}`)).includes(name), "cached API listing must be refreshed by the create");
  });

  test("editing keeps the variant ids; a duplicate SKU is refused with a clear message and changes nothing", async () => {
    const { product } = await post("/api/products", shoeBody(`Edit Test ${suffix}`, `SHOE-${suffix}-C`));
    productIds.push(product._id);
    const ok = await http(jar, `/api/products/${product._id}`, { method: "PUT", body: { variants: product.variants.map((v) => ({ ...v, stock: v.stock + 1 })) } });
    assert.equal(ok.status, 200, await ok.clone().text());
    const rows = await rawQuery("SELECT id, stock FROM product_variants WHERE product_id = ? ORDER BY position", [product._id]);
    assert.deepEqual(rows.map((r) => r.id), product.variants.map((v) => v._id));

    const dup = await http(jar, "/api/products", { method: "POST", body: shoeBody(`Dup ${suffix}`, `SHOE-${suffix}-C`) });
    assert.equal(dup.status, 400);
    assert.match(await dup.text(), /already used/i);
    assert.equal((await rawQuery("SELECT COUNT(*) AS n FROM products WHERE name = ?", [`Dup ${suffix}`]))[0].n, 0, "no half-created product");
  });
});
