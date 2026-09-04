// Phase 1 regression-safety-net: review ownership enforcement.
//
// Directly inspects the four review Route Handlers named in the Phase 1
// prompt — PUT/DELETE /api/reviews/[id], POST .../helpful,
// POST .../reply — by calling their exported functions with real Request
// objects, against a real (test-only) MongoDB. No assumption is made about
// what these handlers do; every assertion below was derived from reading
// app/api/reviews/[id]/route.js, app/api/reviews/[id]/{helpful,reply}/route.js
// and services/reviewService.js first (see the Phase 1 investigation).
//
// Requires MONGO_URI_TEST in the test environment. Skips (never fails) if
// it's missing — see tests/helpers/testDb.mjs.

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
  createDeliveredOrderFor,
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("review ownership — PUT/DELETE /api/reviews/[id], POST helpful/reply", { skip: !canRun && reason }, () => {
  let PUT, DELETE, helpfulPOST, replyPOST;
  let owner, otherCustomer, employeeWithReviews, employeeWithoutReviews, admin;
  let Review;

  before(async () => {
    await connectTestDb();
    ({ PUT, DELETE } = await import("../app/api/reviews/[id]/route.js"));
    ({ POST: helpfulPOST } = await import("../app/api/reviews/[id]/helpful/route.js"));
    ({ POST: replyPOST } = await import("../app/api/reviews/[id]/reply/route.js"));
    ({ default: Review } = await import("../models/reviewModel.js"));

    owner = await createTestUser({ role: "customer" });
    otherCustomer = await createTestUser({ role: "customer" });
    employeeWithReviews = await createTestUser({ role: "employee", permissions: ["reviews.manage"] });
    employeeWithoutReviews = await createTestUser({ role: "employee", permissions: [] });
    admin = await createTestUser({ role: "admin" });
  });

  after(async () => {
    for (const u of [owner, otherCustomer, employeeWithReviews, employeeWithoutReviews, admin]) {
      const { default: User } = await import("../models/userModel.js");
      await User.deleteOne({ _id: u._id }).catch(() => {});
    }
    await disconnectTestDb();
  });

  // Each test builds its own fresh review so tests don't depend on
  // execution order or leak state into each other.
  async function makeReview() {
    const product = await createTestProduct();
    const variantId = product.variants[0]._id;
    await createDeliveredOrderFor(owner._id, product._id, variantId);
    const review = await Review.create({
      user: owner._id,
      product: product._id,
      rating: 4,
      comment: "Good fit, true to size.",
    });
    return { review, product };
  }

  test("owner can update their own review (PUT)", async () => {
    const { review } = await makeReview();
    const req = requestAs({
      method: "PUT",
      url: `http://test/api/reviews/${review._id}`,
      session: await createTestSession(owner._id),
      body: { comment: "Updated: still true to size after a wash." },
    });
    const res = await PUT(req, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.review.comment, "Updated: still true to size after a wash.");
  });

  test("non-owner customer is rejected on PUT (403)", async () => {
    const { review } = await makeReview();
    const req = requestAs({
      method: "PUT",
      url: `http://test/api/reviews/${review._id}`,
      session: await createTestSession(otherCustomer._id),
      body: { comment: "Hijacked review text" },
    });
    const res = await PUT(req, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal(res.status, 403);
    const stillOriginal = await Review.findById(review._id);
    assert.equal(stillOriginal.comment, "Good fit, true to size.");
  });

  test("admin can update someone else's review (PUT)", async () => {
    const { review } = await makeReview();
    const req = requestAs({
      method: "PUT",
      url: `http://test/api/reviews/${review._id}`,
      session: await createTestSession(admin._id),
      body: { comment: "Edited by admin for moderation." },
    });
    const res = await PUT(req, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal(res.status, 200);
  });

  test("unauthenticated PUT is rejected (401)", async () => {
    const { review } = await makeReview();
    const req = requestAs({
      method: "PUT",
      url: `http://test/api/reviews/${review._id}`,
      body: { comment: "no token" },
    });
    const res = await PUT(req, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal(res.status, 401);
  });

  test("non-owner customer is rejected on DELETE (403), review survives", async () => {
    const { review } = await makeReview();
    const req = requestAs({ method: "DELETE", url: `http://test/api/reviews/${review._id}`, session: await createTestSession(otherCustomer._id) });
    const res = await DELETE(req, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal(res.status, 403);
    assert.ok(await Review.findById(review._id), "review must still exist");
  });

  test("owner can delete their own review (DELETE)", async () => {
    const { review } = await makeReview();
    const req = requestAs({ method: "DELETE", url: `http://test/api/reviews/${review._id}`, session: await createTestSession(owner._id) });
    const res = await DELETE(req, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal(res.status, 200);
    assert.equal(await Review.findById(review._id), null);
  });

  test("admin can delete someone else's review (DELETE)", async () => {
    const { review } = await makeReview();
    const req = requestAs({ method: "DELETE", url: `http://test/api/reviews/${review._id}`, session: await createTestSession(admin._id) });
    const res = await DELETE(req, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal(res.status, 200);
  });

  test("nonexistent (but valid-format) review id returns 404 on PUT/DELETE", async () => {
    const fakeId = "507f1f77bcf86cd799439011"; // well-formed ObjectId, no matching document
    const putReq = requestAs({ method: "PUT", url: `http://test/api/reviews/${fakeId}`, session: await createTestSession(owner._id), body: { comment: "x" } });
    const putRes = await PUT(putReq, { params: Promise.resolve({ id: fakeId }) });
    assert.equal(putRes.status, 404);

    const delReq = requestAs({ method: "DELETE", url: `http://test/api/reviews/${fakeId}`, session: await createTestSession(owner._id) });
    const delRes = await DELETE(delReq, { params: Promise.resolve({ id: fakeId }) });
    assert.equal(delRes.status, 404);
  });

  test("malformed (non-ObjectId) review id returns 404, not 500 — lib/http.js's CastError mapping", async () => {
    const req = requestAs({ method: "PUT", url: "http://test/api/reviews/not-a-valid-id", session: await createTestSession(owner._id), body: { comment: "x" } });
    const res = await PUT(req, { params: Promise.resolve({ id: "not-a-valid-id" }) });
    assert.equal(res.status, 404);
  });

  // ---------------------------------------------------------------------
  // markHelpful() behavior — CHARACTERIZATION, not a vulnerability report.
  // services/reviewService.js's markHelpful() is a single atomic
  // `Review.findByIdAndUpdate(reviewId, { $inc: { helpfulCount: 1 } })` —
  // there is no per-user vote record anywhere in models/reviewModel.js
  // (no `helpfulBy`/`helpfulVoters` array, just a bare `helpfulCount`
  // number). This section documents exactly what that means; none of it
  // is changed here. Whether "one vote per user" should exist is a later
  // product/implementation decision, not something to silently add.
  // ---------------------------------------------------------------------

  test("a stranger (non-owner, non-staff) can mark a review helpful — no ownership check exists on this endpoint", async () => {
    const { review } = await makeReview();
    const req = requestAs({ method: "POST", url: `http://test/api/reviews/${review._id}/helpful`, session: await createTestSession(otherCustomer._id) });
    const res = await helpfulPOST(req, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.helpfulCount, 1);
  });

  test("the review's own author CAN mark their own review helpful — nothing prevents it", async () => {
    const { review } = await makeReview();
    const req = requestAs({ method: "POST", url: `http://test/api/reviews/${review._id}/helpful`, session: await createTestSession(owner._id) });
    const res = await helpfulPOST(req, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.helpfulCount, 1, "the author's own click counts exactly like anyone else's — no self-vote exclusion exists");
  });

  test("the SAME user can call markHelpful repeatedly — each call increments again, with no dedup", async () => {
    const { review } = await makeReview();
    for (let i = 1; i <= 3; i++) {
      const req = requestAs({ method: "POST", url: `http://test/api/reviews/${review._id}/helpful`, session: await createTestSession(otherCustomer._id) });
      const res = await helpfulPOST(req, { params: Promise.resolve({ id: review._id.toString() }) });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.helpfulCount, i, `call #${i} from the same user should still increment — there is no per-user vote tracking to dedup against`);
    }
  });

  test("helpful votes are NOT associated with any user identity — only a bare counter exists on the Review document", async () => {
    const { review } = await makeReview();
    const req = requestAs({ method: "POST", url: `http://test/api/reviews/${review._id}/helpful`, session: await createTestSession(otherCustomer._id) });
    await helpfulPOST(req, { params: Promise.resolve({ id: review._id.toString() }) });
    const stored = await Review.findById(review._id).lean();
    assert.equal(typeof stored.helpfulCount, "number");
    assert.equal(stored.helpfulBy, undefined, "confirmed: no field recording which users voted exists on the schema at all");
  });

  test("the increment itself IS atomic — N concurrent requests (even from the same user) produce exactly N, no lost updates", async () => {
    const { review } = await makeReview();
    const CONCURRENT = 10;
    const fire = async () => {
      const req = requestAs({ method: "POST", url: `http://test/api/reviews/${review._id}/helpful`, session: await createTestSession(otherCustomer._id) });
      return helpfulPOST(req, { params: Promise.resolve({ id: review._id.toString() }) });
    };
    const results = await Promise.all(Array.from({ length: CONCURRENT }, fire));
    for (const res of results) assert.equal(res.status, 200);

    const final = await Review.findById(review._id).lean();
    assert.equal(
      final.helpfulCount,
      CONCURRENT,
      "MongoDB's atomic $inc means concurrent requests never lose an update — this is a separate fact from whether they're deduplicated (they are not, per the tests above)",
    );
  });

  test("markHelpful is rejected unauthenticated (401)", async () => {
    const { review } = await makeReview();
    const req = requestAs({ method: "POST", url: `http://test/api/reviews/${review._id}/helpful` });
    const res = await helpfulPOST(req, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal(res.status, 401);
  });

  test("markHelpful on a nonexistent review returns 404", async () => {
    const fakeId = "507f1f77bcf86cd799439011";
    const req = requestAs({ method: "POST", url: `http://test/api/reviews/${fakeId}/helpful`, session: await createTestSession(owner._id) });
    const res = await helpfulPOST(req, { params: Promise.resolve({ id: fakeId }) });
    assert.equal(res.status, 404);
  });

  test("reply requires REVIEWS_MANAGE — plain customer (including the review's own owner) gets 403", async () => {
    const { review } = await makeReview();
    const req = requestAs({
      method: "POST",
      url: `http://test/api/reviews/${review._id}/reply`,
      session: await createTestSession(owner._id), // the review's own author — still just a customer
      body: { text: "Trying to reply to my own review" },
    });
    const res = await replyPOST(req, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal(res.status, 403);
  });

  test("reply requires REVIEWS_MANAGE — employee WITHOUT that permission gets 403", async () => {
    const { review } = await makeReview();
    const req = requestAs({
      method: "POST",
      url: `http://test/api/reviews/${review._id}/reply`,
      session: await createTestSession(employeeWithoutReviews._id),
      body: { text: "Should not be allowed" },
    });
    const res = await replyPOST(req, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal(res.status, 403);
  });

  test("reply succeeds for an employee WITH REVIEWS_MANAGE, and for admin", async () => {
    const { review } = await makeReview();
    const req = requestAs({
      method: "POST",
      url: `http://test/api/reviews/${review._id}/reply`,
      session: await createTestSession(employeeWithReviews._id),
      body: { text: "Thanks for the feedback!" },
    });
    const res = await replyPOST(req, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.review.adminReply.text, "Thanks for the feedback!");
  });

  test("reply on a nonexistent review returns 404", async () => {
    const fakeId = "507f1f77bcf86cd799439011";
    const req = requestAs({
      method: "POST",
      url: `http://test/api/reviews/${fakeId}/reply`,
      session: await createTestSession(admin._id),
      body: { text: "x" },
    });
    const res = await replyPOST(req, { params: Promise.resolve({ id: fakeId }) });
    assert.equal(res.status, 404);
  });
});
