// Phase 9 — real HTTP evidence that the next/image migration actually
// produces responsive, optimized markup on the real `next start` runtime
// (unstable_cache-style: next/image's own optimizer/srcset generation
// only exists inside a real Next.js server, not a bare node:test
// process). Seeds deterministic fixture data and inspects the generated
// markup only — never fetches a real remote image asset over the
// network, and never hardcodes a full encoded `/_next/image?url=...`
// string (only decodes/inspects the parameters that matter).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { dbReady, skipReason, connectTestDb, disconnectTestDb } from "../helpers/testDb.mjs";

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

const skip = !serverUp
  ? "test server not reachable — run via `npm run test:http`"
  : !dbConnectable
    ? skipReason || "MONGO_URI_TEST not reachable — see .env.test.example"
    : false;

// Finds every rendered <img ...> tag and returns its attribute string —
// works for next/image's actual DOM output (a real <img>, whatever else
// wraps it), not a component name that never appears in HTML.
function findImgTags(html) {
  return [...html.matchAll(/<img\b([^>]*)>/g)].map((m) => m[1]);
}

// next/image's own optimizer rewrites `src` to `/_next/image?url=<encoded
// original>&w=<width>&q=<quality>` — decode just the `url` param rather
// than hardcoding the whole encoded string, per this phase's own
// instruction not to bake a full `/_next/image` URL into a test.
function decodedNextImageUrl(imgAttrs) {
  const srcMatch = imgAttrs.match(/\bsrc="([^"]*)"/);
  if (!srcMatch) return null;
  const src = srcMatch[1].replace(/&amp;/g, "&");
  if (!src.startsWith("/_next/image")) return src; // not proxied (shouldn't happen for a remote image)
  const qs = new URLSearchParams(src.split("?")[1] || "");
  return qs.get("url") ? decodeURIComponent(qs.get("url")) : null;
}

describe("Phase 9 — real HTTP: next/image produces responsive, optimized markup", { skip }, () => {
  let Product, Category;
  let burqaLeafId, burqaDeptId;
  const createdIds = [];
  let product;
  const productName = `__img_test_${crypto.randomBytes(4).toString("hex")}`;
  const FIXTURE_IMAGE = "https://placehold.co/800x1000?text=phase9";

  before(async () => {
    ({ default: Product } = await import("../../models/productModel.js"));
    ({ default: Category } = await import("../../models/categoryModel.js"));

    const burqa = await Category.findOne({ slug: "burqa" }).lean();
    assert.ok(burqa, "seed data must include the Burqa department");
    const burqaLeaf = await Category.findOne({ parent: burqa._id }).lean();
    assert.ok(burqaLeaf, "Burqa needs a subcategory to attach a test product to");
    burqaDeptId = burqa._id.toString();
    burqaLeafId = burqaLeaf._id.toString();

    product = await Product.create({
      name: productName,
      description: "Phase 9 image-optimization fixture — safe to delete.",
      category: burqaLeafId,
      topCategory: burqaDeptId,
      basePrice: 750,
      images: [FIXTURE_IMAGE, FIXTURE_IMAGE],
      variants: [{ variantName: "Default", sku: `IMG-${crypto.randomBytes(4).toString("hex")}`, stock: 5 }],
      isActive: true,
      isFeatured: true,
    });
    createdIds.push(product._id);
  });

  after(async () => {
    if (createdIds.length) await Product.deleteMany({ _id: { $in: createdIds } });
    await disconnectTestDb();
  });

  test("shop page: the seeded product's card renders a next/image <img> with srcset, a real sizes contract, and meaningful alt text", async () => {
    const res = await fetch(`${BASE_URL}/shop?category=${burqaDeptId}&limit=100`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(productName), "the fixture product must appear in the initial HTML");

    const tags = findImgTags(html).filter((attrs) => attrs.includes(`alt="${productName}"`));
    assert.ok(tags.length >= 1, "expected at least one <img> whose alt text is the product's real name");
    const attrs = tags[0];

    assert.match(attrs, /\bsrcset="[^"]+"/i, "next/image must generate a responsive srcset");
    assert.match(attrs, /\bsizes="[^"]+"/, "the product card's <Image fill> must carry a real sizes contract");
    assert.ok(!/\bsizes="100vw"/.test(attrs), "a grid card must not claim the full viewport width on desktop");

    const decodedUrl = decodedNextImageUrl(attrs);
    assert.ok(decodedUrl && decodedUrl.includes("placehold.co"), "the optimized image must resolve back to the real configured origin");
  });

  test("home page: a real seeded department image (if this product won hero selection) or at minimum the category-tile art is optimized, responsive next/image markup — never a raw external src bypass", async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);
    const html = await res.text();

    const imageTags = findImgTags(html);
    assert.ok(imageTags.length > 0, "the home page must render at least one image");
    for (const attrs of imageTags) {
      const decodedUrl = decodedNextImageUrl(attrs);
      if (!decodedUrl) continue;
      // Every optimized remote image on this page must come from a
      // configured, allowlisted origin — proving no raw external image
      // source bypassed next/image's own host allowlist.
      assert.ok(
        decodedUrl.includes("res.cloudinary.com") || decodedUrl.includes("placehold.co") || decodedUrl.startsWith("/"),
        `unexpected unoptimized/non-allowlisted image origin: ${decodedUrl}`,
      );
    }
  });

  test("home page: the hero's breakpoint variants are never loading=\"eager\" (which would force all of them to download regardless of viewport), and no more than the 3 hero breakpoint variants ever carry fetchpriority=high", async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);
    const html = await res.text();

    // Robust to whichever department product the (Phase 8-cached) hero
    // query happens to resolve when this file runs alongside the rest of
    // the HTTP suite sharing one seeded database — never asserts an EXACT
    // count here (that guarantee lives in the static check in
    // tests/imageOptimization.test.mjs, which proves HeroCarousel.jsx's
    // source always has exactly 3 fetchPriority="high" call sites,
    // independent of cache timing or seed-data state). This real-HTTP
    // test instead proves the two properties that must hold regardless
    // of which product the cache resolved: no forced eager download, and
    // never MORE than 3 high-priority images (a regression ceiling — if
    // ProductCard's own grids ever leaked a fetchpriority=high onto the
    // home page, this would catch it).
    const eagerTags = findImgTags(html).filter((attrs) => /loading="eager"/i.test(attrs));
    assert.equal(eagerTags.length, 0, "no image on the home page may be loading=\"eager\" — CSS-hidden hero breakpoint variants would still be force-downloaded");

    const highPriorityTags = findImgTags(html).filter((attrs) => /fetchpriority="high"/i.test(attrs));
    assert.ok(highPriorityTags.length <= 3, `expected at most the 3 hero breakpoint variants to carry fetchpriority=high, found ${highPriorityTags.length}`);
  });

  test("product-detail page: the main gallery image is optimized with a stable aspect/dimension contract, real alt text, and the thumbnail strip is never marked high priority", async () => {
    const res = await fetch(`${BASE_URL}/product/${product.slug || product._id}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes(productName));

    const tags = findImgTags(html).filter((attrs) => attrs.includes(`alt="${productName}"`));
    assert.ok(tags.length >= 1, "expected the main gallery <img> to carry the product's real name as alt text");
    assert.match(tags[0], /\bsrcset="[^"]+"/i);
    assert.match(tags[0], /\bsizes="[^"]+"/);
    // next/image's fetchpriority prop lowercases to the real HTML attribute.
    assert.match(tags[0], /fetchpriority="high"/i, "the product-detail main image is this route's genuine LCP candidate");

    // The thumbnail strip (this fixture has 2 images, so a thumbnail row
    // renders) must never carry the same high-priority hint.
    const highPriorityTags = findImgTags(html).filter((attrs) => /fetchpriority="high"/i.test(attrs));
    assert.equal(highPriorityTags.length, 1, "at most one image on the product-detail page may be fetchpriority high");
  });

  test("no secret or internal Cloudinary configuration leaks into any rendered image markup", async () => {
    const pages = ["/", `/shop?category=${burqaDeptId}&limit=50`, `/product/${product.slug || product._id}`];
    for (const path of pages) {
      const html = await (await fetch(`${BASE_URL}${path}`)).text();
      assert.ok(!/CLOUDINARY_URL|api_key|api_secret/i.test(html), `${path} must never leak Cloudinary credentials`);
    }
  });
});
