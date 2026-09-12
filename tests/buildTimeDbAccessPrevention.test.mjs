// Performance audit — regression coverage for the build-time Production
// database-access bug found and fixed in this pass: `npm run build` was
// silently connecting to and reading from MONGO_URI (this project's
// Production database) because app/(routes)/layout.jsx fetched categories
// with no `force-dynamic` guard, and Next's static-generation probe
// executed that layout during the build itself. Two independent layers
// were added and both are proven here: the storefront layout's own
// `force-dynamic` export (should stop Next from ever probing it at build
// time), and config/db.js's NEXT_PHASE fail-safe (stops any OTHER future
// unguarded data fetch from repeating the same bug).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import connectDB from "../config/db.js";
import { disconnectTestDb } from "./helpers/testDb.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("Performance audit — build-time database-access prevention", () => {
  // The "still connects normally" test below opens a real connection via
  // connectDB() directly (not through testDb.mjs's own connectTestDb()
  // wrapper, since this file needs to call connectDB() itself to exercise
  // the guard) — without closing it here, the open MongoDB socket keeps
  // this file's own test-runner child process alive after its assertions
  // finish, which (per tests/helpers/testDb.mjs's own documented warning)
  // silently stalls every subsequent file in the same `test:core` run.
  after(async () => {
    await disconnectTestDb();
  });


  test("connectDB() throws immediately when NEXT_PHASE is phase-production-build, before any network attempt", async () => {
    // test:core runs every tests/*.test.mjs file in ONE shared process
    // (--test-concurrency=1, see package.json) — by the time this test
    // runs, an earlier test file has almost certainly already populated
    // globalThis.__mongooseCache with a real, live connection to
    // MONGO_URI_TEST. That cached connection is checked BEFORE the
    // NEXT_PHASE guard (config/db.js's own short-circuit for the normal,
    // legitimate case of a warm instance reusing its pool), so without
    // resetting it here this test would trivially "pass" without ever
    // exercising the guard it exists to prove.
    const cache = globalThis.__mongooseCache;
    const savedConn = cache?.conn;
    const savedPromise = cache?.promise;
    if (cache) {
      cache.conn = null;
      cache.promise = null;
    }
    const savedPhase = process.env.NEXT_PHASE;
    process.env.NEXT_PHASE = "phase-production-build";

    try {
      await assert.rejects(
        () => connectDB(),
        (err) => {
          assert.match(err.message, /NEXT_PHASE=phase-production-build/);
          assert.match(err.message, /force-dynamic/);
          return true;
        },
      );
    } finally {
      // Restore exactly what was there before — this test must never
      // affect any other test file's ability to use the real test
      // database, regardless of pass/fail above.
      if (savedPhase === undefined) delete process.env.NEXT_PHASE;
      else process.env.NEXT_PHASE = savedPhase;
      if (cache) {
        cache.conn = savedConn;
        cache.promise = savedPromise;
      }
    }
  });

  test("connectDB() still connects normally (NEXT_PHASE unset) — the guard only fires during an actual build, never at request time", async () => {
    delete process.env.NEXT_PHASE;
    const conn = await connectDB();
    assert.ok(conn, "connectDB() must still resolve to a real connection outside a build");
  });

  test("app/(routes)/layout.jsx declares force-dynamic — the storefront's own guard against being probed for static generation", () => {
    const content = read("app/(routes)/layout.jsx");
    assert.match(content, /export const dynamic = ["']force-dynamic["']/);
  });

  test("app/sitemap.js still declares its own pre-existing force-dynamic guard (the precedent this fix followed)", () => {
    const content = read("app/sitemap.js");
    assert.match(content, /export const dynamic = ["']force-dynamic["']/);
  });
});
