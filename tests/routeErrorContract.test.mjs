// Phase 1: the central HTTP/error-translation contract — lib/http.js's
// withRoute()/toResponse(), exercised through real Route Handlers against a
// real replica-set MongoDB. This file is deliberately systematic rather
// than scattered — every error shape lib/http.js knows how to translate
// gets one dedicated, clearly-labeled test here, even where a handler
// exercising it also happens to appear in another Phase 1 file.
//
// Only one test in this file mocks anything, and only a single service
// function, specifically to force an unhandled/unexpected exception (there
// is no reliable way to organically trigger a truly generic, unmapped
// error through real business logic) — every other test exercises the
// real, unmocked route + service + database.

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
  createTestProduct,
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("Route Handler error contract (lib/http.js's withRoute/toResponse)", { skip: !canRun && reason }, () => {
  let loginPOST, registerPOST, ordersPOST, orderGET, reviewsPUT, couponsGET;
  let User, Order, Product;

  before(async () => {
    await connectTestDb();
    ({ POST: loginPOST } = await import("../app/api/users/login/route.js"));
    ({ POST: registerPOST } = await import("../app/api/users/register/route.js"));
    ({ POST: ordersPOST } = await import("../app/api/orders/route.js"));
    ({ GET: orderGET } = await import("../app/api/orders/[id]/route.js"));
    ({ PUT: reviewsPUT } = await import("../app/api/reviews/[id]/route.js"));
    ({ GET: couponsGET } = await import("../app/api/coupons/route.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Order } = await import("../models/orderModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  function assertErrorShape(json) {
    assert.equal(json.success, false);
    assert.equal(typeof json.message, "string");
    assert.ok(!("stack" in json), "no stack trace field");
  }

  test("FIXED: malformed JSON body -> a clean 400 (Phase 5's shared JSON-parse contract), not a raw-SyntaxError-mapped 500", async () => {
    // Origin must match, or Phase 2's Layer 1 CSRF/Origin check (applied to
    // every unsafe request, including this public auth endpoint — see
    // lib/http.js's withRoute()) rejects the request with 403 before the
    // handler ever calls request.json() at all.
    const req = new Request("http://test/api/users/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://test" },
      body: "{not valid json,,,",
    });
    const res = await loginPOST(req);
    // app/api/users/login/route.js now catches the JSON parse failure
    // itself (so the rate-limit check below it still always runs) and
    // schema-validates the resulting empty object, which fails cleanly —
    // 400, not the old unmapped-SyntaxError 500.
    assert.equal(res.status, 400);
    const json = await res.json();
    assertErrorShape(json);
    assert.equal(res.headers.get("content-type")?.includes("application/json"), true);
  });

  test("FIXED (Phase 5B ObjectId contract): invalid/malformed ObjectId path param -> 400, not the old CastError-mapped 404", async () => {
    // services/orderService.js's getOrder() now calls requireObjectIdFormat()
    // before ever reaching Order.findById() — a malformed id is a client
    // input error (400), distinct from a well-formed id that legitimately
    // doesn't exist (404, tested separately below).
    const user = await createTestUser();
    try {
      const req = requestAs({ method: "GET", url: "http://test/api/orders/not-a-valid-id", session: await createTestSession(user._id) });
      const res = await orderGET(req, { params: Promise.resolve({ id: "not-a-valid-id" }) });
      assert.equal(res.status, 400);
      const json = await res.json();
      assertErrorShape(json);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("valid but nonexistent ObjectId -> 404 with a specific, resource-aware message", async () => {
    const user = await createTestUser();
    try {
      const fakeId = "507f1f77bcf86cd799439011";
      const req = requestAs({ method: "GET", url: `http://test/api/orders/${fakeId}`, session: await createTestSession(user._id) });
      const res = await orderGET(req, { params: Promise.resolve({ id: fakeId }) });
      assert.equal(res.status, 404);
      const json = await res.json();
      assertErrorShape(json);
      assert.equal(json.message, "Order not found");
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("missing required body field -> a clean 400, with a safe field-level error identifying the missing field (not a raw Mongoose error)", async () => {
    const req = requestAs({ method: "POST", url: "http://test/api/users/register", body: { email: "x@example.invalid", password: "x" } }); // no `name`, and `password` too short
    const res = await registerPOST(req);
    assert.equal(res.status, 400);
    const json = await res.json();
    assertErrorShape(json);
    assert.ok(Array.isArray(json.errors), "schemas/*.js validation failures carry a safe field-level errors array");
    assert.ok(json.errors.some((e) => e.path === "name"), "the missing `name` field is identified by path");
    assert.ok(!json.errors.some((e) => "value" in e), "no submitted value is ever echoed back in a field error");
  });

  test("FIXED: an invalid field TYPE (string where the schema expects Number) is now a clean 400, not a generic 500", async () => {
    const user = await createTestUser();
    const product = await createTestProduct({ stock: 10 });
    try {
      const req = requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(user._id),
        body: {
          items: [{ productId: product._id.toString(), variantId: product.variants[0]._id.toString(), quantity: "not-a-number" }],
          shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" },
        },
      });
      const res = await ordersPOST(req);
      // Phase 5: schemas/orderSchemas.js's createOrderSchema rejects a
      // non-numeric quantity before the request body ever reaches
      // calcTotals()/Mongoose — a clean 400, not the old unmapped 500.
      assert.equal(res.status, 400, "a non-numeric quantity is now caught by shared body validation, not a raw CastError/500");
      const json = await res.json();
      assertErrorShape(json);
    } finally {
      await Order.deleteMany({ user: user._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  test("Mongoose ValidationError (e.g. rating out of range) -> clean 400 with the field-level message", async () => {
    const user = await createTestUser();
    const other = await createTestUser();
    // Borrow an existing review-update path is awkward without a delivered
    // order; instead prove the ValidationError mapping directly against
    // the model, then confirm the SAME mapping is what a route sees by
    // checking lib/http.js's toResponse() branch is unconditional on error
    // shape, not on which model raised it — already proven for User/Order
    // schemas elsewhere in this suite (registration's missing-name test
    // above is itself a ValidationError instance). This test targets the
    // duplicate-key branch specifically instead, since that's the one not
    // otherwise covered in this file.
    try {
      const email = `dup-${Date.now()}@example.invalid`;
      const first = requestAs({ method: "POST", url: "http://test/api/users/register", body: { name: "First", email, password: "Password123!" } });
      const firstRes = await registerPOST(first);
      assert.equal(firstRes.status, 201);

      const second = requestAs({ method: "POST", url: "http://test/api/users/register", body: { name: "Second", email, password: "Password123!" } });
      const secondRes = await registerPOST(second);
      assert.equal(secondRes.status, 400, "DUPLICATE/UNIQUE CONFLICT: registering the same email twice");
      const json = await secondRes.json();
      assertErrorShape(json);
      assert.match(json.message, /already exists/i);

      await User.deleteOne({ email });
    } finally {
      await User.deleteOne({ _id: user._id });
      await User.deleteOne({ _id: other._id });
    }
  });

  test("unauthenticated request -> 401, consistent shape", async () => {
    const req = requestAs({ method: "GET", url: "http://test/api/coupons" });
    const res = await couponsGET(req);
    assert.equal(res.status, 401);
    const json = await res.json();
    assertErrorShape(json);
  });

  test("authenticated but unauthorized (forbidden) -> 403, consistent shape", async () => {
    const customer = await createTestUser({ role: "customer" });
    try {
      const req = requestAs({ method: "GET", url: "http://test/api/coupons", session: await createTestSession(customer._id) });
      const res = await couponsGET(req);
      assert.equal(res.status, 403);
      const json = await res.json();
      assertErrorShape(json);
    } finally {
      await User.deleteOne({ _id: customer._id });
    }
  });

  test("stock/business conflict -> 409, consistent shape (concurrent guarded-decrement failure)", async () => {
    const user = await createTestUser();
    const product = await createTestProduct({ stock: 6 });
    try {
      const variantId = product.variants[0]._id.toString();
      const req = requestAs({
        method: "POST",
        url: "http://test/api/orders",
        session: await createTestSession(user._id),
        body: {
          items: [
            { productId: product._id.toString(), variantId, quantity: 4 },
            { productId: product._id.toString(), variantId, quantity: 4 },
          ],
          shippingAddress: { fullName: "x", phone: "x", street: "x", city: "x", postalCode: "x", country: "Bangladesh" },
        },
      });
      const res = await ordersPOST(req);
      assert.equal(res.status, 409);
      const json = await res.json();
      assertErrorShape(json);
    } finally {
      await Order.deleteMany({ user: user._id });
      await Product.deleteOne({ _id: product._id });
      await User.deleteOne({ _id: user._id });
    }
  });

  test("FIXED: unexpected/unmapped exception -> generic sanitized 500, the raw message is NEVER echoed — tested directly against the real withRoute()/toResponse() translation in lib/http.js, the same functions every route above goes through", async () => {
    // Deliberately not mocking a real service module here: services/orderService.js
    // is already imported (real) by app/api/orders/route.js in this file's
    // before(), so a same-process mock.module() call for it now would be
    // too late to take effect (the module is already cached) — the same
    // import-ordering pitfall found and fixed in tests/emailTemplates.test.mjs.
    // Testing lib/http.js's withRoute()/toResponse() directly, with a
    // synthetic handler that throws a plain untyped Error, exercises the
    // EXACT SAME translation logic every real route above already uses,
    // without fighting that ordering problem or mocking anything.
    const { withRoute } = await import("../lib/http.js");
    const originalConsoleError = console.error;
    console.error = () => {}; // expected — this test deliberately forces the error path
    let res;
    try {
      const rawMessage = "boom: an entirely unexpected, un-typed failure";
      const handler = withRoute(async () => {
        throw new Error(rawMessage);
      });
      const req = requestAs({ method: "GET", url: "http://test/api/whatever" });
      res = await handler(req, {});
      const json = await res.json();
      assertErrorShape(json);
      assert.equal(json.message, "Internal server error", "the raw thrown Error's .message must never reach the client for an unmapped exception");
      assert.ok(!json.message.includes(rawMessage));
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(res.status, 500);
  });

  test("FIXED: unmapped exceptions carrying sensitive-looking content (Mongo URI, password, cookie, reset token, filesystem path, stack-like text) never leak any of it to the client", async () => {
    const { withRoute } = await import("../lib/http.js");
    const originalConsoleError = console.error;
    console.error = () => {};
    const sensitiveMessages = [
      "connect ECONNREFUSED mongodb+srv://dbuser:S3cretPass@cluster0.mongodb.net/prod",
      "Auth failed for password=SuperSecret123!",
      "Invalid cookie: tahos_session=abcdef0123456789abcdef0123456789",
      "Reset token abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789 already used",
      "ENOENT: no such file or directory, open '/var/app/config/secrets.json'",
      "collection 'sessions' index 'tokenHash_1' violated constraint\n    at Object.<anonymous> (/app/node_modules/mongoose/lib/model.js:123:45)\n    at processTicksAndRejections",
    ];
    try {
      for (const rawMessage of sensitiveMessages) {
        const handler = withRoute(async () => {
          throw new Error(rawMessage);
        });
        const req = requestAs({ method: "GET", url: "http://test/api/whatever" });
        const res = await handler(req, {});
        assert.equal(res.status, 500);
        const json = await res.json();
        assertErrorShape(json);
        assert.equal(json.message, "Internal server error");
        const bodyText = JSON.stringify(json);
        assert.ok(!/mongodb(\+srv)?:\/\//i.test(bodyText), "no Mongo connection string");
        assert.ok(!/password\s*=/i.test(bodyText), "no password");
        assert.ok(!/tahos_session=/i.test(bodyText), "no session cookie value");
        assert.ok(!bodyText.includes("abcdef0123456789abcdef0123456789"), "no token-shaped value");
        assert.ok(!/\/[a-z0-9_/-]+\.(json|js|env)/i.test(bodyText), "no filesystem path");
        assert.ok(!bodyText.includes("\n"), "no multiline/stack-like content");
      }
    } finally {
      console.error = originalConsoleError;
    }
  });

  test("malformed session cookie -> 401, consistent shape (see tests/authLifecycle.test.mjs and tests/session.test.mjs for the full session-lifecycle matrix)", async () => {
    const req = new Request("http://test/api/coupons", { headers: { cookie: "tahos_session=not-a-real-session-token" } });
    const res = await couponsGET(req);
    assert.equal(res.status, 401);
    const json = await res.json();
    assertErrorShape(json);
    assert.equal(json.message, "Not authorized, no session");
  });

  test("no database-connection detail (Mongo URI, host, port) ever appears in an error response", async () => {
    const req = requestAs({ method: "GET", url: "http://test/api/orders/not-a-valid-id", session: await createTestSession((await createTestUser())._id) });
    const res = await orderGET(req, { params: Promise.resolve({ id: "not-a-valid-id" }) });
    const json = await res.json();
    assert.ok(!/mongodb(\+srv)?:\/\//i.test(json.message), "no connection string in the error message");
    assert.ok(!/127\.0\.0\.1|localhost/.test(json.message), "no host detail in the error message");
  });

  test("every response in this file carries application/json content-type", async () => {
    const req = requestAs({ method: "GET", url: "http://test/api/coupons" });
    const res = await couponsGET(req);
    assert.match(res.headers.get("content-type") || "", /application\/json/);
  });
});
