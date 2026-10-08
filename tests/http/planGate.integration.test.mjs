// Public checkout follows the MERCHANT's plan — through the real `next start` process the tests/http harness spins up: real cookie
// authentication, real CSRF, real Idempotency-Key header. tests/planGate.test.mjs proves the logic against the route handler; this
// proves the running application refuses a store whose plan does not include online sales, takes the same order once the plan does,
// and that nothing is written on the refusal. The plan is changed under the running server, so the answer is shown to follow the
// organization's CURRENT entitlement with no restart and no cache.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  createTestProduct,
  deleteRows,
  rawQuery,
} from "../helpers/testDb.mjs";

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
  const cookieHeader = jar.header();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (method !== "GET") headers.set("origin", BASE_URL);
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  jar.absorb(res);
  return res;
}

async function registerNewUser() {
  const jar = new CookieJar();
  const suffix = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const email = `httpidem_${suffix}@example.invalid`;
  const fakeClientIp = `198.51.100.${crypto.randomInt(1, 255)}`;
  const res = await req(jar, "/api/users/register", {
    method: "POST",
    body: { name: `HTTP Idempotency Test ${suffix}`, email, password: "RealHttpTest123!" },
    extraHeaders: { "x-forwarded-for": fakeClientIp },
  });
  const json = await res.json();
  return { jar, email, userId: json.user._id };
}

function freshKey() {
  return crypto.randomBytes(16).toString("hex");
}

function orderBody(product, overrides = {}) {
  return {
    items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: 1 }],
    shippingAddress: { fullName: "HTTP Test Buyer", phone: "0100000000", street: "1 Test St", city: "Dhaka", postalCode: "1200", country: "Bangladesh" },
    ...overrides,
  };
}

async function createOrderReq(jar, product, { idempotencyKey, body, omitKey = false } = {}) {
  const headers = {};
  if (!omitKey) headers["idempotency-key"] = idempotencyKey || freshKey();
  return req(jar, "/api/orders", {
    method: "POST",
    body: body || orderBody(product),
    extraHeaders: { "x-csrf-token": jar.get("tahos_csrf"), ...headers },
  });
}

const TEST_PLAN = "plan_test000000000000000001"; // includes mod.storefront (scripts/setupTestDb.mjs)
const NO_ONLINE_PLAN = "plan_test_noonline0000000002"; // a plan with no modules, like Free
const ORG = process.env.STORE_ORGANIZATION_ID;
const setPlan = (planId) => rawQuery("UPDATE subscriptions SET plan_id = ? WHERE organization_id = ?", [planId, ORG]);
const orderCount = async () => Number((await rawQuery("SELECT COUNT(*) AS n FROM orders WHERE organization_id = ?", [ORG]))[0].n);

describe("Real HTTP: public checkout follows the merchant's plan", { skip }, () => {
  before(async () => {
    await rawQuery("INSERT INTO plans (id, name, slug, description, price_monthly, currency) VALUES (?, 'No online http', 'no-online-http', 'Test fixture', 0, 'USD') ON DUPLICATE KEY UPDATE name = VALUES(name)", [NO_ONLINE_PLAN]);
  });

  after(async () => {
    await setPlan(TEST_PLAN);
    await rawQuery("DELETE FROM plans WHERE id = ?", [NO_ONLINE_PLAN]);
    await disconnectTestDb();
  });

  test("a store on a plan without online sales gets 403 over real HTTP, and nothing is written; after the upgrade the same request is accepted", async () => {
    const { jar, userId } = await registerNewUser();
    const product = await createTestProduct({ stock: 5 });
    try {
      await setPlan(NO_ONLINE_PLAN);
      const before = await orderCount();
      const refused = await createOrderReq(jar, product);
      assert.equal(refused.status, 403, "refused because of the plan");
      assert.equal(await orderCount(), before, "no order was written");

      await setPlan(TEST_PLAN);
      const accepted = await createOrderReq(jar, product);
      assert.equal(accepted.status, 201, "the same store, upgraded, takes the order on the very next request");
      assert.equal(await orderCount(), before + 1);

      await setPlan(NO_ONLINE_PLAN);
      const again = await createOrderReq(jar, product);
      assert.equal(again.status, 403, "and a downgrade refuses again at once");
    } finally {
      await setPlan(TEST_PLAN);
      await deleteRows("orders", "customer_id", userId);
      await deleteRows("customers", "id", userId);
      await deleteRows("products", "id", product._id);
    }
  });
});
