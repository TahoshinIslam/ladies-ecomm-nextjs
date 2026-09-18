// Admin-promotions feature — real end-to-end behavior against a real
// `next start` server (see tests/http/serverCacheBehavior.integration.test
// .mjs's own top-of-file note on why: GET /api/promotions/carousel|popup
// both go through lib/serverDataCache.js's getCachedEligiblePromotions(),
// an `unstable_cache()` wrapper whose cache store only exists inside a
// real Next.js server process — not testable via a direct route-handler
// import in the bare node:test core suite, where the rest of this
// feature's tests live (tests/promotions.test.mjs).
//
// The one thing this file exists specifically to prove with REAL evidence
// is the feature spec's own core promise: "An admin change must appear on
// the next storefront request without waiting for the TTL."
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestUser, deleteRows } from "../helpers/testDb.mjs";

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
    ? skipReason || "database not reachable — check DB_NAME/DB_HOST in .env.test (see .env.test.example)"
    : false;

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(response) {
    const lines = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const raw of lines) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  get(name) {
    return this.cookies.get(name);
  }
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

describe("Admin promotions — real-server cache and eligibility behavior", { skip }, () => {
  let adminJar;
  let createdIds = [];

  before(async () => {
    const admin = await createTestUser({ role: "admin" });
    adminJar = await loginAs(admin.email, "TestPassword123!");
  });

  after(async () => {
    if (createdIds.length) await deleteRows("promotions", "id", createdIds);
    await disconnectTestDb();
  });

  test("a newly-created active carousel promotion appears on the very next GET /api/promotions/carousel — no TTL wait", async () => {
    const name = `http-suite-carousel-${Date.now()}`;
    const createRes = await adminReq(adminJar, "/api/promotions", {
      method: "POST",
      body: { name, type: "carousel", status: "active", desktopImage: "https://example.test/x.png", targetType: "none", pageScope: "home" },
    });
    assert.equal(createRes.status, 201);
    const { promotion } = await createRes.json();
    createdIds.push(promotion._id);

    const publicRes = await fetch(`${BASE_URL}/api/promotions/carousel?pageScope=home`);
    assert.equal(publicRes.status, 200);
    const { promotions } = await publicRes.json();
    assert.ok(promotions.some((p) => p.id === promotion._id), "a brand-new active promotion must be visible immediately, not after a TTL");
  });

  test("pausing a promotion in admin removes it from the public carousel on the very next request", async () => {
    const name = `http-suite-pause-${Date.now()}`;
    const createRes = await adminReq(adminJar, "/api/promotions", {
      method: "POST",
      body: { name, type: "carousel", status: "active", desktopImage: "https://example.test/x.png", targetType: "none", pageScope: "home" },
    });
    const { promotion } = await createRes.json();
    createdIds.push(promotion._id);

    const beforePause = await fetch(`${BASE_URL}/api/promotions/carousel?pageScope=home`).then((r) => r.json());
    assert.ok(beforePause.promotions.some((p) => p.id === promotion._id));

    const pauseRes = await adminReq(adminJar, `/api/promotions/${promotion._id}`, { method: "PUT", body: { status: "paused" } });
    assert.equal(pauseRes.status, 200);

    const afterPause = await fetch(`${BASE_URL}/api/promotions/carousel?pageScope=home`).then((r) => r.json());
    assert.ok(!afterPause.promotions.some((p) => p.id === promotion._id), "a paused promotion must disappear immediately, not after a TTL");
  });

  test("GET /api/promotions/popup returns at most one promotion, the higher-priority one", async () => {
    const suffix = Date.now();
    const low = await adminReq(adminJar, "/api/promotions", {
      method: "POST",
      body: { name: `http-popup-low-${suffix}`, type: "popup", status: "active", desktopImage: "https://example.test/x.png", targetType: "none", pageScope: "home", priority: 0 },
    }).then((r) => r.json());
    const high = await adminReq(adminJar, "/api/promotions", {
      method: "POST",
      body: { name: `http-popup-high-${suffix}`, type: "popup", status: "active", desktopImage: "https://example.test/x.png", targetType: "none", pageScope: "home", priority: 9 },
    }).then((r) => r.json());
    createdIds.push(low.promotion._id, high.promotion._id);

    const publicRes = await fetch(`${BASE_URL}/api/promotions/popup?pageScope=home`);
    const { promotion } = await publicRes.json();
    assert.equal(promotion.id, high.promotion._id);
  });

  test("audience 'customer' popup is served to a logged-in customer but not to a guest", async () => {
    const name = `http-audience-${Date.now()}`;
    const createRes = await adminReq(adminJar, "/api/promotions", {
      method: "POST",
      body: {
        name,
        type: "popup",
        status: "active",
        desktopImage: "https://example.test/x.png",
        targetType: "none",
        pageScope: "home",
        audience: "customer",
        priority: 100,
      },
    });
    const { promotion } = await createRes.json();
    createdIds.push(promotion._id);

    const guestRes = await fetch(`${BASE_URL}/api/promotions/popup?pageScope=home`).then((r) => r.json());
    assert.notEqual(guestRes.promotion?.id, promotion._id);

    const customer = await createTestUser({ role: "customer" });
    const customerJar = await loginAs(customer.email, "TestPassword123!");
    const customerRes = await req(customerJar, "/api/promotions/popup?pageScope=home").then((r) => r.json());
    assert.equal(customerRes.promotion?.id, promotion._id);
  });

  test("a deleted promotion is gone from the public carousel on the very next request", async () => {
    const name = `http-delete-${Date.now()}`;
    const createRes = await adminReq(adminJar, "/api/promotions", {
      method: "POST",
      body: { name, type: "carousel", status: "active", desktopImage: "https://example.test/x.png", targetType: "none", pageScope: "home" },
    });
    const { promotion } = await createRes.json();

    const deleteRes = await adminReq(adminJar, `/api/promotions/${promotion._id}`, { method: "DELETE" });
    assert.equal(deleteRes.status, 200);

    const publicRes = await fetch(`${BASE_URL}/api/promotions/carousel?pageScope=home`).then((r) => r.json());
    assert.ok(!publicRes.promotions.some((p) => p.id === promotion._id));
  });
});
