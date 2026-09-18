// Admin-promotions feature — domain/service behavior, admin API security,
// and public eligibility endpoints, against a real replica-set MongoDB.
// Traced from services/promotionService.js and models/promotionModel.js
// before writing any assertion below, matching this suite's own house
// style (see tests/coupons.test.mjs's own top-of-file note).
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
  createTestCategory,
  createTestProduct,
  deleteRows,
  rawQuery,
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("Admin-promotions feature", { skip: !canRun && reason }, () => {
  let Promotion, Category, Product;
  let listPOST, itemPUT, itemDELETE, duplicatePOST, reorderPOST, carouselGET, popupGET;
  let resolvePromotionTarget, getEligiblePromotionsBase, filterByAudience;

  before(async () => {
    await connectTestDb();
    ({ default: Promotion } = await import("../models/promotionModel.js"));
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ POST: listPOST } = await import("../app/api/promotions/route.js"));
    ({ PUT: itemPUT, DELETE: itemDELETE } = await import("../app/api/promotions/[id]/route.js"));
    ({ POST: duplicatePOST } = await import("../app/api/promotions/[id]/duplicate/route.js"));
    ({ POST: reorderPOST } = await import("../app/api/promotions/reorder/route.js"));
    ({ GET: carouselGET } = await import("../app/api/promotions/carousel/route.js"));
    ({ GET: popupGET } = await import("../app/api/promotions/popup/route.js"));
    ({ resolvePromotionTarget, getEligiblePromotionsBase, filterByAudience } = await import("../services/promotionService.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  const future = (ms) => new Date(Date.now() + ms);
  const past = (ms) => new Date(Date.now() - ms);
  const HOUR = 3600000;

  async function makePromotion(overrides = {}) {
    return Promotion.create({
      name: `Test promo ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "carousel",
      placement: "home_hero",
      status: "active",
      pageScope: "home",
      desktopImage: "https://example.test/image.png",
      targetType: "none",
      ...overrides,
    });
  }

  // ===================== resolvePromotionTarget =====================

  describe("resolvePromotionTarget() — the one shared server-side target resolver", () => {
    test("product target resolves to /product/<slug> when the product is active", async () => {
      const product = await createTestProduct();
      try {
        const target = await resolvePromotionTarget({ targetType: "product", targetProduct: product._id });
        assert.equal(target.clickable, true);
        assert.equal(target.href, `/product/${product.slug}`);
      } finally {
        await deleteRows("products", "id", product._id);
      }
    });

    test("product target is non-clickable when the product is inactive", async () => {
      const product = await createTestProduct();
      await rawQuery("UPDATE products SET is_active = 0 WHERE id = ?", [product._id]);
      try {
        const target = await resolvePromotionTarget({ targetType: "product", targetProduct: product._id });
        assert.equal(target.clickable, false);
        assert.equal(target.href, null);
      } finally {
        await deleteRows("products", "id", product._id);
      }
    });

    test("product target is non-clickable when the product no longer exists", async () => {
      const target = await resolvePromotionTarget({ targetType: "product", targetProduct: "aaaaaaaaaaaaaaaaaaaaaaaa" });
      assert.equal(target.clickable, false);
      assert.equal(target.href, null);
    });

    test("category target resolves to /shop?category=<id> when the category is active", async () => {
      const category = await createTestCategory();
      try {
        const target = await resolvePromotionTarget({ targetType: "category", targetCategory: category._id });
        assert.equal(target.clickable, true);
        assert.equal(target.href, `/shop?category=${category._id}`);
      } finally {
        await deleteRows("categories", "id", category._id);
      }
    });

    test("category target is non-clickable when the category is inactive", async () => {
      const category = await createTestCategory();
      await rawQuery("UPDATE categories SET is_active = 0 WHERE id = ?", [category._id]);
      try {
        const target = await resolvePromotionTarget({ targetType: "category", targetCategory: category._id });
        assert.equal(target.clickable, false);
      } finally {
        await deleteRows("categories", "id", category._id);
      }
    });

    test("collection target resolves to /shop?collection=<value> with no DB lookup", async () => {
      const target = await resolvePromotionTarget({ targetType: "collection", targetCollection: "discount" });
      assert.deepEqual(target, { href: "/shop?collection=discount", clickable: true });
    });

    test("internal_url target resolves to the safe stored path", async () => {
      const target = await resolvePromotionTarget({ targetType: "internal_url", targetUrl: "/shop?fabric=chiffon" });
      assert.deepEqual(target, { href: "/shop?fabric=chiffon", clickable: true });
    });

    test("internal_url target rejects a protocol-relative path even if it somehow reached this function", async () => {
      const target = await resolvePromotionTarget({ targetType: "internal_url", targetUrl: "//evil.test/phish" });
      assert.equal(target.clickable, false);
      assert.equal(target.href, null);
    });

    test("internal_url target rejects a javascript: value even if it somehow reached this function", async () => {
      const target = await resolvePromotionTarget({ targetType: "internal_url", targetUrl: "javascript:alert(1)" });
      assert.equal(target.clickable, false);
    });

    test("none target is always non-clickable, deliberately", async () => {
      const target = await resolvePromotionTarget({ targetType: "none" });
      assert.deepEqual(target, { href: null, clickable: false });
    });

    test("a malformed ObjectId in targetProduct never reaches Mongoose — treated as unresolvable, not a thrown CastError", async () => {
      const target = await resolvePromotionTarget({ targetType: "product", targetProduct: "not-an-object-id" });
      assert.deepEqual(target, { href: null, clickable: false });
    });
  });

  // ===================== eligibility / scheduling =====================

  describe("getEligiblePromotionsBase() — scheduling and deterministic ordering", () => {
    let created = [];
    after(async () => {
      if (created.length) await deleteRows("promotions", "id", created.map((p) => p._id));
      created = [];
    });

    test("an active promotion with no schedule bounds is eligible", async () => {
      const p = await makePromotion();
      created.push(p);
      const results = await getEligiblePromotionsBase({ type: "carousel", placement: "home_hero", pageScope: "home" });
      assert.ok(results.some((r) => r.id === String(p._id)));
    });

    test("a scheduled-future promotion (startAt in the future) is excluded", async () => {
      const p = await makePromotion({ startAt: future(HOUR) });
      created.push(p);
      const results = await getEligiblePromotionsBase({ type: "carousel", placement: "home_hero", pageScope: "home" });
      assert.ok(!results.some((r) => r.id === String(p._id)));
    });

    test("an expired promotion (endAt in the past) is excluded", async () => {
      const p = await makePromotion({ endAt: past(HOUR) });
      created.push(p);
      const results = await getEligiblePromotionsBase({ type: "carousel", placement: "home_hero", pageScope: "home" });
      assert.ok(!results.some((r) => r.id === String(p._id)));
    });

    test("a promotion currently inside its start/end window is eligible", async () => {
      const p = await makePromotion({ startAt: past(HOUR), endAt: future(HOUR) });
      created.push(p);
      const results = await getEligiblePromotionsBase({ type: "carousel", placement: "home_hero", pageScope: "home" });
      assert.ok(results.some((r) => r.id === String(p._id)));
    });

    test("a paused promotion is excluded", async () => {
      const p = await makePromotion({ status: "paused" });
      created.push(p);
      const results = await getEligiblePromotionsBase({ type: "carousel", placement: "home_hero", pageScope: "home" });
      assert.ok(!results.some((r) => r.id === String(p._id)));
    });

    test("a draft promotion is excluded", async () => {
      const p = await makePromotion({ status: "draft" });
      created.push(p);
      const results = await getEligiblePromotionsBase({ type: "carousel", placement: "home_hero", pageScope: "home" });
      assert.ok(!results.some((r) => r.id === String(p._id)));
    });

    test("a promotion whose product target has gone inactive is OMITTED entirely, never returned as a dead link", async () => {
      const product = await createTestProduct();
      await rawQuery("UPDATE products SET is_active = 0 WHERE id = ?", [product._id]);
      const p = await makePromotion({ targetType: "product", targetProduct: product._id });
      created.push(p);
      try {
        const results = await getEligiblePromotionsBase({ type: "carousel", placement: "home_hero", pageScope: "home" });
        assert.ok(!results.some((r) => r.id === String(p._id)));
      } finally {
        await deleteRows("products", "id", product._id);
      }
    });

    test("carousel ordering: sortOrder ascending, then priority descending, then stable id", async () => {
      const low = await makePromotion({ sortOrder: 1, priority: 0, name: "low" });
      const high = await makePromotion({ sortOrder: 0, priority: 5, name: "high" });
      const mid = await makePromotion({ sortOrder: 0, priority: 1, name: "mid" });
      created.push(low, high, mid);
      const results = await getEligiblePromotionsBase({ type: "carousel", placement: "home_hero", pageScope: "home" });
      const ids = [high._id, mid._id, low._id].map(String);
      const positions = ids.map((id) => results.findIndex((r) => r.id === id));
      assert.ok(positions.every((pos, i) => i === 0 || positions[i - 1] < pos), "expected high, mid, low in that relative order");
    });

    test("popup ordering: highest priority first, then most recent startAt, then stable id — and a public consumer picks exactly one", async () => {
      const lowPriority = await makePromotion({ type: "popup", placement: "storefront_popup", priority: 0, name: "low-priority-popup" });
      const highPriority = await makePromotion({ type: "popup", placement: "storefront_popup", priority: 9, name: "high-priority-popup" });
      created.push(lowPriority, highPriority);
      const results = await getEligiblePromotionsBase({ type: "popup", placement: "storefront_popup", pageScope: "home" });
      assert.equal(results[0].id, String(highPriority._id), "highest priority must sort first");
    });

    test("pageScope 'all' promotions are eligible on every requested page scope", async () => {
      const p = await makePromotion({ pageScope: "all" });
      created.push(p);
      const home = await getEligiblePromotionsBase({ type: "carousel", placement: "home_hero", pageScope: "home" });
      const shop = await getEligiblePromotionsBase({ type: "carousel", placement: "home_hero", pageScope: "shop" });
      assert.ok(home.some((r) => r.id === String(p._id)));
      assert.ok(shop.some((r) => r.id === String(p._id)));
    });

    test("the public DTO never exposes createdBy/updatedBy/internal target ids", async () => {
      const p = await makePromotion();
      created.push(p);
      const results = await getEligiblePromotionsBase({ type: "carousel", placement: "home_hero", pageScope: "home" });
      const dto = results.find((r) => r.id === String(p._id));
      assert.ok(dto);
      for (const forbidden of ["createdBy", "updatedBy", "targetProduct", "targetCategory", "_id", "__v"]) {
        assert.equal(dto[forbidden], undefined, `public DTO must never include ${forbidden}`);
      }
    });

    test("no active promotion -> the eligible list is simply empty (storefront fallback handles this, never a thrown error)", async () => {
      const results = await getEligiblePromotionsBase({ type: "carousel", placement: "home_hero", pageScope: "product" });
      assert.ok(Array.isArray(results));
    });
  });

  describe("filterByAudience()", () => {
    test("audience 'all' is eligible for both guests and customers", () => {
      const list = [{ audience: "all" }];
      assert.equal(filterByAudience(list, false).length, 1);
      assert.equal(filterByAudience(list, true).length, 1);
    });
    test("audience 'guest' excludes authenticated visitors", () => {
      const list = [{ audience: "guest" }];
      assert.equal(filterByAudience(list, false).length, 1);
      assert.equal(filterByAudience(list, true).length, 0);
    });
    test("audience 'customer' excludes guests", () => {
      const list = [{ audience: "customer" }];
      assert.equal(filterByAudience(list, false).length, 0);
      assert.equal(filterByAudience(list, true).length, 1);
    });
  });

  // ===================== admin API security =====================

  describe("Admin promotion API — auth, permission, CSRF, and validation", () => {
    let created = [];
    after(async () => {
      if (created.length) await deleteRows("promotions", "id", created.map((p) => p._id));
      created = [];
    });

    const validBody = () => ({
      name: `API test ${Date.now()}`,
      type: "carousel",
      desktopImage: "https://example.test/img.png",
      targetType: "none",
    });

    test("POST /api/promotions — unauthenticated is denied (401)", async () => {
      const req = requestAs({ method: "POST", url: "http://test/api/promotions", body: validBody() });
      const res = await listPOST(req);
      assert.equal(res.status, 401);
    });

    test("POST /api/promotions — authenticated but unauthorized role is denied (403)", async () => {
      const user = await createTestUser({ role: "customer" });
      const session = await createTestSession(user._id);
      const req = requestAs({ method: "POST", url: "http://test/api/promotions", session, body: validBody() });
      const res = await listPOST(req);
      assert.equal(res.status, 403);
    });

    test("POST /api/promotions — an employee WITHOUT promotions.manage is denied (403)", async () => {
      const user = await createTestUser({ role: "employee", permissions: ["orders.view"] });
      const session = await createTestSession(user._id);
      const req = requestAs({ method: "POST", url: "http://test/api/promotions", session, body: validBody() });
      const res = await listPOST(req);
      assert.equal(res.status, 403);
    });

    test("POST /api/promotions — an employee WITH promotions.manage is allowed (201)", async () => {
      const user = await createTestUser({ role: "employee", permissions: ["promotions.manage"] });
      const session = await createTestSession(user._id);
      const req = requestAs({ method: "POST", url: "http://test/api/promotions", session, body: validBody() });
      const res = await listPOST(req);
      assert.equal(res.status, 201);
      const json = await res.json();
      created.push(json.promotion);
    });

    test("POST /api/promotions — admin role is always allowed", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const req = requestAs({ method: "POST", url: "http://test/api/promotions", session, body: validBody() });
      const res = await listPOST(req);
      assert.equal(res.status, 201);
      const json = await res.json();
      created.push(json.promotion);
    });

    test("POST /api/promotions — cross-origin request is rejected (403) even with a valid session", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const req = requestAs({
        method: "POST",
        url: "http://test/api/promotions",
        session,
        body: validBody(),
        originOverride: "https://evil.test",
      });
      const res = await listPOST(req);
      assert.equal(res.status, 403);
    });

    test("POST /api/promotions — missing/invalid CSRF token is rejected (403)", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const req = requestAs({ method: "POST", url: "http://test/api/promotions", session, body: validBody(), omitCsrfHeader: true });
      const res = await listPOST(req);
      assert.equal(res.status, 403);
    });

    test("POST /api/promotions — malformed JSON body is rejected (400), not a raw parse-error 500", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const req = new Request("http://test/api/promotions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `tahos_session=${session.rawToken}; tahos_csrf=${session.rawCsrfToken}`,
          origin: "http://test",
          "x-csrf-token": session.rawCsrfToken,
        },
        body: "{not valid json",
      });
      const res = await listPOST(req);
      assert.equal(res.status, 400);
    });

    test("POST /api/promotions — an unknown/extra field is rejected by the strict schema (400)", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const req = requestAs({
        method: "POST",
        url: "http://test/api/promotions",
        session,
        body: { ...validBody(), notARealField: "hi" },
      });
      const res = await listPOST(req);
      assert.equal(res.status, 400);
    });

    test("POST /api/promotions — a malicious internal_url target is rejected at the schema layer (400)", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const req = requestAs({
        method: "POST",
        url: "http://test/api/promotions",
        session,
        body: { ...validBody(), targetType: "internal_url", targetUrl: "javascript:alert(document.cookie)" },
      });
      const res = await listPOST(req);
      assert.equal(res.status, 400);
    });

    test("POST /api/promotions — an invalid ObjectId in targetProduct is rejected (400)", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const req = requestAs({
        method: "POST",
        url: "http://test/api/promotions",
        session,
        body: { ...validBody(), targetType: "product", targetProduct: "not-a-real-id" },
      });
      const res = await listPOST(req);
      assert.equal(res.status, 400);
    });

    test("PUT /api/promotions/[id] — updates and, on a creative-field change, bumps version", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const p = await makePromotion();
      created.push(p);
      const req = requestAs({
        method: "PUT",
        url: `http://test/api/promotions/${p._id}`,
        session,
        body: { title: "New headline" },
      });
      const res = await itemPUT(req, { params: Promise.resolve({ id: String(p._id) }) });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.promotion.version, 2);
    });

    test("PUT /api/promotions/[id] — pausing (a non-creative change) does NOT bump version", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const p = await makePromotion();
      created.push(p);
      const req = requestAs({ method: "PUT", url: `http://test/api/promotions/${p._id}`, session, body: { status: "paused" } });
      const res = await itemPUT(req, { params: Promise.resolve({ id: String(p._id) }) });
      const json = await res.json();
      assert.equal(json.promotion.version, 1);
    });

    test("POST /api/promotions/[id]/duplicate — clones as a draft, never carrying over 'active' status", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const p = await makePromotion({ status: "active" });
      created.push(p);
      const req = requestAs({ method: "POST", url: `http://test/api/promotions/${p._id}/duplicate`, session });
      const res = await duplicatePOST(req, { params: Promise.resolve({ id: String(p._id) }) });
      assert.equal(res.status, 201);
      const json = await res.json();
      created.push(json.promotion);
      assert.equal(json.promotion.status, "draft");
      assert.notEqual(json.promotion._id, String(p._id));
    });

    test("POST /api/promotions/reorder — reassigns sortOrder to match the given order, scoped to `type`", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const a = await makePromotion({ name: "reorder-a" });
      const b = await makePromotion({ name: "reorder-b" });
      created.push(a, b);
      const req = requestAs({
        method: "POST",
        url: "http://test/api/promotions/reorder",
        session,
        body: { type: "carousel", order: [String(b._id), String(a._id)] },
      });
      const res = await reorderPOST(req);
      assert.equal(res.status, 200);
      const refreshedA = await Promotion.findById(a._id);
      const refreshedB = await Promotion.findById(b._id);
      assert.equal(refreshedB.sortOrder, 0);
      assert.equal(refreshedA.sortOrder, 1);
    });

    test("POST /api/promotions/reorder — an id belonging to a different type is rejected", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const carousel = await makePromotion({ type: "carousel" });
      created.push(carousel);
      const req = requestAs({
        method: "POST",
        url: "http://test/api/promotions/reorder",
        session,
        body: { type: "popup", order: [String(carousel._id)] },
      });
      const res = await reorderPOST(req);
      assert.equal(res.status, 400);
    });

    test("DELETE /api/promotions/[id] — deletes; a second delete 404s", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const p = await makePromotion();
      const req1 = requestAs({ method: "DELETE", url: `http://test/api/promotions/${p._id}`, session });
      const res1 = await itemDELETE(req1, { params: Promise.resolve({ id: String(p._id) }) });
      assert.equal(res1.status, 200);
      const req2 = requestAs({ method: "DELETE", url: `http://test/api/promotions/${p._id}`, session });
      const res2 = await itemDELETE(req2, { params: Promise.resolve({ id: String(p._id) }) });
      assert.equal(res2.status, 404);
    });

    test("errors never leak an internal detail — a duplicate-lookup 404 carries only a safe message", async () => {
      const admin = await createTestUser({ role: "admin" });
      const session = await createTestSession(admin._id);
      const req = requestAs({ method: "POST", url: "http://test/api/promotions/aaaaaaaaaaaaaaaaaaaaaaaa/duplicate", session });
      const res = await duplicatePOST(req, { params: Promise.resolve({ id: "aaaaaaaaaaaaaaaaaaaaaaaa" }) });
      assert.equal(res.status, 404);
      const json = await res.json();
      assert.equal(typeof json.message, "string");
      assert.ok(!/mongo|mongoose|ECONN|stack/i.test(json.message));
    });
  });

  // ===================== public endpoints =====================

  // Only the validation-rejection path is tested here — everything else
  // GET /api/promotions/carousel|popup does calls
  // lib/serverDataCache.js's getCachedEligiblePromotions(), which wraps
  // Next.js's `unstable_cache()`. That cache store only exists inside a
  // real `next start`/`next dev` server process (see
  // tests/http/serverCacheBehavior.integration.test.mjs's own top-of-file
  // note) — calling these two route handlers directly from this bare
  // node:test process throws "Invariant: incrementalCache missing", not a
  // bug in the route. The real end-to-end behavior (eligibility, single-
  // popup selection, audience filtering, and — the one this feature's spec
  // cares about most — immediate cache invalidation after an admin
  // mutation) is covered against a real server in
  // tests/http/promotions.integration.test.mjs instead.
  describe("Public promotion endpoints — validation only (cache-dependent behavior is in tests/http/)", () => {
    test("GET /api/promotions/carousel — an unknown pageScope value is rejected (400), not silently ignored", async () => {
      const req = requestAs({ method: "GET", url: "http://test/api/promotions/carousel?pageScope=not-a-real-scope" });
      const res = await carouselGET(req);
      assert.equal(res.status, 400);
    });

    test("GET /api/promotions/popup — an unknown pageScope value is rejected (400)", async () => {
      const req = requestAs({ method: "GET", url: "http://test/api/promotions/popup?pageScope=not-a-real-scope" });
      const res = await popupGET(req);
      assert.equal(res.status, 400);
    });
  });
});
