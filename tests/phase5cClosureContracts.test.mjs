// Phase 5C closure — the last few contract fixes: product compare/batch id
// list validation, cart path-param ObjectId format, and reset token format
// (bounded, without introducing any new enumeration signal). Its
// verify-email counterpart was removed in Phase 6 along with the rest of
// the unwired email-verification feature.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, createTestSession, requestAs, createTestUser, createTestProduct } from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("Phase 5C — product compare/batch id-list contract", { skip: !canRun && reason }, () => {
  let compareGET;
  let User, Product;

  before(async () => {
    await connectTestDb();
    ({ GET: compareGET } = await import("../app/api/products/compare/route.js"));
    ({ default: User } = await import("../models/userModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
  });

  // Deliberately NOT disconnecting here — this file has two more describe()
  // blocks below sharing the same connection. Only the very last describe's
  // after() disconnects (see tests/orderDuplicateRegression.test.mjs for
  // the identical, previously-diagnosed reasoning: disconnecting between
  // sibling top-level describes races against the next one's own
  // connectTestDb() call).
  after(async () => {});

  test("compare: valid ids succeed (200)", async () => {
    const productA = await createTestProduct({ stock: 5 });
    const productB = await createTestProduct({ stock: 5 });
    try {
      const res = await compareGET(requestAs({ method: "GET", url: `http://test/api/products/compare?ids=${productA._id},${productB._id}` }));
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.products.length, 2);
    } finally {
      await Product.deleteMany({ _id: { $in: [productA._id, productB._id] } });
    }
  });

  test("compare: a malformed id in the list is rejected (400), not silently dropped", async () => {
    const product = await createTestProduct({ stock: 5 });
    try {
      const res = await compareGET(requestAs({ method: "GET", url: `http://test/api/products/compare?ids=${product._id},not-an-id` }));
      assert.equal(res.status, 400);
    } finally {
      await Product.deleteOne({ _id: product._id });
    }
  });

  test("compare: an empty ids param is rejected (400)", async () => {
    const res = await compareGET(requestAs({ method: "GET", url: "http://test/api/products/compare?ids=" }));
    assert.equal(res.status, 400);
  });

  test("compare: a request with no recognizable `ids` key at all is rejected (400), not treated as an empty/omitted filter", async () => {
    const res = await compareGET(requestAs({ method: "GET", url: "http://test/api/products/compare?ids[$gt]=" }));
    assert.equal(res.status, 400);
  });

  // Note: GET /api/products/batch's handler also calls getServerLocale()
  // (next/headers' cookies()), which requires a real Next.js request scope
  // — it cannot be invoked as a bare direct Route Handler call the way the
  // other tests in this file do (this is a pre-existing framework
  // constraint, unrelated to Phase 5 validation). Batch's own dedup/
  // rejection behavior is instead covered via real HTTP in
  // tests/http/relatedProducts.integration.test.mjs ("duplicate ids in the
  // batch list are de-duplicated", "a malformed id ... rejects the WHOLE
  // request", "an empty ids param is now rejected").
});

describe("Phase 5C — cart path-param ObjectId contract", { skip: !canRun && reason }, () => {
  let cartDELETE;
  let User;

  before(async () => {
    await connectTestDb();
    ({ DELETE: cartDELETE } = await import("../app/api/cart/[productId]/[variantId]/route.js"));
    ({ default: User } = await import("../models/userModel.js"));
  });

  after(async () => {});

  test("a malformed productId path param is rejected (400)", async () => {
    const user = await createTestUser();
    try {
      const res = await cartDELETE(
        requestAs({ method: "DELETE", url: "http://test/api/cart/not-an-id/507f1f77bcf86cd799439011", session: await createTestSession(user._id) }),
        { params: Promise.resolve({ productId: "not-an-id", variantId: "507f1f77bcf86cd799439011" }) },
      );
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("a malformed variantId path param is rejected (400)", async () => {
    const user = await createTestUser();
    try {
      const res = await cartDELETE(
        requestAs({ method: "DELETE", url: "http://test/api/cart/507f1f77bcf86cd799439011/not-an-id", session: await createTestSession(user._id) }),
        { params: Promise.resolve({ productId: "507f1f77bcf86cd799439011", variantId: "not-an-id" }) },
      );
      assert.equal(res.status, 400);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });

  test("well-formed (but non-matching) ids succeed as a no-op removal (200)", async () => {
    const user = await createTestUser();
    try {
      const res = await cartDELETE(
        requestAs({ method: "DELETE", url: "http://test/api/cart/507f1f77bcf86cd799439011/507f1f77bcf86cd799439012", session: await createTestSession(user._id) }),
        { params: Promise.resolve({ productId: "507f1f77bcf86cd799439011", variantId: "507f1f77bcf86cd799439012" }) },
      );
      assert.equal(res.status, 200);
    } finally {
      await User.deleteOne({ _id: user._id });
    }
  });
});

describe("Phase 5C — reset token format contract (no new enumeration signal)", { skip: !canRun && reason }, () => {
  let resetPOST;

  before(async () => {
    await connectTestDb();
    ({ POST: resetPOST } = await import("../app/api/users/reset-password/[token]/route.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  test("a too-short reset token returns the SAME generic 400 as a well-formed-but-unknown one", async () => {
    const shortRes = await resetPOST(
      requestAs({ method: "POST", url: "http://test/api/users/reset-password/short", body: { password: "NewPassword123!" } }),
      { params: Promise.resolve({ token: "short" }) },
    );
    const unknownRes = await resetPOST(
      requestAs({ method: "POST", url: `http://test/api/users/reset-password/${"a".repeat(64)}`, body: { password: "NewPassword123!" } }),
      { params: Promise.resolve({ token: "a".repeat(64) }) },
    );
    assert.equal(shortRes.status, 400);
    assert.equal(unknownRes.status, 400);
    const shortJson = await shortRes.json();
    const unknownJson = await unknownRes.json();
    assert.equal(shortJson.message, unknownJson.message);
  });
});
