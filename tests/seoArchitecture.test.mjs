// Phase 10 — static SEO/metadata architecture checks. Same house style
// as tests/imageOptimization.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const abs = (...parts) => path.join(ROOT, ...parts);
const read = (relPath) => fs.readFileSync(abs(relPath), "utf8");
const exists = (relPath) => fs.existsSync(abs(relPath));

function stripComments(content) {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("Phase 10 checkpoint — canonical-origin failure-mode behavior (lib/seo.js)", () => {
  const ORIGINAL_ENV = { CLIENT_URL: process.env.CLIENT_URL, NODE_ENV: process.env.NODE_ENV };
  const restoreEnv = () => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  async function withEnv(env, fn) {
    Object.assign(process.env, env);
    try {
      // Fresh import per case isn't required — getSiteOrigin() re-reads
      // process.env on every call (no module-load-time caching) — but a
      // dynamic import with a cache-busting query keeps this test
      // independent of that implementation detail.
      const mod = await import(`../lib/seo.js?t=${Date.now()}-${Math.random()}`);
      return await fn(mod);
    } finally {
      restoreEnv();
    }
  }

  test("valid HTTPS production origin resolves to the exact origin, trailing slash stripped", () =>
    withEnv({ NODE_ENV: "production", CLIENT_URL: "https://tahos.store/" }, ({ getSiteOrigin, absoluteUrl }) => {
      assert.equal(getSiteOrigin(), "https://tahos.store");
      assert.equal(absoluteUrl("/product/abc"), "https://tahos.store/product/abc");
    }));

  test("missing CLIENT_URL degrades to null / relative path, never throws", () =>
    withEnv({ NODE_ENV: "production", CLIENT_URL: undefined }, ({ getSiteOrigin, absoluteUrl }) => {
      delete process.env.CLIENT_URL;
      assert.equal(getSiteOrigin(), null);
      assert.equal(absoluteUrl("/product/abc"), "/product/abc");
      assert.ok(!absoluteUrl("/product/abc").includes("undefined"), "must never fabricate a literal 'undefined' in the path");
    }));

  test("malformed CLIENT_URL degrades to null, never throws or emits a broken URL", () =>
    withEnv({ NODE_ENV: "production", CLIENT_URL: "not a url at all" }, ({ getSiteOrigin }) => {
      assert.equal(getSiteOrigin(), null);
    }));

  test("javascript: and data: protocols are rejected", async () => {
    await withEnv({ NODE_ENV: "production", CLIENT_URL: "javascript:alert(1)" }, ({ getSiteOrigin }) => {
      assert.equal(getSiteOrigin(), null);
    });
    await withEnv({ NODE_ENV: "production", CLIENT_URL: "data:text/html,hi" }, ({ getSiteOrigin }) => {
      assert.equal(getSiteOrigin(), null);
    });
  });

  test("embedded credentials in CLIENT_URL are rejected", () =>
    withEnv({ NODE_ENV: "production", CLIENT_URL: "https://user:pass@tahos.store" }, ({ getSiteOrigin }) => {
      assert.equal(getSiteOrigin(), null);
    }));

  test("localhost is rejected as a production origin (matches the existing lib/appUrl.js policy password-reset links already rely on)", () =>
    withEnv({ NODE_ENV: "production", CLIENT_URL: "http://localhost:3000" }, ({ getSiteOrigin, absoluteUrl }) => {
      assert.equal(getSiteOrigin(), null);
      assert.equal(absoluteUrl("/shop"), "/shop", "must degrade to a relative path, never a fabricated origin");
    }));

  test("a dev/test origin (NODE_ENV !== production) is allowed even as http://localhost", () =>
    withEnv({ NODE_ENV: "test", CLIENT_URL: "http://localhost:3000" }, ({ getSiteOrigin }) => {
      assert.equal(getSiteOrigin(), "http://localhost:3000");
    }));

  test("metadata (via app/layout.js) and sitemap.js/robots.js all resolve through the exact same absoluteUrl()/getSiteOrigin() helper — never one fabricating an origin while the other omits it", () => {
    for (const rel of ["app/layout.js", "app/sitemap.js", "app/robots.js"]) {
      const content = read(rel);
      assert.match(content, /from ["']@\/lib\/seo\.js["']/, `${rel} must source its origin from the shared lib/seo.js helper`);
    }
  });
});

describe("Phase 10 — root metadata uses validated origin construction", () => {
  test("app/layout.js sources metadataBase from lib/seo.js's getSiteOrigin(), never a raw CLIENT_URL/process.env concatenation", () => {
    const content = read("app/layout.js");
    assert.match(content, /from ["']@\/lib\/seo\.js["']/);
    assert.match(content, /getSiteOrigin\(/);
    assert.ok(!/process\.env\.CLIENT_URL/.test(content), "must not read CLIENT_URL directly — go through the shared helper");
  });

  test("lib/seo.js never throws for a missing/invalid origin (degrades to relative URLs, unlike lib/appUrl.js's resolveAppOrigin)", () => {
    const content = read("lib/seo.js");
    assert.match(content, /catch\s*\{\s*return null/s, "getSiteOrigin must swallow resolveAppOrigin()'s throw and return null");
  });
});

describe("Phase 10 — product route exports generateMetadata using the cached product read", () => {
  test("app/(routes)/product/[idOrSlug]/page.jsx exports generateMetadata, not a static metadata object", () => {
    const content = read("app/(routes)/product/[idOrSlug]/page.jsx");
    assert.match(content, /export async function generateMetadata/);
    assert.ok(!/export const metadata\s*=/.test(content), "a segment cannot export both metadata and generateMetadata — the static one must be gone");
  });

  test("generateMetadata reuses lib/serverDataCache.js's getCachedProductByIdOrSlug — no second, uncached MongoDB read", () => {
    const content = read("app/(routes)/product/[idOrSlug]/page.jsx");
    assert.match(content, /getCachedProductByIdOrSlug/);
    assert.ok(!/from ["'].*services\/productService\.js["']/.test(content), "must not import the raw service directly — only the cached wrapper");
  });

  test("generateMetadata awaits params (this Next version's params are a Promise, matching every other dynamic route)", () => {
    const content = read("app/(routes)/product/[idOrSlug]/page.jsx");
    assert.match(content, /const \{ idOrSlug \} = await params/);
  });
});

describe("Phase 10 — private/admin/auth routes are noindex", () => {
  const NOINDEX_ROUTES = [
    "app/(routes)/cart/page.jsx",
    "app/(routes)/checkout/page.jsx",
    "app/(routes)/compare/page.jsx",
    "app/(routes)/login/page.jsx",
    "app/(routes)/register/page.jsx",
    "app/(routes)/order-success/[orderId]/page.jsx",
    "app/(routes)/orders/page.jsx",
    "app/(routes)/orders/[id]/page.jsx",
    "app/(routes)/(account)/profile/page.jsx",
    "app/(routes)/wishlist/page.jsx",
  ];

  for (const rel of NOINDEX_ROUTES) {
    test(`${rel} declares robots: index false`, () => {
      const content = read(rel);
      assert.match(content, /robots:\s*\{\s*index:\s*false/, `${rel} must be noindex`);
    });
  }

  test("app/admin/layout.jsx declares robots: index false (inherited by every /admin/** page)", () => {
    const content = read("app/admin/layout.jsx");
    assert.match(content, /robots:\s*\{\s*index:\s*false/);
  });

  test("home (/) and shop's own base canonical are NOT noindex", () => {
    const home = read("app/(routes)/page.jsx");
    assert.ok(!/robots:\s*\{\s*index:\s*false/.test(home));
    const shop = read("app/(routes)/shop/page.jsx");
    // Shop's own generateMetadata is conditional (query-dependent), so
    // just confirm the unconditional index:true branch exists for the
    // no-query case.
    assert.match(shop, /index:\s*true/);
  });
});

describe("Phase 10 — robots.js and sitemap.js exist and are correctly scoped", () => {
  test("app/robots.js and app/sitemap.js exist", () => {
    assert.ok(exists("app/robots.js"));
    assert.ok(exists("app/sitemap.js"));
  });

  test("robots.js disallows every private/admin/API route family and references the sitemap", () => {
    const content = read("app/robots.js");
    for (const path of ["/api/", "/admin", "/login", "/checkout", "/cart", "/orders", "/profile"]) {
      assert.ok(content.includes(`"${path}"`), `robots.js must disallow ${path}`);
    }
    assert.match(content, /sitemap:/);
  });

  test("sitemap.js excludes every private route family (no cart/checkout/orders/admin/api/wishlist/compare/login/register URL is ever added)", () => {
    const content = stripComments(read("app/sitemap.js"));
    for (const forbidden of ["/cart", "/checkout", "/orders", "/admin", "/api/", "/wishlist", "/compare", "/login", "/register", "/profile"]) {
      assert.ok(!content.includes(`"${forbidden}`), `sitemap.js must never hardcode a URL under ${forbidden}`);
    }
  });

  test("sitemap.js's product query is active-only and not capped at an admin-list-style page size (no .limit(100)/.skip(...) pagination ceiling)", () => {
    const content = read("lib/serverDataCache.js");
    const fnMatch = content.match(/getCachedSitemapProducts[\s\S]*?\n\}/);
    assert.ok(fnMatch, "expected to find getCachedSitemapProducts in lib/serverDataCache.js");
    const fn = fnMatch[0];
    assert.match(fn, /isActive:\s*true/, "must only query active products");
    assert.ok(!/\.limit\(/.test(fn), "must not impose a pagination-style limit on the sitemap product query");
    assert.match(fn, /\.select\(/, "must project only the fields needed, never the full document");
  });

  test("the sitemap product projection is tagged CATALOG, so product create/update/delete invalidation keeps it in sync automatically", () => {
    const content = read("lib/serverDataCache.js");
    const fnMatch = content.match(/getCachedSitemapProducts[\s\S]*?\n\}/)[0];
    assert.match(fnMatch, /CACHE_TAGS\.CATALOG/);
  });

  test("no server-only private-data service (order/payment/address/cart/wishlist/auth/user) is imported into sitemap or robots code", () => {
    const NEVER_IMPORTED_RE = /from ["'].*services\/(orderService|paymentService|addressService|cartService|wishlistService|authService|userService)\.js["']/;
    for (const rel of ["app/sitemap.js", "app/robots.js"]) {
      const content = read(rel);
      assert.ok(!NEVER_IMPORTED_RE.test(content), `${rel} must not import a private-data service`);
    }
  });
});

describe("Phase 10 — structured data is safe and factual", () => {
  test("lib/seo.js's safeJsonLd escapes '<' (blocks </script>/<script> injection)", () => {
    const content = read("lib/seo.js");
    assert.match(content, /replaceAll\(["']<["'],\s*["']\\\\u003c["']\)/);
  });

  test("ProductJsonLd uses priceCurrency BDT, never invents aggregateRating for a product with zero real reviews", () => {
    const content = read("views/ProductDetailPage.jsx");
    assert.match(content, /priceCurrency:\s*["']BDT["']/);
    assert.match(content, /product\.numReviews\s*>\s*0/, "aggregateRating must be conditional on at least one real review existing");
  });

  test("ProductJsonLd renders with the same per-request CSP nonce mechanism (x-nonce request header) as the rest of the app", () => {
    const content = read("views/ProductDetailPage.jsx");
    assert.match(content, /headers\(\)/);
    assert.match(content, /x-nonce/);
    assert.match(content, /nonce=\{nonce\}/);
  });

  test("ProductJsonLd never serializes a Mongoose-internal or private field (__v, password, _doc, session, cookie)", () => {
    const content = stripComments(read("views/ProductDetailPage.jsx"));
    const jsonLdSection = content.slice(content.indexOf("ProductJsonLd"));
    assert.ok(!/__v|password|_doc|session|cookie/i.test(jsonLdSection));
  });
});
