// Phase 8 — real cache-hit and invalidation behavior, proven against the
// actual `next start` process (unstable_cache's cache store only exists
// inside a real Next.js server runtime — calling it from a bare
// node:test process, as tests/*.test.mjs do for the rest of this app,
// would not exercise real caching at all). Uses uniquely seeded records
// per test to avoid cross-test cache collisions, and observes real data
// effects (a direct DB write staying hidden, then appearing after a real
// mutation) rather than relying on elapsed timing.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

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

const skip = !serverUp
  ? "test server not reachable — run via `npm run test:http`"
  : !dbConnectable
    ? skipReason || "MONGO_URI_TEST not reachable — see .env.test.example"
    : false;

class CookieJar {
  constructor() { this.cookies = new Map(); }
  absorb(response) {
    const lines = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const raw of lines) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  get(name) { return this.cookies.get(name); }
}

async function req(jar, path, { method = "GET", body, extraHeaders = {} } = {}) {
  const headers = new Headers(extraHeaders);
  const cookieHeader = jar?.header();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (method !== "GET") headers.set("origin", BASE_URL);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  jar?.absorb(res);
  return res;
}

async function loginAs(email, password) {
  const jar = new CookieJar();
  const res = await req(jar, "/api/users/login", { method: "POST", body: { email, password } });
  assert.equal(res.status, 200, "test fixture login must succeed");
  return jar;
}

async function adminReq(jar, path, opts = {}) {
  return req(jar, path, { ...opts, extraHeaders: { ...(opts.extraHeaders || {}), "x-csrf-token": jar.get("tahos_csrf") } });
}

// ---------------------------------------------------------------------
// Deterministic per-key cache synchronization.
//
// The problem: Next's unstable_cache() (see
// node_modules/next/dist/esm/server/web/spec-extension/unstable-cache.js)
// computes a cache-miss result and returns it to the caller IMMEDIATELY,
// but stashes the actual cache-store write (cacheNewResult()) in
// `workStore.pendingRevalidates[invocationKey]` — a promise the
// request's own lifecycle is responsible for awaiting LATER, not
// something guaranteed to have resolved by the time the HTTP response
// finishes sending. A test that drains a "warm" response and then does a
// raw SQL write can race that still-pending persist, corrupting what the
// test believes is a stable "warm, pre-existing" snapshot. There is no
// PUBLIC Next.js API to await a specific pendingRevalidates entry from
// outside the request that created it, and no filed Next.js issue was
// found naming this exact behavior (searched, found none matching) — so
// this is reported as observed, source-confirmed behavior in this
// installed version (16.3.4), not a claimed framework defect.
//
// Three prior approaches in this file were each insufficient — recorded
// here rather than deleted from history, because each failure mode is
// instructive and this exact history was raised on review:
//   1. A fixed delay after the fetch — a guess, not a proof.
//   2. Polling `.next/cache/fetch-cache`'s directory-wide mtime for
//      quiet — this observed whether the DIRECTORY was idle, not
//      whether OUR request's entry was ready; a silently-never-cached
//      endpoint would look identical to a freshly-settled one. Correctly
//      identified as "observes inactivity, not a write" on review.
//   3. Requiring an observed directory-wide filesystem delta before
//      accepting "settled" — closed that gap, but wrongly assumed every
//      warm call is a fresh miss; this describe block's `burqaDeptId` is
//      fixed, and more than one test intentionally/structurally shares a
//      canonical `category=<id>&...` query key with an adjacent test, so
//      a later test's "warm" call can correctly be an inherited HIT with
//      nothing new to write — a directory-wide delta can't tell "our
//      key" from "some other key," so it threw on legitimate hits.
//
// The fix used here: this test's own server process
// (scripts/httpTestServer.mjs, TEST-ONLY — never the production build)
// is started with `NEXT_PRIVATE_DEBUG_CACHE=1`, Next's own internal
// switch (node_modules/next/dist/server/lib/incremental-cache/file-system-cache.js's
// `FileSystemCache.debug`) that ONLY gates extra `console.log` calls
// inside `.get()`/`.set()` — confirmed by reading that file directly,
// every `if (FileSystemCache.debug)` block wraps a console.log and
// NOTHING else, so this changes zero cache read/write/timing behavior,
// in a process that is itself test-only. Those log lines name the EXACT
// cache key and whether a lookup was a hit, confirmed empirically against
// this app's own real output, e.g.:
//   FileSystemCache: get bb509f3d...920cc [ 'public-settings' ] FETCH false
//   FileSystemCache: set bb509f3d...920cc
// httpTestServer.mjs exposes that running server's log file path via
// `HTTP_TEST_SERVER_LOG_PATH`. Under this harness's own
// `--test-concurrency=1` (confirmed in that script), no two requests are
// ever in flight at once, and this parses the LOGGED key string itself
// (not line position or timing) to correlate a `get` with its matching
// `set` — exact, not inferred.
//
// Two distinct primitives, matching the two distinct situations in this
// file — a first touch of a key (must observe a real miss settle) is a
// different claim than an intentional re-touch of an already-warm key
// (must observe NO new write) — conflating them was exactly what made
// approach 3 above wrong:
//   - warmCacheMiss(url): asserts the request caused at least one
//     genuine MISS (`get ... false`) whose matching `set` for the SAME
//     key has landed. Throws with the full captured log slice if no
//     miss ever appeared, or a miss appeared with no matching `set`
//     within the bound. Use for the FIRST touch of a key, or a touch
//     immediately following a real invalidating mutation with nothing
//     else intervening.
//   - confirmCacheHit(url): asserts the request's cache lookup(s) were
//     all HITs (`get ... true`) and caused NO `set` at all. Throws with
//     the full captured log slice if a `set` occurred (the assumption
//     that this key was already warm was wrong) or if no cache activity
//     was observed at all. Use ONLY for a request KNOWN — by tracing
//     actual test order and invalidation, not assumed — to reuse an
//     entry a preceding warmCacheMiss() in the SAME test run already
//     established, with nothing invalidating it in between.
//
// Both throw with full diagnostics on a genuine timeout — neither ever
// falls back to a fixed delay. A silent fallback would hide exactly the
// failure mode (a write that never lands, or lands when it shouldn't)
// these exist to catch.
const SERVER_LOG_PATH = process.env.HTTP_TEST_SERVER_LOG_PATH;
if (!SERVER_LOG_PATH) {
  throw new Error(
    "HTTP_TEST_SERVER_LOG_PATH is not set — this test file's cache synchronization requires it " +
      "(set by scripts/httpTestServer.mjs). Run this file via `npm run test:http`, not directly with `node --test`.",
  );
}

function currentLogSize() {
  try {
    return fs.statSync(SERVER_LOG_PATH).size;
  } catch {
    return 0;
  }
}

function readLogSince(offset) {
  let fd;
  try {
    fd = fs.openSync(SERVER_LOG_PATH, "r");
    const size = fs.fstatSync(fd).size;
    const length = size - offset;
    if (length <= 0) return "";
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, offset);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Parses `FileSystemCache: get <key> [ 'tag1', 'tag2' ] FETCH <true|false>`
// and `FileSystemCache: set <key>` lines — format confirmed empirically
// against this app's own real log output (see header comment). The key
// is a single whitespace-free hash token in both cases; the tags array
// is captured too (see below for why the boolean alone is NOT enough).
//
// IMPORTANT, found on review of a real captured failure (not assumed):
// the `true`/`false` here means "was ANY entry found in the store" — it
// does NOT mean "was it served as a valid hit". Reading
// node_modules/next/dist/server/lib/incremental-cache/file-system-cache.js's
// `.get()` directly: after finding `data` (logging `true`), it separately
// checks `areTagsExpired(combinedTags, data.lastModified)` — if the
// entry's tags were revalidated/expired, it logs "FileSystemCache:
// expired tags [...]" on the very next line and returns `null` anyway,
// which the CALLER treats as a miss, triggering a real recompute and a
// real `.set()`. A real captured run showed exactly this: `get ... true`
// immediately followed by `expired tags` then `set` for the SAME key —
// a genuine, real write that a naive `hit === false` filter (an earlier
// version of this function) silently missed, causing a false timeout.
// The fix: don't infer "did a write happen" from the boolean at all —
// `set` is unambiguous proof by itself (Next only ever calls it to
// persist a freshly (re)computed value, whether the trigger was a true
// miss or an expired hit). This parser keeps `hit` only for
// confirmCacheHit()'s hit-vs-write distinction below, not for deciding
// whether a write occurred.
function parseCacheEvents(text) {
  const events = [];
  for (const line of text.split("\n")) {
    const getMatch = line.match(/^FileSystemCache: get (\S+) \[(.*)\] FETCH (true|false)\s*$/);
    if (getMatch) {
      const tags = getMatch[2]
        .split(",")
        .map((s) => s.trim().replace(/^'|'$/g, ""))
        .filter(Boolean);
      events.push({ op: "get", key: getMatch[1], tags, hit: getMatch[3] === "true" });
      continue;
    }
    const setMatch = line.match(/^FileSystemCache: set (\S+)\s*$/);
    if (setMatch) {
      events.push({ op: "set", key: setMatch[1] });
    }
  }
  return events;
}

/**
 * Fires `url`, then requires the server log to show a `get` tagged
 * `tag` (see lib/cacheTags.js for the real tag strings — "catalog",
 * "categories", "admin-analytics", etc., matching whatever
 * lib/serverDataCache.js's unstable_cache() call for this route uses)
 * whose key has a matching `set` within `maxWaitMs` — proof that THIS
 * route's relevant cache family was (re)computed and durably persisted,
 * not just that some other, unrelated cache entry the same page render
 * happens to touch (categories/settings on a page's shared header, say)
 * was written instead. Throws with the full captured log slice on
 * timeout — never falls back to a fixed delay. Use for the FIRST touch
 * of a cache entry in a test flow (see this section's header comment).
 */
async function warmCacheMiss(url, opts, { tag, maxWaitMs = 2000, pollIntervalMs = 5 } = {}) {
  if (!tag) throw new Error("warmCacheMiss(): a `tag` option (the expected lib/cacheTags.js tag for this route) is required.");
  const offset = currentLogSize();
  const text = await (await fetch(url, opts)).text();

  const start = Date.now();
  for (;;) {
    const events = parseCacheEvents(readLogSince(offset));
    const taggedGetKeys = new Set(events.filter((e) => e.op === "get" && e.tags.includes(tag)).map((e) => e.key));
    const setKeys = new Set(events.filter((e) => e.op === "set").map((e) => e.key));
    const writtenTaggedKeys = [...taggedGetKeys].filter((k) => setKeys.has(k));
    if (writtenTaggedKeys.length > 0) {
      return text; // at least one key looked up under `tag` by this request was (re)computed and durably written
    }
    if (Date.now() - start >= maxWaitMs) {
      throw new Error(
        `warmCacheMiss(): timed out after ${maxWaitMs}ms for ${url} (tag "${tag}"). ` +
          `Observed ${taggedGetKeys.size} get(s) tagged "${tag}", ${writtenTaggedKeys.length} with a completed matching set(). ` +
          `Full cache-activity log for this request:\n${readLogSince(offset) || "(no FileSystemCache lines observed at all — this endpoint may not be going through unstable_cache)"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Fires `url`, then requires the server log to show NO `set` for any key
 * looked up under `tag` — proof this route's relevant cache entry was
 * served from an already-durable hit, not recomputed — within
 * `maxWaitMs`. Throws with the full captured log slice if a `set` for a
 * `tag`-tagged key occurs (the assumption that this key was already
 * warm was wrong) or if no `get` tagged `tag` is observed at all. Use
 * ONLY for a request KNOWN — by tracing actual test order and
 * invalidation, not assumed — to reuse an entry a preceding
 * warmCacheMiss() in the SAME test run already established, with
 * nothing invalidating it in between.
 */
async function confirmCacheHit(url, opts, { tag, maxWaitMs = 2000, pollIntervalMs = 5, settleMs = 30 } = {}) {
  if (!tag) throw new Error("confirmCacheHit(): a `tag` option (the expected lib/cacheTags.js tag for this route) is required.");
  const offset = currentLogSize();
  const text = await (await fetch(url, opts)).text();

  const start = Date.now();
  let lastEventCount = -1;
  let stableSince = null;
  for (;;) {
    const events = parseCacheEvents(readLogSince(offset));
    const taggedGetKeys = new Set(events.filter((e) => e.op === "get" && e.tags.includes(tag)).map((e) => e.key));
    const setKeys = new Set(events.filter((e) => e.op === "set").map((e) => e.key));
    const badWrite = [...taggedGetKeys].find((k) => setKeys.has(k));
    if (badWrite) {
      throw new Error(
        `confirmCacheHit(): expected ${url} (tag "${tag}") to be served entirely from an already-warm cache entry, ` +
          `but a set() occurred for key ${badWrite} — this key was NOT already durable. ` +
          `Full cache-activity log for this request:\n${readLogSince(offset)}`,
      );
    }
    if (events.length === lastEventCount) {
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince >= settleMs) {
        if (taggedGetKeys.size === 0) {
          throw new Error(
            `confirmCacheHit(): no get() tagged "${tag}" observed at all for ${url} within ${maxWaitMs}ms — ` +
              "this endpoint may not be going through unstable_cache as expected (expected at least a hit get()).",
          );
        }
        return text; // stable, tag-scoped all-hit, zero writes for this tag
      }
    } else {
      lastEventCount = events.length;
      stableSince = null;
    }
    if (Date.now() - start >= maxWaitMs) {
      throw new Error(
        `confirmCacheHit(): timed out after ${maxWaitMs}ms for ${url} (tag "${tag}") without reaching a stable, write-free state. ` +
          `Full cache-activity log for this request:\n${readLogSince(offset) || "(no FileSystemCache lines observed at all)"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Fires `url`, then requires the server log to reach a STABLE, durable
 * state for keys tagged `tag` — either (a) a `set` completed for some
 * `tag`-tagged key (a settled miss just wrote it), or (b) at least one
 * `tag`-tagged `get` was observed and activity has stopped with no `set`
 * pending (an already-durable hit). Use when the caller genuinely does
 * NOT need to know or assert which of those two happened — only that
 * the entry is now durable before a subsequent mutation. Found necessary
 * on review of a real captured failure: "category rename..." originally
 * used warmCacheMiss() (assuming a fresh first touch of `/api/categories`
 * within this describe block), but running the COMPLETE HTTP suite (not
 * just this file in isolation) showed that assumption doesn't hold —
 * some earlier file in the full ~20-file suite had already warmed
 * `/api/categories`, so this specific call sees a genuine, stable HIT,
 * not a miss. That test's own assertions only ever check the state
 * AFTER its mutation, never assert anything about whether the warm-up
 * itself was a hit or a miss — so requiring a fresh write was stricter
 * than what the test actually needs, and wrong across the full suite's
 * real execution order. warmCacheMiss()/confirmCacheHit() remain correct
 * and necessary for the call sites that DO need to assert one or the
 * other specifically (see each call site's own comment).
 */
async function ensureCacheReady(url, opts, { tag, maxWaitMs = 2000, pollIntervalMs = 5, settleMs = 30 } = {}) {
  if (!tag) throw new Error("ensureCacheReady(): a `tag` option (the expected lib/cacheTags.js tag for this route) is required.");
  const offset = currentLogSize();
  const text = await (await fetch(url, opts)).text();

  const start = Date.now();
  let lastEventCount = -1;
  let stableSince = null;
  for (;;) {
    const events = parseCacheEvents(readLogSince(offset));
    const taggedGetKeys = new Set(events.filter((e) => e.op === "get" && e.tags.includes(tag)).map((e) => e.key));
    const setKeys = new Set(events.filter((e) => e.op === "set").map((e) => e.key));
    const settledTaggedKeys = [...taggedGetKeys].filter((k) => setKeys.has(k));
    if (settledTaggedKeys.length > 0) {
      return text; // a settled write for this tag is immediate, unambiguous proof of readiness
    }
    if (events.length === lastEventCount) {
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince >= settleMs) {
        if (taggedGetKeys.size === 0) {
          throw new Error(
            `ensureCacheReady(): no get() tagged "${tag}" observed at all for ${url} within ${maxWaitMs}ms — ` +
              `this endpoint may not be going through unstable_cache as expected. Full cache-activity log for this request:\n${readLogSince(offset) || "(none)"}`,
          );
        }
        return text; // stable, no write pending — an already-durable hit
      }
    } else {
      lastEventCount = events.length;
      stableSince = null;
    }
    if (Date.now() - start >= maxWaitMs) {
      throw new Error(
        `ensureCacheReady(): timed out after ${maxWaitMs}ms for ${url} (tag "${tag}") without reaching a stable state. ` +
          `Full cache-activity log for this request:\n${readLogSince(offset) || "(no FileSystemCache lines observed at all)"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

// A real shop listing can contain up to 100 OTHER, already-seeded products
// on `limit=100` — a bare `html.includes("9999")` price check would be a
// false positive/negative if any unrelated product's price, id, or SKU
// happens to contain the same digits. Scoping the check to a window near
// THIS test's own (crypto-randomized, unique) product name ties the
// assertion to the one product that matters.
//
// The response body contains the product's name TWICE — once inside the
// embedded RSC flight payload (a JSON-escaped blob of every prop, in
// whatever order React serialized it) and once in the actual rendered
// HTML card — and either occurrence can come first depending on
// streaming order. Checking the window after EVERY occurrence (not just
// the first) avoids depending on that ordering.
function priceAppearsNearName(html, name, priceText) {
  let idx = html.indexOf(name);
  while (idx !== -1) {
    if (html.slice(idx, idx + 2000).includes(priceText)) return true;
    idx = html.indexOf(name, idx + 1);
  }
  return false;
}

describe("Phase 8 — real cache hit/invalidation behavior (real MongoDB, via HTTP)", { skip }, () => {
  let Product, Category, Order, withTransaction;
  let admin, adminJar;
  let burqaLeafId, burqaDeptId;
  const createdProductIds = [];
  const createdOrderIds = [];

  before(async () => {
    ({ default: Product } = await import("../../models/productModel.js"));
    ({ default: Category } = await import("../../models/categoryModel.js"));
    ({ default: Order } = await import("../../models/orderModel.js"));
    ({ withTransaction } = await import("../../lib/db/tx.js"));

    const burqa = await Category.findBySlug("burqa");
    assert.ok(burqa, "seed data must include the Burqa department");
    const [burqaLeaf] = await Category.findByParent(burqa._id);
    assert.ok(burqaLeaf, "Burqa needs a subcategory to attach test products to");
    burqaDeptId = burqa._id.toString();
    burqaLeafId = burqaLeaf._id.toString();

    admin = await createTestUser({ role: "admin" });
    adminJar = await loginAs(admin.email, "TestPassword123!");
  });

  after(async () => {
    if (createdOrderIds.length) await deleteRows("orders", "id", createdOrderIds);
    if (createdProductIds.length) await deleteRows("products", "id", createdProductIds);
    await disconnectTestDb();
  });

  async function makeProduct(overrides = {}) {
    const suffix = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const product = await Product.create({
      name: `__cache_test_${suffix}`,
      description: "Phase 8 cache-behavior fixture — safe to delete.",
      category: burqaLeafId,
      topCategory: burqaDeptId,
      basePrice: 5000,
      images: ["https://placehold.co/400x400.png?text=test"],
      variants: [{ variantName: "Default", sku: `CACHE-${suffix}`, stock: 10 }],
      isActive: true,
      ...overrides,
    });
    createdProductIds.push(product._id);
    return product;
  }

  // ---------- 1/3/4: real cache hit, invalidation, param-order equivalence ----------

  test("a public shop read is cached: a direct DB price change stays hidden until a real mutation invalidates it", async () => {
    // Deliberately under 1000 — Intl.NumberFormat currency grouping would
    // otherwise render e.g. 9999 as "9,999", which a bare digit-string
    // check would never match regardless of caching correctness.
    const product = await makeProduct({ basePrice: 500 });
    const qs = `category=${burqaDeptId}&sort=-createdAt&limit=100`;

    // First touch of this exact key in the whole suite run (the harness
    // wipes .next/cache/fetch-cache at startup) — must be a genuine miss.
    const first = await warmCacheMiss(`${BASE_URL}/shop?${qs}`, undefined, { tag: "catalog" });
    assert.ok(first.includes(product.name), "the fixture product must appear in the initial (uncached-yet) read");
    assert.ok(priceAppearsNearName(first, product.name, "500"));

    // Bypass the API entirely — a raw DB write the cache cannot know about.
    await rawQuery("UPDATE products SET base_price = ? WHERE id = ?", [999, product._id]);

    const second = await (await fetch(`${BASE_URL}/shop?${qs}`)).text();
    assert.ok(!priceAppearsNearName(second, product.name, "999"), "a cached read must NOT reflect a direct DB change — proves the second request was actually served from cache");

    // Now a REAL mutation through the admin route — this is what actually
    // invalidates the CATALOG tag.
    const putRes = await adminReq(adminJar, `/api/products/${product._id}`, { method: "PUT", body: { basePrice: 999, category: burqaLeafId } });
    assert.equal(putRes.status, 200);

    // Immediately follows a real invalidating mutation in this SAME test
    // — the entry must be recomputed, another genuine miss+write. The
    // "equivalent query parameters" test right after this one depends on
    // this call having durably re-established this exact key.
    const third = await warmCacheMiss(`${BASE_URL}/shop?${qs}`, undefined, { tag: "catalog" });
    assert.ok(priceAppearsNearName(third, product.name, "999"), "the next read after a real mutation must show the fresh price");
  });

  test("equivalent query parameters in a different order share ONE canonical cache entry", async () => {
    const product = await makeProduct({ basePrice: 610 });
    const qsA = `category=${burqaDeptId}&sort=-createdAt`;
    const qsB = `sort=-createdAt&category=${burqaDeptId}`;

    // Both qsA and qsB normalize to the EXACT same canonical key the
    // immediately-preceding test's `third` read just durably
    // re-established (`category=<burqaDeptId>&sort=-createdAt&limit=100`)
    // — nothing runs between that test and this one, so nothing has
    // invalidated it. Both calls here are KNOWN, traced hits, not
    // assumed — confirmCacheHit() verifies that directly (throws if
    // either turns out to actually be a miss).
    await confirmCacheHit(`${BASE_URL}/shop?${qsA}&limit=100`, undefined, { tag: "catalog" });
    await confirmCacheHit(`${BASE_URL}/shop?${qsB}&limit=100`, undefined, { tag: "catalog" });

    await rawQuery("UPDATE products SET base_price = ? WHERE id = ?", [770, product._id]);

    const afterA = await (await fetch(`${BASE_URL}/shop?${qsA}&limit=100`)).text();
    const afterB = await (await fetch(`${BASE_URL}/shop?${qsB}&limit=100`)).text();
    assert.ok(
      !priceAppearsNearName(afterA, product.name, "770") && !priceAppearsNearName(afterB, product.name, "770"),
      "both param orders must still be stale (same cache entry)",
    );

    const putRes = await adminReq(adminJar, `/api/products/${product._id}`, { method: "PUT", body: { basePrice: 770, category: burqaLeafId } });
    assert.equal(putRes.status, 200);

    const refreshedA = await (await fetch(`${BASE_URL}/shop?${qsA}&limit=100`)).text();
    const refreshedB = await (await fetch(`${BASE_URL}/shop?${qsB}&limit=100`)).text();
    assert.ok(
      priceAppearsNearName(refreshedA, product.name, "770") && priceAppearsNearName(refreshedB, product.name, "770"),
      "one invalidation must refresh BOTH param orderings, proving they shared one entry",
    );
  });

  // ---------- 6: product create/delete/activation updates catalog visibility ----------

  test("product deactivation removes it from the public shop listing after invalidation", async () => {
    const product = await makeProduct();
    const qs = `category=${burqaDeptId}&limit=100`;

    // Distinct key from the two tests above (no `sort` param) — first
    // touch of THIS exact key in the suite run, must be a genuine miss.
    const before1 = await warmCacheMiss(`${BASE_URL}/shop?${qs}`, undefined, { tag: "catalog" });
    assert.ok(before1.includes(product.name));

    const delRes = await adminReq(adminJar, `/api/products/${product._id}`, { method: "DELETE" });
    assert.equal(delRes.status, 200);

    // Immediately follows a real invalidating mutation in this SAME test
    // — must be recomputed. The "failed (validation-rejected) product
    // update" test's own key depends on tracing whether THIS read stays
    // durable through that test's own preceding mutation — see that
    // test's own comment for why it's a fresh miss there too, not an
    // inherited hit of this one.
    const after1 = await warmCacheMiss(`${BASE_URL}/shop?${qs}`, undefined, { tag: "catalog" });
    assert.ok(!after1.includes(product.name), "a deactivated product must not remain visible after the cache is invalidated");
  });

  test("a raw-inserted new product is invisible until ANY real product mutation broadly invalidates the catalog", async () => {
    const qs = `category=${burqaDeptId}&limit=200`;
    // Unique `limit=200` shape — first (and only) touch of this key in
    // the suite run, must be a genuine miss.
    await warmCacheMiss(`${BASE_URL}/shop?${qs}`, undefined, { tag: "catalog" });

    const rawProduct = await makeProduct({ name: `__cache_test_raw_${crypto.randomBytes(4).toString("hex")}` });
    const stillCached = await (await fetch(`${BASE_URL}/shop?${qs}`)).text();
    assert.ok(!stillCached.includes(rawProduct.name), "a raw DB insert must not appear until the cache is invalidated");

    // Any real product mutation broadly invalidates CATALOG — this ALSO
    // invalidates the "product deactivation" test's `category=<id>&limit=100`
    // entry (CATALOG is one shared tag across every catalog-shaped
    // cached read, not scoped to this test's own key), which is exactly
    // why the very next test's read is a fresh miss, not an inherited hit.
    const otherProduct = await makeProduct({ name: `__cache_test_trigger_${crypto.randomBytes(4).toString("hex")}` });
    const putRes = await adminReq(adminJar, `/api/products/${otherProduct._id}`, { method: "PUT", body: { basePrice: 1234, category: burqaLeafId } });
    assert.equal(putRes.status, 200);

    const refreshed = await (await fetch(`${BASE_URL}/shop?${qs}`)).text();
    assert.ok(refreshed.includes(rawProduct.name), "the broad CATALOG invalidation must surface the raw-inserted product too");
  });

  // ---------- 12: failed mutations do not cause false invalidation ----------

  test("a failed (validation-rejected) product update does not invalidate the cache", async () => {
    const product = await makeProduct({ basePrice: 4321 });
    const qs = `category=${burqaDeptId}&limit=100`;
    // Same key shape as "product deactivation"'s `qs`, but NOT an
    // inherited hit of it: the immediately-preceding test ("a
    // raw-inserted new product...") performed a real admin PUT, which
    // broadly invalidates the shared CATALOG tag — including this key.
    // So this is expected to be a fresh miss again, not a reused hit;
    // warmCacheMiss() verifies that directly rather than assuming it.
    await warmCacheMiss(`${BASE_URL}/shop?${qs}`, undefined, { tag: "catalog" });

    await rawQuery("UPDATE products SET base_price = ? WHERE id = ?", [8888, product._id]);

    // A negative basePrice fails Phase 5 schema validation — never reaches
    // updateProduct(), so invalidateCacheTags() is never called.
    const badRes = await adminReq(adminJar, `/api/products/${product._id}`, { method: "PUT", body: { basePrice: -5 } });
    assert.equal(badRes.status, 400);

    const stillStale = await (await fetch(`${BASE_URL}/shop?${qs}`)).text();
    assert.ok(!stillStale.includes("8888"), "a rejected mutation must not have invalidated the cache — the entry is still the pre-existing cached value");
  });

  // ---------- 13: cache-ineligible search queries remain uncached and correct ----------

  test("a free-text search query is never cached — it always reflects the latest data immediately", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    // A single distinctive token (no underscores) — MongoDB's $text search
    // tokenizes on word boundaries, so an underscore-joined identifier
    // would be split into common words ("cache", "test", ...) matched
    // against unrelated fixtures from other tests sharing this database;
    // one opaque hex token avoids that ambiguity entirely.
    const uniqueToken = `cachetestsearch${suffix}`;
    const product = await makeProduct({ name: uniqueToken, basePrice: 321 });
    const searchUrl = `${BASE_URL}/shop?search=${uniqueToken}`;

    const firstRes = await fetch(searchUrl);
    assert.equal(firstRes.status, 200);
    const first = await firstRes.text();
    assert.ok(first.includes(product.name), "the fixture product must be findable by its own unique name");
    assert.ok(priceAppearsNearName(first, product.name, "321"), "the fixture's real (unmodified) price must appear");

    // A direct DB price change (no invalidation call at all) — an
    // ineligible (search) query must reflect this on the very next
    // request, since it was never cached in the first place.
    await rawQuery("UPDATE products SET base_price = ? WHERE id = ?", [654, product._id]);
    const secondRes = await fetch(searchUrl);
    const second = await secondRes.text();
    assert.ok(priceAppearsNearName(second, product.name, "654"), "search results must never be served from the shared cache — the direct DB change must appear immediately");
  });

  // ---------- 8: category mutation invalidates affected lists/facets ----------

  test("a category rename is reflected immediately after the mutation (categories cache invalidated)", async () => {
    const suffix = crypto.randomBytes(4).toString("hex");
    const testCat = await Category.create({ name: `__cache_cat_${suffix}`, slug: `cache-cat-${suffix}`, parent: null });
    try {
      // This test only ever asserts on the state AFTER the mutation below
      // — it never checks whether this warm-up itself was a hit or a
      // miss. Confirmed on review (a real captured full-suite run): an
      // earlier file in the complete ~20-file HTTP suite can already
      // have warmed `/api/categories` before this describe block even
      // starts, making this a genuine, stable HIT rather than a first
      // touch — ensureCacheReady() correctly accepts either outcome, as
      // long as the entry is durable before the mutation that follows.
      await ensureCacheReady(`${BASE_URL}/api/categories`, undefined, { tag: "categories" });
      const renamed = `__cache_cat_renamed_${suffix}`;
      const putRes = await adminReq(adminJar, `/api/categories/${testCat._id}`, { method: "PUT", body: { name: renamed } });
      assert.equal(putRes.status, 200);
      const after1 = await (await fetch(`${BASE_URL}/api/categories`)).text();
      assert.ok(after1.includes(renamed), "the categories cache must reflect the rename immediately after invalidation");
    } finally {
      await testCat.deleteOne();
    }
  });

  // ---------- 9: settings/theme mutation refreshes cached public configuration ----------

  test("a public settings mutation refreshes the cached public-settings read", async () => {
    const before1 = await (await fetch(`${BASE_URL}/api/settings/public`)).json();
    const original = before1.settings.store?.name || "";
    const suffix = crypto.randomBytes(3).toString("hex");
    const newName = `Cache Test Store ${suffix}`;
    try {
      const putRes = await adminReq(adminJar, "/api/settings", { method: "PUT", body: { store: { name: newName } } });
      assert.equal(putRes.status, 200);
      const after1 = await (await fetch(`${BASE_URL}/api/settings/public`)).json();
      assert.equal(after1.settings.store?.name, newName, "the public settings cache must reflect the new store name immediately");
    } finally {
      await adminReq(adminJar, "/api/settings", { method: "PUT", body: { store: { name: original } } });
    }
  });

  // ---------- 11: admin analytics refreshes after order/payment mutations ----------

  test("admin analytics (order status breakdown) refreshes after a real order status transition", async () => {
    const buyer = await createTestUser({ role: "customer" });
    const product = await makeProduct();
    const order = await withTransaction((conn) =>
      Order.create(
        {
          user: buyer._id,
          items: [{ product: product._id, variantId: product.variants[0]._id, quantity: 1, snapshot: { name: product.name, price: product.basePrice } }],
          shippingAddress: { fullName: "Cache Test", phone: "0100000000", street: "1 Test St", city: "Dhaka", postalCode: "1200", country: "Bangladesh" },
          subtotal: product.basePrice,
          total: product.basePrice,
          status: "pending",
          idempotencyKeyHash: crypto.randomBytes(16).toString("hex"),
          idempotencyRequestHash: crypto.randomBytes(16).toString("hex"),
        },
        conn,
      ),
    );
    createdOrderIds.push(order._id);

    // First touch of `/admin` (renders several unstable_cache-wrapped
    // admin-analytics reads in one page) — genuine miss expected.
    await warmCacheMiss(`${BASE_URL}/admin`, { headers: { cookie: adminJar.header() } }, { tag: "admin-analytics" });

    const putRes = await adminReq(adminJar, `/api/orders/${order._id}/status`, { method: "PUT", body: { status: "processing" } });
    assert.equal(putRes.status, 200);

    // The status-breakdown analytics function itself is a real, direct
    // service call — after invalidation, this proves the CACHE entry
    // (not just the underlying DB) reflects the new count.
    const breakdownRes = await adminReq(adminJar, "/api/analytics/status-breakdown");
    assert.equal(breakdownRes.status, 200);
    const breakdown = await breakdownRes.json();
    const processingRow = breakdown.data.find((r) => r.status === "processing");
    assert.ok(processingRow && processingRow.count >= 1, "the processing-status count must reflect the just-transitioned order");
  });

  // ---------- 14/15: private customer reads are never shared-cached; no sensitive fields ----------

  test("two different customers' /orders pages never share cached content", async () => {
    const buyerA = await createTestUser({ role: "customer" });
    const buyerB = await createTestUser({ role: "customer" });
    const product = await makeProduct();
    const orderA = await withTransaction((conn) =>
      Order.create(
        {
          user: buyerA._id,
          items: [{ product: product._id, variantId: product.variants[0]._id, quantity: 1, snapshot: { name: `OrderA-${product.name}`, price: product.basePrice } }],
          shippingAddress: { fullName: "A", phone: "0100000000", street: "1 St", city: "Dhaka", postalCode: "1200", country: "Bangladesh" },
          subtotal: product.basePrice,
          total: product.basePrice,
          status: "pending",
          idempotencyKeyHash: crypto.randomBytes(16).toString("hex"),
          idempotencyRequestHash: crypto.randomBytes(16).toString("hex"),
        },
        conn,
      ),
    );
    createdOrderIds.push(orderA._id);

    const jarA = await loginAs(buyerA.email, "TestPassword123!");
    const jarB = await loginAs(buyerB.email, "TestPassword123!");

    const htmlA = await (await fetch(`${BASE_URL}/orders`, { headers: { cookie: jarA.header() } })).text();
    const htmlB = await (await fetch(`${BASE_URL}/orders`, { headers: { cookie: jarB.header() } })).text();
    assert.ok(htmlA.includes(orderA._id.toString().slice(-8).toUpperCase()));
    assert.ok(!htmlB.includes(orderA._id.toString().slice(-8).toUpperCase()), "buyer B must never see buyer A's order, proving /orders is never shared-cached");
  });

  test("cached public HTML (shop) never contains a password hash or session/CSRF token value", async () => {
    const product = await makeProduct();
    const html = await (await fetch(`${BASE_URL}/shop?category=${burqaDeptId}&limit=50`)).text();
    assert.ok(html.includes(product.name));
    assert.ok(!/\$2[aby]\$/.test(html), "no bcrypt password hash may ever appear");
    assert.ok(!html.includes(adminJar.get("tahos_csrf") || "__no_csrf__"));
  });
});
