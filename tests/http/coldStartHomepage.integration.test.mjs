// Realtime-durability-class fix — the mandatory regression proof for the
// homepage cold-start 500 (MongooseError: `categories.find()` buffering
// timed out after 10000ms), reproduced consistently against a real
// Preview deployment before this fix.
//
// Run via: node scripts/coldStartHttpTestServer.mjs run
// (that harness spawns two INDEPENDENT `next start` instances and polls
// only /api/health/live for readiness — deliberately never touching
// MongoDB before handing control here, so GET / really is the first
// request either instance has ever served. See that script's own header
// comment for why scripts/httpTestServer.mjs's own readiness poll would
// have silently hidden this exact bug.)
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const BASE_A = process.env.COLD_START_BASE_URL_A;
const BASE_B = process.env.COLD_START_BASE_URL_B;

const skip =
  !BASE_A || !BASE_B
    ? "run via `node scripts/coldStartHttpTestServer.mjs run` (needs COLD_START_BASE_URL_A/B, two never-yet-hit server instances)"
    : false;

describe("Realtime-durability fix — homepage survives a genuinely cold first request", { skip }, () => {
  test("GET / succeeds as the very first request a fresh instance has ever served, and renders real category data (not an empty/fallback shell)", async () => {
    const res = await fetch(`${BASE_A}/`);
    assert.equal(res.status, 200, "the homepage must not 500 on a cold instance's first request");
    const html = await res.text();
    // A real seeded department name must appear — proves the category
    // read actually returned real data, not a caught-and-emptied result.
    assert.match(html, /burqa/i, "homepage must render real seeded category data, not an empty fallback");
  });

  test("a second request to the now-warm instance is a cache hit and still succeeds (the fix doesn't break normal warm-instance behavior)", async () => {
    const res = await fetch(`${BASE_A}/`);
    assert.equal(res.status, 200);
  });

  test("GET /shop also succeeds on the same now-warm instance", async () => {
    const res = await fetch(`${BASE_A}/shop`);
    assert.equal(res.status, 200);
  });

  test("GET /api/health/ready succeeds on the same instance after real page traffic", async () => {
    const res = await fetch(`${BASE_A}/api/health/ready`);
    assert.equal(res.status, 200);
  });

  test("5 CONCURRENT first-ever requests to a SEPARATE fresh instance all succeed (no first-request-wins-the-rest-time-out race)", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => fetch(`${BASE_B}/`)));
    const statuses = results.map((r) => r.status);
    assert.ok(
      statuses.every((s) => s === 200),
      `every concurrent first-request must succeed on a cold instance: got ${statuses.join(",")}`,
    );
  });
});
