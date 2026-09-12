// Performance audit — Section G: granular RTK Query cache tags for Orders.
// store/shopApi.js's getAllOrders used to provide only a bare "Order"
// string tag shared by every order everywhere; updateOrderStatus/
// cancelOrder invalidated that same bare tag — meaning a single order's
// status change forced EVERY open admin session's EVERY orders-list
// query (any page, any filter) to refetch, and hooks/useAdminEventStream.js's
// SSE handler broadcast the identical broad invalidation to every OTHER
// open admin session too. This file proves the fix: per-row + LIST tags,
// mutations that only touch their own row + LIST, and an SSE handler that
// uses the event payload's own orderId instead of a blanket tag.
//
// Same scope/honesty boundary as tests/clientAuthIntegration.test.mjs (no
// jsdom/RTL installed): dispatches the REAL RTK Query endpoints against a
// real configureStore() with a mocked fetch. hooks/useAdminEventStream.js
// itself (a React hook using EventSource) is not mounted — its pure
// payload-to-tags mapping (tagsForEvent) is exported specifically so it's
// directly testable without mounting the hook, matching this file's own
// established "verify the underlying logic directly" pattern.

import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";

let moduleMockUsable = false;
try {
  const probe = await mock.module("node:os", { namedExports: { hostname: () => "probe" } });
  probe.restore();
  moduleMockUsable = true;
} catch {
  moduleMockUsable = false;
}
const skip = moduleMockUsable ? false : "mock.module unavailable in this Node version — run with --experimental-test-module-mocks (see package.json's test script)";

if (moduleMockUsable) {
  await mock.module("sonner", {
    namedExports: {
      toast: { error: () => {}, warning: () => {}, message: () => {}, success: () => {} },
    },
  });
}

globalThis.document = { cookie: "" };
process.env.NEXT_PUBLIC_API_URL = "http://localhost:3000";
globalThis.window = {
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
};

const order = (id, status, overrides = {}) => ({
  _id: id,
  status,
  items: [],
  total: 100,
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("Admin Orders — granular RTK Query cache tags", { skip }, () => {
  let store, apiSlice, shopApi, tagsForEvent;
  let fetchCalls;

  before(async () => {
    ({ default: store } = await import("../store/index.js"));
    ({ apiSlice } = await import("../store/apiSlice.js"));
    ({ shopApi } = await import("../store/shopApi.js"));
    ({ tagsForEvent } = await import("../hooks/useAdminEventStream.js"));
  });

  function stubFetch(responseFactory) {
    fetchCalls = [];
    globalThis.fetch = async (input, init) => {
      const isRequestObj = typeof Request !== "undefined" && input instanceof Request;
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method ?? (isRequestObj ? input.method : "GET");
      fetchCalls.push({ url, method });
      const built = responseFactory(url, method);
      return new Response(JSON.stringify(built.body ?? {}), {
        status: built.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    };
  }

  function resetCache() {
    store.dispatch(apiSlice.util.resetApiState());
  }

  // ---------- Cache tag shape (list + mutations) ----------

  test("updating one order's status refetches ONLY that order's own cached detail query, never an unrelated order's", async () => {
    resetCache();
    stubFetch((url) => {
      if (/\/orders\/order-a\/status$/.test(url)) return { body: { success: true, order: order("order-a", "shipped") } };
      if (/\/orders\/order-a$/.test(url)) return { body: { success: true, order: order("order-a", "pending") } };
      if (/\/orders\/order-b$/.test(url)) return { body: { success: true, order: order("order-b", "pending") } };
      return { status: 404, body: { success: false } };
    });

    // Deliberately not unsubscribed — an active subscription is exactly
    // what makes RTK Query automatically refetch a query the moment its
    // tag is invalidated (it doesn't wait for someone to call .initiate()
    // again), which is what the next dispatch below actually exercises.
    await store.dispatch(shopApi.endpoints.getOrder.initiate("order-a"));
    await store.dispatch(shopApi.endpoints.getOrder.initiate("order-b"));
    assert.equal(fetchCalls.length, 2, "two distinct order detail queries must each fetch once");

    await store.dispatch(shopApi.endpoints.updateOrderStatus.initiate({ id: "order-a", status: "shipped" }));

    // The mutation's own PUT is one new call; RTK Query's automatic
    // refetch-on-invalidation for order-a's still-subscribed query is a
    // second — both happen as part of this same dispatch resolving, not
    // later. order-b must never appear again at all.
    const callsSinceInitialGets = fetchCalls.slice(2).map((c) => `${c.method} ${c.url}`);
    assert.ok(
      callsSinceInitialGets.some((c) => /^GET .*\/orders\/order-a$/.test(c)),
      "order-a's own detail query must automatically refetch — its tag was invalidated",
    );
    assert.ok(
      !fetchCalls.slice(2).some((c) => /\/orders\/order-b$/.test(c.url)),
      "order-b's detail query must NEVER refetch — it shares no tag with order-a's update",
    );
  });

  test("an order status update still invalidates a cached orders LIST query (status changes can move a row across a filtered view's boundary)", async () => {
    resetCache();
    let listFetches = 0;
    stubFetch((url) => {
      if (/\/orders\/order-a\/status$/.test(url)) return { body: { success: true, order: order("order-a", "shipped") } };
      if (/^https?:\/\/[^/]+\/api\/orders\?/.test(url)) {
        listFetches += 1;
        return { body: { success: true, orders: [order("order-a", "pending")], total: 1, pages: 1 } };
      }
      return { status: 404, body: { success: false } };
    });

    await store.dispatch(shopApi.endpoints.getAllOrders.initiate({ page: 1, limit: 20 }));
    assert.equal(listFetches, 1);

    await store.dispatch(shopApi.endpoints.updateOrderStatus.initiate({ id: "order-a", status: "shipped" }));
    await store.dispatch(shopApi.endpoints.getAllOrders.initiate({ page: 1, limit: 20 }));
    assert.equal(listFetches, 2, "the list query must refetch after an order update — list membership can change under a status filter");
  });

  // ---------- SSE payload-to-tags mapping (hooks/useAdminEventStream.js) ----------

  test("tagsForEvent maps ORDER_STATUS_CHANGED/ORDER_CANCELLED to the specific order's own tag + LIST when the payload carries orderId", () => {
    assert.deepEqual(tagsForEvent("ORDER_STATUS_CHANGED", { orderId: "abc123" }), [
      { type: "Order", id: "abc123" },
      { type: "Order", id: "LIST" },
    ]);
    assert.deepEqual(tagsForEvent("ORDER_CANCELLED", { orderId: "xyz" }), [
      { type: "Order", id: "xyz" },
      { type: "Order", id: "LIST" },
    ]);
  });

  test("tagsForEvent maps NEW_ORDER to just the LIST tag (a new order has no existing per-id cache entry to target)", () => {
    assert.deepEqual(tagsForEvent("NEW_ORDER", { orderId: "new-1" }), [{ type: "Order", id: "LIST" }]);
  });

  test("a malformed/incomplete event (missing orderId) fails safe — falls back to the broad Order tag rather than silently invalidating nothing", () => {
    assert.deepEqual(tagsForEvent("ORDER_STATUS_CHANGED", {}), ["Order"]);
    assert.deepEqual(tagsForEvent("ORDER_CANCELLED", { orderNumber: "1234" }), ["Order"]);
  });

  test("an unknown/unhandled event type returns no tags rather than throwing", () => {
    assert.deepEqual(tagsForEvent("SOMETHING_UNKNOWN", {}), []);
  });

  // ---------- Scope boundary: this is a client-cache-only change ----------

  test("this change touches only cache-tag shape — the same real fetch/mutation calls (method, url) fire as before, no new endpoint or auth behavior introduced", async () => {
    resetCache();
    stubFetch((url) => {
      if (/\/orders\/order-a\/status$/.test(url)) return { body: { success: true, order: order("order-a", "shipped") } };
      return { status: 404, body: { success: false } };
    });
    await store.dispatch(shopApi.endpoints.updateOrderStatus.initiate({ id: "order-a", status: "shipped" }));
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].method, "PUT");
    assert.match(fetchCalls[0].url, /\/orders\/order-a\/status$/);
  });
});
