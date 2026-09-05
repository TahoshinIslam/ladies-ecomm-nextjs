// Phase 4B — client-side checkout-intent tests.
//
// No component-mounting framework (jsdom/@testing-library) is installed,
// and the Phase 4B closure prompt explicitly says not to add one for this
// closure. Instead, per that prompt's own escape hatch: the checkout-intent
// state machine itself was extracted out of views/CheckoutPage.jsx into
// lib/checkoutIntent.js specifically so it's a plain, dependency-free
// module this file can import and exercise directly — every test below
// calls the REAL production functions CheckoutPage.jsx itself calls, not a
// reimplementation.
//
// The two things that genuinely need something OTHER than the pure
// state-machine module:
//   - "does the Idempotency-Key/CSRF/credentials reach a real network
//     request" — answered by dispatching the REAL Redux store + the REAL
//     RTK Query `createOrder` endpoint (store/index.js, store/shopApi.js),
//     with `global.fetch` mocked at the network boundary. Node 22 has
//     native fetch/Headers/Request/Response, so this needs no DOM.
//   - "is the double-click guard itself correct" — answered by testing
//     `createSubmitLock()`, the exact same lock object CheckoutPage.jsx's
//     `submitLockRef` holds (see views/CheckoutPage.jsx's handlePlaceOrder).
//
// A minimal in-memory Storage-shaped fake stands in for
// window.sessionStorage — this is the "minimal sessionStorage/browser
// shim" the closure prompt asks for, not a DOM polyfill.

import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

// store/apiSlice.js imports `sonner` for its session-expiry toast. sonner
// itself tries to inject a <style> tag into `document` at module-load time
// — real, harmless behavior in a browser, but this file intentionally runs
// with no DOM (see the file header), so it's mocked out at the module
// boundary via node:test's module mocking rather than given an
// ever-growing fake `document`. This does not touch any PRODUCTION code
// path — sonner's toast calls are only reached here on a 401, which none
// of these tests trigger.
mock.module("sonner", {
  namedExports: { toast: { success: () => {}, error: () => {}, info: () => {} } },
});

// store/apiSlice.js's baseUrl falls back to the relative "/api" when
// NEXT_PUBLIC_API_URL isn't set — correct for a real browser (resolved
// against the page origin), but RTK Query's fetchBaseQuery constructs a
// real `Request` object internally, and Node's `Request`/`URL` have no
// notion of "resolve against the current page" to fall back on. An
// absolute base makes this identical to how a real deployed origin works.
process.env.NEXT_PUBLIC_API_URL = "http://localhost:3000";

import {
  CHECKOUT_INTENT_VERSION,
  computeCheckoutFingerprint,
  resolveCheckoutIntent,
  readStoredIntent,
  writeStoredIntent,
  clearStoredIntent,
  markOrderCreated,
  generateIdempotencyKey,
  createSubmitLock,
} from "../lib/checkoutIntent.js";

// A plain, dependency-free Storage-shaped fake — get/setItem/removeItem
// only, backed by a Map. Real sessionStorage's actual behavior (per-origin
// isolation, throwing in some sandboxed contexts) is exactly what
// lib/checkoutIntent.js's own try/catch guards are for; this fake only
// needs to satisfy the same three-method interface it's called through.
function makeFakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

const baseFields = {
  items: [{ productId: "p1", variantId: "v1", quantity: 1 }],
  shippingAddress: { fullName: "A", phone: "0100000000", street: "St", city: "Dhaka", postalCode: "1200", country: "Bangladesh" },
};

describe("lib/checkoutIntent.js — checkout-intent state machine", () => {
  test("1. resolving a fresh intent synchronously produces a valid key with no await needed", () => {
    const storage = makeFakeStorage();
    const fingerprint = computeCheckoutFingerprint(baseFields);
    const intent = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint });
    assert.ok(intent);
    assert.match(intent.idempotencyKey, /^[0-9a-f-]{16,}$/i, "a real crypto.randomUUID()-shaped key");
    assert.equal(intent.orderId, null);
    assert.equal(intent.state, "prepared");
  });

  test("7/8. an ambiguous network failure (or a lost response) before order creation preserves the SAME key on the next resolve", () => {
    const storage = makeFakeStorage();
    const fingerprint = computeCheckoutFingerprint(baseFields);
    const first = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint });
    // Simulate: createOrder() was dispatched and then the network call
    // failed/timed out/its response was lost — markOrderCreated() is
    // deliberately never called, so the intent still has no orderId.
    const second = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint });
    assert.equal(second.idempotencyKey, first.idempotencyKey, "the retry must reuse the exact same Idempotency-Key");
  });

  test("9. once markOrderCreated() runs, the persisted intent carries the returned orderId", () => {
    const storage = makeFakeStorage();
    const fingerprint = computeCheckoutFingerprint(baseFields);
    const intent = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint });
    const updated = markOrderCreated(storage, intent, "order-abc");
    assert.equal(updated.orderId, "order-abc");
    const reread = readStoredIntent(storage, "user-1");
    assert.equal(reread.orderId, "order-abc");
    assert.equal(reread.idempotencyKey, intent.idempotencyKey, "the key itself is unchanged by recording the orderId");
  });

  test("10/13. an order created but a lost/failed COD response still resolves to the SAME orderId on retry (COD retry, not create-order, is what must run next)", () => {
    const storage = makeFakeStorage();
    const fingerprint = computeCheckoutFingerprint(baseFields);
    const intent = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint });
    markOrderCreated(storage, intent, "order-abc");
    // COD failed/timed out — the intent (with its orderId) is deliberately
    // left untouched (clearStoredIntent is never called on failure).
    const resumed = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint });
    assert.equal(resumed.orderId, "order-abc");
  });

  test("11. the state resolveCheckoutIntent returns after an order exists is exactly what tells the real handler to skip POST /api/orders and call COD only", () => {
    const storage = makeFakeStorage();
    const fingerprint = computeCheckoutFingerprint(baseFields);
    const intent = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint });
    markOrderCreated(storage, intent, "order-abc");
    const resumed = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint });
    // views/CheckoutPage.jsx's handlePlaceOrder branches on exactly this:
    // `if (!intent.orderId) { await createOrder(...); ... }` — an orderId
    // already present means that branch (and its address/cart validation)
    // is skipped entirely and only codCreate(orderId) runs.
    assert.equal(!!resumed.orderId, true, "the branch that would call POST /api/orders again must be skipped");
  });

  test("12. reload recovery: a fresh resolve call (simulating a new page load) restores the persisted orderId even with no fingerprint available yet", () => {
    const storage = makeFakeStorage();
    // Simulate: the page was reloaded mid-checkout, after Order creation
    // already cleared the server cart, so there IS no current fingerprint
    // to compute yet (no items) — this must still resume the order.
    const priorFingerprint = computeCheckoutFingerprint(baseFields);
    const intent = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint: priorFingerprint });
    markOrderCreated(storage, intent, "order-abc");

    const onReload = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint: null });
    assert.ok(onReload, "a resumable (orderId-bearing) intent must be returned even with fingerprint: null");
    assert.equal(onReload.orderId, "order-abc");
  });

  test("14. clearing the intent after a full success leaves nothing behind for the next checkout", () => {
    const storage = makeFakeStorage();
    const fingerprint = computeCheckoutFingerprint(baseFields);
    const intent = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint });
    markOrderCreated(storage, intent, "order-abc");
    clearStoredIntent(storage, "user-1");
    assert.equal(readStoredIntent(storage, "user-1"), null);
  });

  test("15. a meaningful payload change BEFORE order creation mints a new key", () => {
    const storage = makeFakeStorage();
    const fingerprintA = computeCheckoutFingerprint(baseFields);
    const intentA = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint: fingerprintA });

    const fingerprintB = computeCheckoutFingerprint({
      ...baseFields,
      items: [{ productId: "p1", variantId: "v1", quantity: 2 }],
    });
    const intentB = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint: fingerprintB });
    assert.notEqual(intentB.idempotencyKey, intentA.idempotencyKey);
  });

  test("16. a payload/cart change AFTER order creation does NOT mint a new key or lose the orderId", () => {
    const storage = makeFakeStorage();
    const fingerprintA = computeCheckoutFingerprint(baseFields);
    const intent = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint: fingerprintA });
    markOrderCreated(storage, intent, "order-abc");

    // The cart is now empty (the order's own creation cleared it server-
    // side) — a fresh fingerprint computed against the current (empty)
    // cart would differ from fingerprintA, but that must not matter once
    // an orderId is already recorded.
    const emptyCartFingerprint = computeCheckoutFingerprint({ ...baseFields, items: [] });
    const resumed = resolveCheckoutIntent({ storage, userId: "user-1", fingerprint: emptyCartFingerprint });
    assert.equal(resumed.idempotencyKey, intent.idempotencyKey);
    assert.equal(resumed.orderId, "order-abc");
  });

  test("17. different users never share a stored intent, even on the same underlying storage", () => {
    const storage = makeFakeStorage();
    const fingerprint = computeCheckoutFingerprint(baseFields);
    const intentA = resolveCheckoutIntent({ storage, userId: "user-A", fingerprint });
    const intentB = resolveCheckoutIntent({ storage, userId: "user-B", fingerprint });
    assert.notEqual(intentA.idempotencyKey, intentB.idempotencyKey);
    markOrderCreated(storage, intentA, "order-for-A");
    assert.equal(readStoredIntent(storage, "user-B").orderId, null, "user B's intent must be untouched by user A's order");
  });

  test("18. malformed sessionStorage JSON fails safe (treated as nothing stored) and self-heals the bad entry", () => {
    const storage = makeFakeStorage();
    storage.setItem("tahos:checkoutIntent:user-1", "{not valid json");
    assert.equal(readStoredIntent(storage, "user-1"), null);
    assert.equal(storage.getItem("tahos:checkoutIntent:user-1"), null, "the corrupt entry must be removed, not left to fail again next time");
  });

  test("19. a stored record from an obsolete schema version fails safe and is removed", () => {
    const storage = makeFakeStorage();
    storage.setItem(
      "tahos:checkoutIntent:user-1",
      JSON.stringify({ version: CHECKOUT_INTENT_VERSION + 1, userId: "user-1", idempotencyKey: "x".repeat(20), fingerprint: "f", orderId: null }),
    );
    assert.equal(readStoredIntent(storage, "user-1"), null);
    assert.equal(storage.getItem("tahos:checkoutIntent:user-1"), null);
  });

  test("a record belonging to a different userId (however it got there) fails safe", () => {
    const storage = makeFakeStorage();
    storage.setItem(
      "tahos:checkoutIntent:user-1",
      JSON.stringify({ version: CHECKOUT_INTENT_VERSION, userId: "someone-else", idempotencyKey: "x".repeat(20), fingerprint: "f", orderId: null }),
    );
    assert.equal(readStoredIntent(storage, "user-1"), null);
  });

  test("with no storage available (SSR / storage-denying sandbox), every function is a safe no-op — resolution still works in-memory for this one call", () => {
    assert.equal(readStoredIntent(null, "user-1"), null);
    assert.doesNotThrow(() => writeStoredIntent(null, { userId: "user-1" }));
    assert.doesNotThrow(() => clearStoredIntent(null, "user-1"));
    const intent = resolveCheckoutIntent({ storage: null, userId: "user-1", fingerprint: "f" });
    assert.ok(intent?.idempotencyKey, "a key is still produced for this call even with no persistence available");
  });

  test("with no fingerprint and no resumable order, resolveCheckoutIntent returns null (nothing to submit yet)", () => {
    const storage = makeFakeStorage();
    assert.equal(resolveCheckoutIntent({ storage, userId: "user-1", fingerprint: null }), null);
  });

  test("computeCheckoutFingerprint is order-insensitive for line items but sensitive to quantity/address/coupon/notes", () => {
    const a = computeCheckoutFingerprint({
      items: [{ productId: "p1", variantId: "v1", quantity: 1 }, { productId: "p2", variantId: "v2", quantity: 3 }],
      shippingAddress: baseFields.shippingAddress,
    });
    const b = computeCheckoutFingerprint({
      items: [{ productId: "p2", variantId: "v2", quantity: 3 }, { productId: "p1", variantId: "v1", quantity: 1 }],
      shippingAddress: baseFields.shippingAddress,
    });
    assert.equal(a, b, "item submission order alone must not change the fingerprint");

    const c = computeCheckoutFingerprint({ ...baseFields, notes: "please gift wrap" });
    assert.notEqual(a, c);
  });
});

describe("createSubmitLock() — the exact double-click guard CheckoutPage.jsx holds in submitLockRef", () => {
  test("20. two synchronous acquire attempts in the same event turn cannot both succeed; release() allows a later, separate submission", () => {
    const lock = createSubmitLock();
    assert.equal(lock.tryAcquire(), true, "the first click acquires the lock");
    assert.equal(lock.tryAcquire(), false, "a second click in the same turn is rejected — no second network request fires");
    lock.release();
    assert.equal(lock.tryAcquire(), true, "after release, a genuinely later submission is allowed");
  });
});

// ---------------------------------------------------------------------------
// Real RTK Query network-boundary tests: the REAL Redux store
// (store/index.js) and the REAL createOrder mutation
// (store/shopApi.js's orderEndpoints), with global.fetch mocked as the
// only stand-in — proves the Idempotency-Key set by CheckoutPage.jsx
// actually reaches the Request the browser would send, alongside the
// pre-existing CSRF/credentials contract Phase 2/3 already established.
// ---------------------------------------------------------------------------
// fetchBaseQuery constructs a real `Request` instance internally and calls
// `fetch(request)` with it (not `fetch(url, init)`) — so the fetch mocks
// below capture whichever shape actually arrives and normalize it into one
// real `Request` to inspect, rather than assuming an { url, init } pair.
async function asRequest(input, init) {
  return input instanceof Request ? input : new Request(input, init);
}

describe("real RTK Query createOrder mutation — Idempotency-Key reaches the real Request", () => {
  test("2-5. Idempotency-Key header, credentials:'include', X-CSRF-Token, and the absence of any Authorization/Bearer header all reach the real fetch call", async () => {
    // Minimal browser shims — NOT a DOM: apiSlice.js's readCsrfCookie()
    // only ever reads `document.cookie`, guarded by `typeof document ===
    // "undefined"`. This is the smallest thing that satisfies that read.
    const originalDocument = globalThis.document;
    const originalFetch = globalThis.fetch;
    globalThis.document = { cookie: "tahos_csrf=real-csrf-token-value" };

    let captured = null;
    globalThis.fetch = async (input, init) => {
      captured = await asRequest(input, init);
      return new Response(JSON.stringify({ success: true, order: { _id: "order-xyz", status: "pending" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const { default: store } = await import("../store/index.js");
      const { shopApi } = await import("../store/shopApi.js");

      const idempotencyKey = generateIdempotencyKey();
      const result = await store.dispatch(
        shopApi.endpoints.createOrder.initiate({
          idempotencyKey,
          items: [{ productId: "p1", variantId: "v1", quantity: 1 }],
          shippingAddress: baseFields.shippingAddress,
        }),
      );

      assert.ok(result.data && !result.error, "the real RTK Query mutation must resolve successfully against the mocked fetch");
      assert.equal(result.data.order._id, "order-xyz");
      assert.ok(captured, "the real fetch boundary must have been called");
      assert.match(captured.url, /\/orders$/);
      assert.equal(captured.method, "POST");

      assert.equal(captured.headers.get("idempotency-key"), idempotencyKey, "the real Request must carry the Idempotency-Key header");
      assert.equal(captured.headers.get("x-csrf-token"), "real-csrf-token-value", "the existing CSRF contract must remain intact");
      assert.ok(!captured.headers.get("authorization"), "no Authorization/Bearer header — this app is cookie-session-based, not token-based");
      assert.equal(captured.credentials, "include", "credentials:'include' must remain set so the session cookie is actually sent");

      const body = JSON.parse(await captured.clone().text());
      assert.ok(!("idempotencyKey" in body), "idempotencyKey must be sent ONLY as a header, never in the JSON body");
    } finally {
      globalThis.document = originalDocument;
      globalThis.fetch = originalFetch;
    }
  });

  test("a request with no idempotencyKey supplied sends no Idempotency-Key header (the real endpoint never invents one)", async () => {
    const originalFetch = globalThis.fetch;
    let captured = null;
    globalThis.fetch = async (input, init) => {
      captured = await asRequest(input, init);
      return new Response(JSON.stringify({ success: false, message: "Idempotency-Key header is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      const { default: store } = await import("../store/index.js");
      const { shopApi } = await import("../store/shopApi.js");
      await store.dispatch(
        shopApi.endpoints.createOrder.initiate({
          items: [{ productId: "p1", variantId: "v1", quantity: 1 }],
          shippingAddress: baseFields.shippingAddress,
        }),
      );
      assert.ok(captured, "the real fetch boundary must have been called even for the eventual 400");
      assert.ok(!captured.headers.get("idempotency-key"), "no header is sent when the caller supplies no key — this is a client-composition contract, not a server bypass");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
