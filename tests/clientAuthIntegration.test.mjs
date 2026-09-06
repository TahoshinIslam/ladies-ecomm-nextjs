// Phase 2, section D: the changed CLIENT API layer — store/apiSlice.js's
// prepareHeaders()/credentials config, store/authSlice.js's reducer, and
// the underlying RTK Query endpoints hooks/useAuthBoot.js and
// hooks/useCart.js's mergeGuestCartAfterLogin() build on.
//
// Scope and honesty boundary (explicit, per instruction): this file tests
// the REAL Redux store/reducer and the REAL RTK Query endpoint definitions
// by dispatching them against a real `configureStore()` with a mocked
// `fetch` — no component-testing framework (jsdom/RTL) is installed for
// this. It does NOT render hooks/useAuthBoot.js or hooks/useCart.js as
// React hooks, and does not claim to. Where a requirement is specifically
// about the REACT HOOK's own wiring (e.g. "useAuthBoot calls useMeQuery
// unconditionally"), this file verifies it two ways: (a) a direct source
// characterization of the hook file confirming no `skip` option is passed,
// and (b) real dispatch evidence that the underlying `userApi.endpoints.me`
// query itself has no gating precondition — together those are strong
// evidence for the hook's behavior without pretending the hook was mounted.
//
// "sonner" is mocked via node:test's mock.module (same established pattern
// as tests/emailTemplates.test.mjs mocking nodemailer) because it injects
// CSS into `document` at import time — real DOM, not available headless —
// this has nothing to do with the auth logic under test.

import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  const toastCalls = [];
  await mock.module("sonner", {
    namedExports: {
      toast: {
        error: (...args) => toastCalls.push(["error", ...args]),
        warning: (...args) => toastCalls.push(["warning", ...args]),
        message: (...args) => toastCalls.push(["message", ...args]),
        success: (...args) => toastCalls.push(["success", ...args]),
      },
    },
  });
  globalThis.__toastCalls = toastCalls;
}

// A plain, directly-assignable stand-in for `document.cookie` — nothing in
// the code under test ever WRITES document.cookie (only reads it), so a
// simple mutable string property is faithful; no jsdom needed.
globalThis.document = { cookie: "" };

// store/apiSlice.js's baseUrl falls back to the relative path "/api" when
// NEXT_PUBLIC_API_URL isn't set — correct in a real browser (resolved
// against the page's own origin) but undici's real `Request` constructor,
// which RTK Query's fetchBaseQuery builds internally before ever calling
// our mocked fetch below, cannot resolve a relative URL with no document
// location to anchor it. Setting this makes the exact same production
// code path produce an absolute URL, with no test-only branching added to
// app code.
process.env.NEXT_PUBLIC_API_URL = "http://localhost:3000";

// lib/utils.js's `storage` helper (used by hooks/useCart.js's
// mergeGuestCartAfterLogin) deliberately no-ops when `window` is undefined
// (safe during SSR) — a minimal in-memory Map-backed localStorage shim is
// enough to exercise the real read/write logic headlessly; no jsdom needed.
const memoryStore = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k) : null),
    setItem: (k, v) => memoryStore.set(k, String(v)),
    removeItem: (k) => memoryStore.delete(k),
  },
};

describe("Client auth integration: store/apiSlice.js, store/authSlice.js, and the RTK Query endpoints hooks/useAuthBoot.js + hooks/useCart.js depend on", { skip }, () => {
  let store, apiSlice, shopApi, userApi;
  let setCredentials, clearCredentials, selectCurrentUser, selectAuthStatus;
  let fetchCalls;

  before(async () => {
    ({ default: store } = await import("../store/index.js"));
    ({ apiSlice } = await import("../store/apiSlice.js"));
    ({ shopApi } = await import("../store/shopApi.js"));
    ({ userApi } = await import("../store/userApi.js"));
    ({ setCredentials, clearCredentials, selectCurrentUser, selectAuthStatus } = await import("../store/authSlice.js"));
  });

  function stubFetch(responseFactory) {
    fetchCalls = [];
    globalThis.fetch = async (input, init) => {
      // RTK Query's fetchBaseQuery builds a real `Request` object internally
      // and calls fetch(request) with NO second argument — every property
      // (method, headers, credentials) lives on `input` itself in that case,
      // not in `init`. Support both shapes so this stub is faithful to what
      // actually happens, not just to a plain fetch(url, init) call.
      const isRequestObj = typeof Request !== "undefined" && input instanceof Request;
      const url = typeof input === "string" ? input : input.url;
      const headers = new Headers(init?.headers ?? (isRequestObj ? input.headers : undefined));
      const method = init?.method ?? (isRequestObj ? input.method : "GET");
      const credentials = init?.credentials ?? (isRequestObj ? input.credentials : undefined);
      fetchCalls.push({ url, method, headers, credentials, body: init?.body });
      const built = responseFactory ? responseFactory(url, init) : { status: 200, body: { success: true } };
      return new Response(JSON.stringify(built.body ?? {}), { status: built.status ?? 200, headers: { "content-type": "application/json" } });
    };
  }

  function resetAuthAndCache() {
    store.dispatch(clearCredentials());
    store.dispatch(apiSlice.util.resetApiState());
    globalThis.document.cookie = "";
    if (globalThis.__toastCalls) globalThis.__toastCalls.length = 0;
  }

  // ===================== 1, 3: credentials + safe-GET CSRF exemption =====================

  test("a safe GET (query) request uses credentials:'include' and does NOT attach X-CSRF-Token", async () => {
    resetAuthAndCache();
    stubFetch();
    await store.dispatch(shopApi.endpoints.getCart.initiate(undefined, { forceRefetch: true }));
    assert.equal(fetchCalls.length, 1);
    const call = fetchCalls[0];
    assert.equal(call.credentials, "include", "same-origin session cookie must actually be sent");
    assert.equal(call.headers.get("x-csrf-token"), null, "a safe GET must not carry a CSRF header at all");
    assert.equal(call.headers.get("authorization"), null);
  });

  // ===================== 2, 4: unsafe mutation CSRF attachment, no Authorization =====================

  test("an unsafe mutation reads the real CSRF cookie and attaches it as X-CSRF-Token, with credentials included and no Authorization header ever constructed", async () => {
    resetAuthAndCache();
    globalThis.document.cookie = "tahos_csrf=the-real-csrf-value; some_other_cookie=x";
    stubFetch();
    await store.dispatch(shopApi.endpoints.addToCart.initiate({ productId: "p1", variantId: "v1", quantity: 1 }));
    assert.equal(fetchCalls.length, 1);
    const call = fetchCalls[0];
    assert.equal(call.method, "POST");
    assert.equal(call.credentials, "include");
    assert.equal(call.headers.get("x-csrf-token"), "the-real-csrf-value", "the exact raw value read from the (non-HttpOnly) CSRF cookie must be echoed back as the header");
    assert.equal(call.headers.get("authorization"), null, "no Authorization header is ever constructed anywhere in this client layer");
  });

  test("an unsafe mutation with NO CSRF cookie present simply omits the header rather than sending a garbage value or crashing", async () => {
    resetAuthAndCache();
    stubFetch();
    await store.dispatch(shopApi.endpoints.addToCart.initiate({ productId: "p1", variantId: "v1", quantity: 1 }));
    const call = fetchCalls[0];
    assert.equal(call.headers.get("x-csrf-token"), null);
  });

  // ===================== structural: no code reads the HttpOnly session cookie =====================

  test("no client source file ever tries to read the HttpOnly session cookie name from document.cookie", () => {
    const filesToCheck = ["store/apiSlice.js", "store/authSlice.js", "hooks/useAuthBoot.js", "hooks/useCart.js", "views/LoginPage.jsx", "views/RegisterPage.jsx"];
    for (const rel of filesToCheck) {
      const source = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
      assert.ok(!/document\.cookie[\s\S]{0,80}tahos_session/.test(source), `${rel} must never attempt to read the HttpOnly session cookie by name — it is HttpOnly precisely so client JS cannot`);
    }
  });

  // ===================== 6, 7, 8: authSlice status transitions & no toast loop =====================

  test("authSlice: setCredentials -> authenticated; clearCredentials -> unauthenticated (real reducer dispatch, not a guess about shape)", () => {
    resetAuthAndCache();
    assert.equal(selectAuthStatus(store.getState()), "unauthenticated");
    store.dispatch(setCredentials({ _id: "u1", name: "Test", email: "t@example.invalid", role: "customer" }));
    assert.equal(selectAuthStatus(store.getState()), "authenticated");
    assert.deepEqual(selectCurrentUser(store.getState()), { _id: "u1", name: "Test", email: "t@example.invalid", role: "customer" });
    store.dispatch(clearCredentials());
    assert.equal(selectAuthStatus(store.getState()), "unauthenticated");
    assert.equal(selectCurrentUser(store.getState()), null);
  });

  test("a 401 while believing we're authenticated clears credentials and toasts exactly once — a second consecutive 401 does NOT toast again (no repeated session-expired loop)", async () => {
    resetAuthAndCache();
    store.dispatch(setCredentials({ _id: "u1", role: "customer" }));
    stubFetch(() => ({ status: 401, body: { success: false, message: "Not authorized, no session" } }));

    await store.dispatch(shopApi.endpoints.getCart.initiate(undefined, { forceRefetch: true }));
    assert.equal(selectAuthStatus(store.getState()), "unauthenticated", "the first 401 while authenticated clears credentials");
    assert.equal(globalThis.__toastCalls.length, 1, "exactly one toast for the first 401");

    // Second request also 401s — but we're now already unauthenticated, so
    // the guard (`api.getState().auth.user`) must not fire again.
    await store.dispatch(shopApi.endpoints.getCart.initiate(undefined, { forceRefetch: true }));
    assert.equal(globalThis.__toastCalls.length, 1, "no second toast — the loop-prevention guard held");
  });

  test("a 401 while we were NEVER authenticated (anonymous request to a protected endpoint) does not clear anything or toast at all", async () => {
    resetAuthAndCache();
    stubFetch(() => ({ status: 401, body: { success: false, message: "Not authorized, no session" } }));
    await store.dispatch(shopApi.endpoints.getCart.initiate(undefined, { forceRefetch: true }));
    assert.equal(globalThis.__toastCalls.length, 0, "an anonymous 401 is not a session EXPIRING, so no toast is warranted");
  });

  // ===================== 5: useAuthBoot's underlying query is unconditional =====================

  test("hooks/useAuthBoot.js's source calls useMeQuery() with no options object (in particular, no `skip`) — a direct source characterization, since this file does not mount the hook itself", () => {
    const source = readFileSync(new URL("../hooks/useAuthBoot.js", import.meta.url), "utf8");
    assert.match(source, /useMeQuery\(\s*\)/, "useMeQuery must be called with no arguments — passing a { skip } option here would silently break boot-restoration for a user with no client-visible auth trace to check first");
  });

  test("the underlying userApi 'me' query itself has no gating precondition — dispatching it with a completely fresh, never-authenticated store still fires the real HTTP request", async () => {
    resetAuthAndCache();
    stubFetch();
    assert.equal(selectCurrentUser(store.getState()), null, "sanity check: genuinely no user in state yet");
    await store.dispatch(userApi.endpoints.me.initiate(undefined, { forceRefetch: true }));
    assert.equal(fetchCalls.length, 1, "GET /api/users/me fired even though nothing in Redux suggested a user existed — confirms useAuthBoot's unconditional call has real support underneath, not just an absence of a `skip` flag");
    assert.match(fetchCalls[0].url, /\/users\/me$/);
  });

  // ===================== 9, 10: guest-cart merge sequencing and recoverability =====================

  test("mergeGuestCartAfterLogin() only removes a guest item from storage on a SUCCESSFUL server add — a failing item is left in place and recoverable (real function, mocked mutation, no server involved)", async () => {
    const { mergeGuestCartAfterLogin } = await import("../hooks/useCart.js");
    const { storage } = await import("../lib/utils.js");

    const items = [
      { productId: "p-good", variantId: "v-good", quantity: 1 },
      { productId: "p-bad", variantId: "v-bad", quantity: 5 },
    ];
    storage.setJSON("ss:guestCart", items);

    const removed = [];
    // A minimal stand-in for the RTK Query mutation trigger this function
    // is handed in real usage (see hooks/useCart.js's mergeGuestCartAfterLogin
    // signature: `(dispatch, addToCartMutation)`) — succeeds for the first
    // item, rejects for the second, exactly like a real 400/404 would after
    // `.unwrap()`.
    const fakeAddToCartMutation = (arg) => ({
      unwrap: async () => {
        if (arg.productId === "p-bad") throw new Error("Out of stock");
        return { success: true };
      },
    });
    const fakeDispatch = (action) => {
      if (action.type === "__test_guestRemove") removed.push(action.payload);
    };

    // guestRemove() is a real action creator from store/guestCartSlice.js —
    // import it so the dispatched action's .type genuinely matches what
    // hooks/useCart.js dispatches, rather than assuming its shape.
    const { guestRemove } = await import("../store/guestCartSlice.js");
    const dispatchSpy = (action) => {
      if (guestRemove.match ? guestRemove.match(action) : action.type === guestRemove(items[0]).type) {
        removed.push(action.payload);
      }
    };

    await mergeGuestCartAfterLogin(dispatchSpy, fakeAddToCartMutation);

    assert.deepEqual(removed, [{ productId: "p-good", variantId: "v-good" }], "only the successful item was removed from guest storage");

    storage.remove("ss:guestCart");
  });

  // ===================== 11: wishlist / recently-viewed untouched =====================

  test("mergeGuestCartAfterLogin() and the auth client layer never touch wishlist or recently-viewed localStorage keys", () => {
    // store/apiSlice.js legitimately declares "Wishlist" as an RTK Query
    // cache TAG name (unrelated to browser storage) — excluded here on
    // purpose, not because it's out of scope to check; it just isn't a
    // storage reference at all, and a plain word-match would false-positive
    // on it.
    const filesToCheck = ["hooks/useCart.js", "store/authSlice.js", "hooks/useAuthBoot.js"];
    for (const rel of filesToCheck) {
      const source = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
      assert.ok(!/wishlist|recentlyViewed|recently_viewed/i.test(source), `${rel} must not reference wishlist/recently-viewed storage at all — this migration must not touch it`);
    }
  });
});
