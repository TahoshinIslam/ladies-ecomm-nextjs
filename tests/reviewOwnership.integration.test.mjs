// Phase 1 regression-safety-net: review ownership enforcement.
//
// Directly inspects the four review Route Handlers named in the Phase 1
// prompt — PUT/DELETE /api/reviews/[id], POST .../helpful,
// by calling their exported functions with real Request objects.
//
// The reply endpoint that used to be covered here (POST .../reply) moved to
// the admin dashboard with the rest of shop management, and with it the two
// tests that a customer and an unprivileged employee were refused. The
// "an admin can edit or delete someone else's review" cases went too: this
// app cannot mint a session with that authority any more.
// objects, against a real (test-only) MongoDB. No assumption is made about
// what these handlers do; every assertion below was derived from reading
// app/api/reviews/[id]/route.js, app/api/reviews/[id]/helpful/route.js
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
  truncateAll,
  createTestSession,
  requestAs,
  createTestUser,
  createTestProduct,
  createDeliveredOrderFor,
  deleteRows,
} from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

describe("review ownership — PUT/DELETE /api/reviews/[id], POST helpful", { skip: !canRun && reason }, () => {
  let PUT, DELETE, helpfulPOST;
  let owner, otherCustomer, employeeWithReviews, employeeWithoutReviews, admin;
  let Review;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ PUT, DELETE } = await import("../app/api/reviews/[id]/route.js"));
    ({ POST: helpfulPOST } = await import("../app/api/reviews/[id]/helpful/route.js"));
    ({ default: Review } = await import("../models/reviewModel.js"));

    owner = await createTestUser({ role: "customer" });
    otherCustomer = await createTestUser({ role: "customer" });
    employeeWithReviews = await createTestUser({ role: "employee", permissions: ["reviews.manage"] });
    employeeWithoutReviews = await createTestUser({ role: "employee", permissions: [] });
    admin = await createTestUser({ role: "admin" });
  });

  after(async () => {
    await deleteRows("customers", "id", [owner._id, otherCustomer._id, employeeWithReviews._id, employeeWithoutReviews._id, admin._id]).catch(() => {});
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

  test("nonexistent (but valid-format) review id returns 404 on PUT/DELETE", async () => {
    const fakeId = "507f1f77bcf86cd799439011"; // well-formed ObjectId, no matching document
    const putReq = requestAs({ method: "PUT", url: `http://test/api/reviews/${fakeId}`, session: await createTestSession(owner._id), body: { comment: "x" } });
    const putRes = await PUT(putReq, { params: Promise.resolve({ id: fakeId }) });
    assert.equal(putRes.status, 404);

    const delReq = requestAs({ method: "DELETE", url: `http://test/api/reviews/${fakeId}`, session: await createTestSession(owner._id) });
    const delRes = await DELETE(delReq, { params: Promise.resolve({ id: fakeId }) });
    assert.equal(delRes.status, 404);
  });

  test("FIXED (Phase 5 ObjectId contract): malformed (non-ObjectId) review id now returns 400, not the old CastError-mapped 404 — a valid-but-nonexistent id (tested above) is still 404", async () => {
    // services/reviewService.js's updateReview() now calls
    // requireObjectIdFormat() before ever reaching Review.findById() — a
    // syntactically malformed id is a client input error (400), distinct
    // from a well-formed id that legitimately doesn't exist (404, still
    // covered above).
    const req = requestAs({ method: "PUT", url: "http://test/api/reviews/not-a-valid-id", session: await createTestSession(owner._id), body: { comment: "x" } });
    const res = await PUT(req, { params: Promise.resolve({ id: "not-a-valid-id" }) });
    assert.equal(res.status, 400);
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

  // Confirmed audit finding, fixed: markHelpful() previously had no
  // per-user vote tracking at all — see services/reviewService.js's
  // markHelpful() and scripts/migrations/0001_review_helpful_votes.mjs.
  // These three tests replace the old ones that documented the
  // vulnerability itself ("no dedup", "no user identity recorded") — they
  // now assert the fixed, dedup'd behavior instead.
  test("the SAME user calling markHelpful repeatedly only ever counts once — idempotent, not an error", async () => {
    const { review } = await makeReview();
    for (let i = 1; i <= 3; i++) {
      const req = requestAs({ method: "POST", url: `http://test/api/reviews/${review._id}/helpful`, session: await createTestSession(otherCustomer._id) });
      const res = await helpfulPOST(req, { params: Promise.resolve({ id: review._id.toString() }) });
      assert.equal(res.status, 200, `repeat vote #${i} from the same user must still succeed (idempotent no-op), not 409/error`);
      const json = await res.json();
      assert.equal(json.helpfulCount, 1, `call #${i} from the same user must NOT increment past 1 — per-user vote is deduplicated`);
    }
  });

  test("different users each get their own vote counted", async () => {
    const { review } = await makeReview();
    const req1 = requestAs({ method: "POST", url: `http://test/api/reviews/${review._id}/helpful`, session: await createTestSession(owner._id) });
    const res1 = await helpfulPOST(req1, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal((await res1.json()).helpfulCount, 1);

    const req2 = requestAs({ method: "POST", url: `http://test/api/reviews/${review._id}/helpful`, session: await createTestSession(otherCustomer._id) });
    const res2 = await helpfulPOST(req2, { params: Promise.resolve({ id: review._id.toString() }) });
    assert.equal((await res2.json()).helpfulCount, 2, "a genuinely different user's vote still increments the count");
  });

  test("helpful votes ARE now recorded per user identity, in review_helpful_votes", async () => {
    const { review } = await makeReview();
    const req = requestAs({ method: "POST", url: `http://test/api/reviews/${review._id}/helpful`, session: await createTestSession(otherCustomer._id) });
    await helpfulPOST(req, { params: Promise.resolve({ id: review._id.toString() }) });
    const { query } = await import("../config/db.js");
    const rows = await query("SELECT * FROM review_helpful_votes WHERE review_id = ? AND customer_id = ?", [review._id, otherCustomer._id]);
    assert.equal(rows.length, 1, "confirmed: the vote is now recorded against the voting user's identity");
  });

  test("N concurrent requests from the SAME user still land on exactly one vote — atomic dedup, not a race", async () => {
    const { review } = await makeReview();
    const CONCURRENT = 10;
    const fire = async () => {
      const req = requestAs({ method: "POST", url: `http://test/api/reviews/${review._id}/helpful`, session: await createTestSession(otherCustomer._id) });
      return helpfulPOST(req, { params: Promise.resolve({ id: review._id.toString() }) });
    };
    const results = await Promise.all(Array.from({ length: CONCURRENT }, fire));
    for (const res of results) assert.equal(res.status, 200);

    const final = await Review.findById(review._id);
    assert.equal(
      final.helpfulCount,
      1,
      "the review_helpful_votes PRIMARY KEY (review_id, customer_id) makes this atomic across a real race, not just sequential calls — exactly one of the 10 concurrent requests actually increments",
    );
  });

  test("N concurrent requests from DIFFERENT users all count — dedup is per-user, not a global lock", async () => {
    const { review } = await makeReview();
    const CONCURRENT = 8;
    const voters = await Promise.all(Array.from({ length: CONCURRENT }, () => createTestUser({ role: "customer" })));
    const fire = async (voter) => {
      const req = requestAs({ method: "POST", url: `http://test/api/reviews/${review._id}/helpful`, session: await createTestSession(voter._id) });
      return helpfulPOST(req, { params: Promise.resolve({ id: review._id.toString() }) });
    };
    const results = await Promise.all(voters.map(fire));
    for (const res of results) assert.equal(res.status, 200);

    const final = await Review.findById(review._id);
    assert.equal(final.helpfulCount, CONCURRENT, "every distinct concurrent voter's vote is counted, with no lost updates");
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

});
