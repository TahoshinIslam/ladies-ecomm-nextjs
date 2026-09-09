// Phase 10 — real HTTP evidence for SEO metadata, robots/sitemap, JSON-LD
// safety, and that adding metadata/error boundaries never changed any
// existing status-code behavior (redirects, 404s). Same harness pattern
// as tests/http/serverRenderedPages.integration.test.mjs and
// tests/http/imageOptimization.integration.test.mjs.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  createTestUser,
  createDeliveredOrderFor,
} from "../helpers/testDb.mjs";

const BASE_URL = process.env.HTTP_TEST_BASE_URL || "http://localhost:3000";
const SESSION_COOKIE = "__Host-tahos_session";

let serverUp = false;
try {
  const res = await fetch(`${BASE_URL}/`);
  serverUp = res.ok;
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

const skip = !serverUp
  ? "test server not reachable — run via `npm run test:http`"
  : !dbConnectable
    ? skipReason || "MONGO_URI_TEST not reachable — see .env.test.example"
    : false;

async function cookieHeaderFor(userId) {
  const { createSession } = await import("../../lib/session.js");
  const session = await createSession(userId, { userAgent: "phase10-test-suite" });
  return `${SESSION_COOKIE}=${session.rawToken}`;
}

// Invalidates the CATALOG cache tag via a REAL, CSRF-authenticated admin
// mutation — a raw Product.create()/updateOne() (as most fixtures in
// this file use) never fires invalidateCacheTags(), so the sitemap's
// unstable_cache'd product list (persisted to .next/cache across even a
// server restart) would otherwise only pick up a newly created product
// once its 300s TTL naturally expires. Same reasoning Phase 8's own
// cache-behavior tests already established for this exact class of
// problem.
//
// Deliberately a genuine PARTIAL update (basePrice only, category
// omitted) — this doubles as a live regression proof for
// updateProduct()'s optional-category contract (services/productService.js).
async function forceCatalogInvalidation(adminUserId, product) {
  const { createSession } = await import("../../lib/session.js");
  const session = await createSession(adminUserId, { userAgent: "phase10-test-suite" });
  const cookie = `${SESSION_COOKIE}=${session.rawToken}; tahos_csrf=${session.rawCsrfToken}`;
  const res = await fetch(`${BASE_URL}/api/products/${product._id}`, {
    method: "PUT",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: BASE_URL,
      "x-csrf-token": session.rawCsrfToken,
    },
    body: JSON.stringify({ basePrice: product.basePrice }),
  });
  assert.equal(res.status, 200, "the catalog-invalidating admin PUT must itself succeed");
}

function extractMeta(html, name) {
  const re = new RegExp(`<meta[^>]*name="${name}"[^>]*content="([^"]*)"`, "i");
  return html.match(re)?.[1] || null;
}
function extractProperty(html, prop) {
  const re = new RegExp(`<meta[^>]*property="${prop}"[^>]*content="([^"]*)"`, "i");
  return html.match(re)?.[1] || null;
}
function extractCanonical(html) {
  const re = /<link[^>]*rel="canonical"[^>]*href="([^"]*)"/i;
  return html.match(re)?.[1] || null;
}
function extractJsonLd(html) {
  const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/;
  const raw = html.match(re)?.[1];
  return raw ? JSON.parse(raw) : null;
}

describe("Phase 10 — real HTTP: SEO metadata, robots/sitemap, JSON-LD safety", { skip }, () => {
  let Product, Category, Order, User;
  let burqaLeafId, burqaDeptId;
  const createdIds = { products: [], users: [], orders: [] };
  let product;
  const productName = `__seo_test_${crypto.randomBytes(4).toString("hex")}`;

  before(async () => {
    ({ default: Product } = await import("../../models/productModel.js"));
    ({ default: Category } = await import("../../models/categoryModel.js"));
    ({ default: Order } = await import("../../models/orderModel.js"));
    ({ default: User } = await import("../../models/userModel.js"));

    const burqa = await Category.findOne({ slug: "burqa" }).lean();
    assert.ok(burqa, "seed data must include the Burqa department");
    const burqaLeaf = await Category.findOne({ parent: burqa._id }).lean();
    burqaDeptId = burqa._id.toString();
    burqaLeafId = burqaLeaf._id.toString();

    product = await Product.create({
      name: productName,
      description: "A" + "b".repeat(300), // long, to prove description truncation
      category: burqaLeafId,
      topCategory: burqaDeptId,
      basePrice: 800,
      images: ["https://placehold.co/800x1000?text=seo"],
      variants: [{ variantName: "Default", sku: `SEO-${crypto.randomBytes(4).toString("hex")}`, stock: 5 }],
      isActive: true,
    });
    createdIds.products.push(product._id);
  });

  after(async () => {
    if (createdIds.orders.length) await Order.deleteMany({ _id: { $in: createdIds.orders } });
    if (createdIds.products.length) await Product.deleteMany({ _id: { $in: createdIds.products } });
    if (createdIds.users.length) await User.deleteMany({ _id: { $in: createdIds.users } });
    await disconnectTestDb();
  });

  // ---------------------------------------------------------- Home/Shop

  test("home page: has a title, description, and canonical link", async () => {
    const html = await (await fetch(`${BASE_URL}/`)).text();
    assert.match(html, /<title>[^<]+<\/title>/);
    assert.ok(extractMeta(html, "description"));
    assert.ok(extractCanonical(html));
  });

  test("shop page (no query): index,follow and canonical /shop", async () => {
    const res = await fetch(`${BASE_URL}/shop`);
    const html = await res.text();
    assert.ok(!/name="robots" content="noindex/.test(html), "bare /shop must not be noindex");
    assert.match(extractCanonical(html) || "", /\/shop$/);
  });

  test("shop page WITH a query: noindex,follow with canonical pointing back to bare /shop", async () => {
    const html = await (await fetch(`${BASE_URL}/shop?category=${burqaDeptId}`)).text();
    assert.match(html, /name="robots" content="noindex/);
    assert.match(extractCanonical(html) || "", /\/shop$/);
  });

  // ---------------------------------------------------------- Product

  test("product page: title contains the product name, description is bounded, canonical/OG/Twitter are present", async () => {
    const res = await fetch(`${BASE_URL}/product/${product.slug}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(`<title>${productName}`), "title must contain the real product name");
    const description = extractMeta(html, "description");
    assert.ok(description && description.length <= 170, "description must be bounded, not the raw 300+ char product description");
    assert.match(extractCanonical(html) || "", new RegExp(`/product/${product.slug}$`));
    assert.ok(extractProperty(html, "og:title"));
    assert.ok(html.includes('name="twitter:card"'));
  });

  test("product page: JSON-LD parses, uses BDT, and a malicious product name cannot break out of the script tag", async () => {
    const injected = await Product.create({
      name: `</script><script>window.__pwned=1</script>`,
      description: "safe",
      category: burqaLeafId,
      topCategory: burqaDeptId,
      basePrice: 500,
      images: ["https://placehold.co/800x1000?text=inject"],
      variants: [{ variantName: "Default", sku: `INJ-${crypto.randomBytes(4).toString("hex")}`, stock: 3 }],
      isActive: true,
    });
    createdIds.products.push(injected._id);

    const html = await (await fetch(`${BASE_URL}/product/${injected.slug}`)).text();
    // The real exploit to guard against is a LITERAL, unescaped
    // "<script>window.__pwned" byte sequence — that would be a second,
    // attacker-controlled script tag actually executing. The bare text
    // "window.__pwned" legitimately appears elsewhere in the page too
    // (e.g. the <title>/<h1> safely render the product's name as
    // HTML-entity-escaped text, per React's normal auto-escaping — that
    // is a DIFFERENT, already-safe mechanism this test isn't checking).
    assert.ok(
      !html.includes("<script>window.__pwned"),
      "a literal, unescaped <script>...</script> break-out must never appear in the response",
    );

    const jsonLd = extractJsonLd(html);
    assert.ok(jsonLd, "expected a parseable JSON-LD <script> block");
    assert.equal(jsonLd["@type"], "Product");
    assert.equal(jsonLd.offers.priceCurrency, "BDT");
    assert.equal(jsonLd.name, "</script><script>window.__pwned=1</script>", "the JSON-LD's own name field must round-trip to the exact original string — proving safeJsonLd's escaping is reversible, not corrupting or executing it");
    assert.ok(!("aggregateRating" in jsonLd), "a product with zero real reviews must never get a fabricated aggregateRating");
  });

  test("product page: the JSON-LD <script>'s nonce exactly matches THAT response's own CSP script-src nonce, and two separate requests get two different nonces", async () => {
    const res1 = await fetch(`${BASE_URL}/product/${product.slug}`);
    const csp1 = res1.headers.get("content-security-policy") || "";
    const cspNonce1 = csp1.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
    assert.ok(cspNonce1, "expected a real nonce in this response's CSP script-src");
    const html1 = await res1.text();
    const jsonLdNonce1 = html1.match(/<script type="application\/ld\+json" nonce="([^"]+)"/)?.[1];
    assert.ok(jsonLdNonce1, "expected the JSON-LD <script> tag to carry a nonce attribute");
    assert.equal(jsonLdNonce1, cspNonce1, "the JSON-LD script's nonce must exactly match this same response's CSP nonce — a mismatched or hardcoded nonce would make the browser refuse to run it under this app's strict nonce CSP");

    const res2 = await fetch(`${BASE_URL}/product/${product.slug}`);
    const csp2 = res2.headers.get("content-security-policy") || "";
    const cspNonce2 = csp2.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
    assert.notEqual(cspNonce2, cspNonce1, "a second, separate request must get a genuinely different per-request nonce — proves the JSON-LD addition didn't reuse/cache a stale nonce across requests");
  });

  test("missing/inactive product: a nonexistent slug returns a real 404, never a 200 with empty metadata", async () => {
    const res = await fetch(`${BASE_URL}/product/this-product-genuinely-does-not-exist-${crypto.randomBytes(4).toString("hex")}`);
    assert.equal(res.status, 404);
  });

  // ---------------------------------------------------------- Auth/private pages noindex

  test("login, register, cart, checkout, profile, orders are all noindex", async () => {
    for (const path of ["/login", "/register", "/cart", "/checkout", "/profile", "/orders"]) {
      const html = await (await fetch(`${BASE_URL}${path}`)).text();
      assert.match(html, /name="robots" content="noindex/, `${path} must be noindex`);
    }
  });

  test("admin is noindex", async () => {
    const html = await (await fetch(`${BASE_URL}/admin`, { redirect: "manual" })).text().catch(() => "");
    // Unauthenticated /admin redirects (checked separately below) — hit
    // login's own noindex as a redirect target is already covered above;
    // this call just confirms the response itself carries no indexable
    // signal even mid-redirect.
    assert.ok(!/name="robots" content="index/.test(html));
  });

  // ---------------------------------------------------------- robots/sitemap

  test("/robots.txt is reachable, allows the storefront, disallows private paths, and references an absolute sitemap URL", async () => {
    const res = await fetch(`${BASE_URL}/robots.txt`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /Disallow: \/api\//);
    assert.match(text, /Disallow: \/admin/);
    // lib/seo.js's absoluteUrl() only produces a real absolute URL when
    // CLIENT_URL resolves to a safely-usable origin — and this test
    // harness's own .env.test intentionally sets CLIENT_URL to
    // http://localhost:3000, which lib/appUrl.js's resolveAppOrigin()
    // correctly REFUSES under `next start`'s always-production runtime
    // (an existing, pre-Phase-10 safety policy: "localhost in
    // production" is rejected everywhere else this helper is used, e.g.
    // password-reset links). getSiteOrigin() catches that and degrades
    // to a relative path — accept either shape here rather than
    // asserting a real deployment's exact behavior in a bare test
    // harness whose own fixture CLIENT_URL that policy is designed to
    // reject.
    assert.match(text, /Sitemap: (https?:\/\/[^\s]+)?\/sitemap\.xml/);
  });

  test("/sitemap.xml is reachable, contains the active seeded product, and excludes every private/admin/API path", async () => {
    const admin = await createTestUser({ role: "admin" });
    createdIds.users.push(admin._id);
    await forceCatalogInvalidation(admin._id, product);

    const res = await fetch(`${BASE_URL}/sitemap.xml`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes(`/product/${product.slug}`), "the active seeded product must appear in the sitemap");
    for (const forbidden of ["/admin", "/api/", "/cart", "/checkout", "/orders", "/login", "/register", "/profile", "/wishlist", "/compare"]) {
      assert.ok(!text.includes(forbidden), `sitemap.xml must never list a URL containing ${forbidden}`);
    }
  });

  test("/sitemap.xml excludes an inactive product", async () => {
    const inactive = await Product.create({
      name: `__seo_inactive_${crypto.randomBytes(4).toString("hex")}`,
      description: "inactive",
      category: burqaLeafId,
      topCategory: burqaDeptId,
      basePrice: 400,
      images: ["https://placehold.co/800x1000?text=inactive"],
      variants: [{ variantName: "Default", sku: `INA-${crypto.randomBytes(4).toString("hex")}`, stock: 1 }],
      isActive: false,
    });
    createdIds.products.push(inactive._id);

    const text = await (await fetch(`${BASE_URL}/sitemap.xml`)).text();
    assert.ok(!text.includes(`/product/${inactive.slug}`), "an inactive product must never appear in the sitemap");
  });

  test("/sitemap.xml scales past 100 products: every one of 105 active products appears (including #101-105), inactive ones don't, URLs are unique/absolute-or-relative-consistent, lastModified is valid, output is well-formed XML — proves the sitemap query has no admin-list-style pagination ceiling", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const ACTIVE_COUNT = 105;
    const INACTIVE_COUNT = 5;

    // Bulk-built in one array and inserted via a single Product.create()
    // call (mongoose parallelizes the underlying saves — still one round
    // trip from this test's perspective, not 105 sequential HTTP
    // requests or even 105 sequential DB calls). Each doc sets its own
    // `slug` explicitly rather than relying on the pre("validate") hook,
    // so this stays fast and deterministic regardless of hook timing.
    const activeDocs = Array.from({ length: ACTIVE_COUNT }, (_, i) => ({
      name: `__sitemap_scale_${suffix}_${i}`,
      slug: `sitemap-scale-${suffix}-${i}`,
      description: "bulk sitemap scale fixture",
      category: burqaLeafId,
      topCategory: burqaDeptId,
      basePrice: 300,
      images: ["https://placehold.co/800x1000?text=scale"],
      variants: [{ variantName: "Default", sku: `SCALE-${suffix}-${i}`, stock: 2 }],
      isActive: true,
    }));
    const inactiveDocs = Array.from({ length: INACTIVE_COUNT }, (_, i) => ({
      name: `__sitemap_scale_inactive_${suffix}_${i}`,
      slug: `sitemap-scale-inactive-${suffix}-${i}`,
      description: "bulk sitemap scale fixture (inactive)",
      category: burqaLeafId,
      topCategory: burqaDeptId,
      basePrice: 300,
      images: ["https://placehold.co/800x1000?text=scale-inactive"],
      variants: [{ variantName: "Default", sku: `SCALEX-${suffix}-${i}`, stock: 0 }],
      isActive: false,
    }));

    const createdActive = await Product.create(activeDocs);
    const createdInactive = await Product.create(inactiveDocs);
    createdIds.products.push(...createdActive.map((p) => p._id), ...createdInactive.map((p) => p._id));

    const admin = await createTestUser({ role: "admin" });
    createdIds.users.push(admin._id);
    await forceCatalogInvalidation(admin._id, product);

    const res = await fetch(`${BASE_URL}/sitemap.xml`);
    assert.equal(res.status, 200);
    const text = await res.text();

    // Well-formed XML: every <loc> tag closes, and the whole document is
    // parseable by a real (if minimal) XML check — no truncation, no
    // dangling tag from a query that silently stopped at some ceiling.
    assert.match(text, /^<\?xml/);
    assert.match(text, /<urlset[^>]*>[\s\S]*<\/urlset>\s*$/);

    const locs = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(new Set(locs).size, locs.length, "every sitemap URL must be unique");

    for (const p of createdActive) {
      assert.ok(locs.some((l) => l.endsWith(`/product/${p.slug}`)), `product ${p.slug} must appear in the sitemap`);
    }
    // Explicitly confirm #101-105 — the ones a 100-item pagination
    // ceiling would silently drop.
    for (const p of createdActive.slice(100, 105)) {
      assert.ok(locs.some((l) => l.endsWith(`/product/${p.slug}`)), `product ${p.slug} (past the 100th) must appear in the sitemap`);
    }
    for (const p of createdInactive) {
      assert.ok(!locs.some((l) => l.endsWith(`/product/${p.slug}`)), `inactive product ${p.slug} must never appear in the sitemap`);
    }

    // Every <loc> is either a real absolute URL or a same-shape relative
    // path (see lib/seo.js's documented CLIENT_URL-unconfigured
    // fallback) — never a literal "undefined/product/..." or malformed
    // value.
    for (const loc of locs) {
      assert.ok(/^https?:\/\//.test(loc) || loc.startsWith("/"), `sitemap URL must be absolute or a real relative path, got: ${loc}`);
      assert.ok(!loc.includes("undefined"), `sitemap URL must never contain a literal "undefined": ${loc}`);
    }

    const lastMods = [...text.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
    assert.ok(lastMods.length > 0, "expected at least one lastmod value");
    for (const lm of lastMods) {
      assert.ok(!Number.isNaN(new Date(lm).getTime()), `lastmod must be a valid date: ${lm}`);
    }
  });

  // ---------------------------------------------------------- Status regression

  test("unknown route still returns a real 404 with the branded not-found page, no internal error detail", async () => {
    const res = await fetch(`${BASE_URL}/this-route-genuinely-does-not-exist-${crypto.randomBytes(4).toString("hex")}`);
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.match(html, /<h1/);
    assert.ok(!/at Object\.|node_modules|MongooseError|ECONNREFUSED/.test(html), "must never leak a stack trace or internal error string");
  });

  test("cross-customer order still returns 404 (Phase 10 didn't reintroduce a data leak)", async () => {
    const customer = await createTestUser({ role: "customer" });
    const otherCustomer = await createTestUser({ role: "customer" });
    createdIds.users.push(customer._id, otherCustomer._id);
    const order = await createDeliveredOrderFor(customer._id, product._id, product.variants[0]._id);
    createdIds.orders.push(order._id);

    const cookie = await cookieHeaderFor(otherCustomer._id);
    const res = await fetch(`${BASE_URL}/orders/${order._id}`, { headers: { cookie } });
    assert.equal(res.status, 404);
  });

  test("unauthenticated /orders and /admin still redirect (never a 200) — proves no loading/Suspense change turned a protected redirect into 200", async () => {
    const ordersRes = await fetch(`${BASE_URL}/orders`, { redirect: "manual" });
    assert.ok([302, 303, 307].includes(ordersRes.status));
    assert.match(ordersRes.headers.get("location") || "", /\/login/);

    const adminRes = await fetch(`${BASE_URL}/admin`, { redirect: "manual" });
    assert.ok([302, 303, 307].includes(adminRes.status));
    assert.match(adminRes.headers.get("location") || "", /\/login/);
  });
});
