// Opening live-update streams is metered per shopper. Each open stream polls
// the database every second, so one account must not be able to hold hundreds
// open. See lib/rateLimitConfig.js's EVENT_STREAM_USER_LIMIT.

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
  rawQuery,
} from "./helpers/testDb.mjs";

describe("GET /api/user/events — stream opens are rate limited per shopper", { skip: !dbReady && skipReason }, () => {
  let GET;
  let session, otherSession;

  before(async () => {
    process.env.RATE_LIMIT_EVENT_STREAM_USER_MAX = "2";
    await connectTestDb();
    await truncateAll();
    ({ GET } = await import("../app/api/user/events/route.js"));
    session = await createTestSession((await createTestUser({ role: "customer" }))._id);
    otherSession = await createTestSession((await createTestUser({ role: "customer" }))._id);
  });

  after(async () => {
    await rawQuery("DELETE FROM rate_limit_counters");
    await disconnectTestDb();
    delete process.env.RATE_LIMIT_EVENT_STREAM_USER_MAX;
  });

  // Open a stream and hang up at once, as a browser closing the tab would —
  // the route stops polling on the request's abort signal. The test only
  // cares whether the stream was accepted.
  async function open(as) {
    const hangUp = new AbortController();
    const res = await GET(requestAs({ method: "GET", url: "http://test/api/user/events", session: as, signal: hangUp.signal }));
    hangUp.abort();
    await res.body?.cancel().catch(() => {});
    return res.status;
  }

  test("streams up to the limit open; the next is refused with 429", async () => {
    assert.equal(await open(session), 200);
    assert.equal(await open(session), 200);
    assert.equal(await open(session), 429);
  });

  test("another shopper is unaffected", async () => {
    assert.equal(await open(otherSession), 200);
  });
});
