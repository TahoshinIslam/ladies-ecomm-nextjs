// Regression coverage for two real bugs found while building the account
// "Reviews" page (components/account sidebar -> /reviews):
//
// 1. schemas/reviewSchemas.js's createReviewSchema used
//    `requiredString({min:1}).optional().default("")` for `title` — Zod
//    re-validates a `.default()` value against the schema it's attached
//    to, so an OMITTED title (ReviewForm.jsx's title field is explicitly
//    optional and sends `title: undefined` when left blank) got defaulted
//    to `""`, which then failed the SAME min:1 check it was just
//    substituted to satisfy. A review could never actually be submitted
//    without typing a title, silently defeating "optional".
// 2. services/reviewService.js's new getMyReviewProducts(userId) — the
//    real eligibility logic behind GET /api/reviews/mine: every distinct
//    product across the user's DELIVERED orders, split into "reviewable"
//    (no review yet) and "reviewed" (already rated), including a product
//    the user has reviewed but has no delivered order for (impossible via
//    createReview()'s own guard, but exercised directly here) is not a
//    concern this suite needs to fabricate — only real delivered-order
//    products are ever candidates.
//
// Requires MONGO_URI_TEST. Skips (never fails) if it's missing.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  truncateAll,
  createTestSession,
  requestAs,
  createTestUser,
  createTestProduct,
  createDeliveredOrderFor,
  deleteRows,
} from "./helpers/testDb.mjs";
import { createReviewSchema } from "../schemas/reviewSchemas.js";

const canRun = dbReady;
const reason = skipReason;

describe("createReviewSchema — an omitted title must not be treated as an empty title (regression)", () => {
  test("rating + comment only (no title key at all) parses successfully", () => {
    const result = createReviewSchema.safeParse({ rating: 5, comment: "Good product, fits well." });
    assert.equal(result.success, true);
    assert.equal(result.data.title, undefined);
  });

  test("a real title still validates normally", () => {
    const result = createReviewSchema.safeParse({ rating: 4, title: "Solid", comment: "Would buy again." });
    assert.equal(result.success, true);
    assert.equal(result.data.title, "Solid");
  });

  test("an explicit empty-string title is still rejected (min:1 still enforced when the field IS present)", () => {
    const result = createReviewSchema.safeParse({ rating: 5, title: "", comment: "Fine." });
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some((i) => i.path[0] === "title"));
  });
});

describe("POST /api/reviews/product/[productId] and GET /api/reviews/mine", { skip: !canRun && reason }, () => {
  let createReviewPOST, myReviewsGET;
  let Review, Order;
  let buyer, product, order;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ POST: createReviewPOST } = await import("../app/api/reviews/product/[productId]/route.js"));
    ({ GET: myReviewsGET } = await import("../app/api/reviews/mine/route.js"));
    ({ default: Review } = await import("../models/reviewModel.js"));
    ({ default: Order } = await import("../models/orderModel.js"));

    buyer = await createTestUser();
    product = await createTestProduct();
    order = await createDeliveredOrderFor(buyer._id, product._id, product.variants[0]._id);
  });

  after(async () => {
    if (product?._id) await deleteRows("reviews", "product_id", product._id);
    if (order?._id) await deleteRows("orders", "id", order._id);
    await disconnectTestDb();
  });

  test("submitting a review with NO title succeeds end-to-end through the real route (the actual regression this session hit)", async () => {
    const session = await createTestSession(buyer._id);
    const res = await createReviewPOST(
      requestAs({
        method: "POST",
        url: `http://test/api/reviews/product/${product._id}`,
        session,
        body: { rating: 5, comment: "No title provided on purpose." },
      }),
      { params: Promise.resolve({ productId: product._id.toString() }) },
    );
    const json = await res.json();
    assert.equal(res.status, 201, JSON.stringify(json));
    assert.equal(json.review.title, undefined);
  });

  test("GET /api/reviews/mine now lists this product under 'reviewed', not 'reviewable'", async () => {
    const session = await createTestSession(buyer._id);
    const res = await myReviewsGET(requestAs({ method: "GET", url: "http://test/api/reviews/mine", session }));
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.reviewable.some((p) => String(p._id) === String(product._id)), false, "already-reviewed product must not also appear as reviewable");
    const reviewedEntry = json.reviewed.find((r) => String(r.product?._id) === String(product._id));
    assert.ok(reviewedEntry, "the product must appear under reviewed");
    assert.equal(reviewedEntry.comment, "No title provided on purpose.");
  });

  test("a second delivered product with no review yet appears under 'reviewable'", async () => {
    const secondProduct = await createTestProduct();
    const secondOrder = await createDeliveredOrderFor(buyer._id, secondProduct._id, secondProduct.variants[0]._id);
    try {
      const session = await createTestSession(buyer._id);
      const res = await myReviewsGET(requestAs({ method: "GET", url: "http://test/api/reviews/mine", session }));
      const json = await res.json();
      assert.ok(json.reviewable.some((p) => String(p._id) === String(secondProduct._id)));
    } finally {
      await deleteRows("orders", "id", secondOrder._id);
      await deleteRows("products", "id", secondProduct._id);
    }
  });
});
