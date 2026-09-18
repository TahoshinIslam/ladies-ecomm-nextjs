// Performance audit — regression coverage for the build-time Production
// database-access bug found and fixed in this pass: `npm run build` was
// silently connecting to and reading from the Production database (MONGO_URI
// pre-migration, DB_NAME post-migration) because app/(routes)/layout.jsx
// fetched categories with no `force-dynamic` guard, and Next's
// static-generation probe executed that layout during the build itself. Two
// independent layers were added and both are proven here: the storefront
// layout's own `force-dynamic` export (should stop Next from ever probing it
// at build time), and config/db.js's NEXT_PHASE fail-safe (stops any OTHER
// future unguarded data fetch from repeating the same bug).
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
  // the guard) — without closing it here, the open pool keeps this file's
  // own test-runner child process alive after its assertions finish, which
  // (per tests/helpers/testDb.mjs's own documented warning) silently stalls
  // every subsequent file in the same `test:core` run.
  after(async () => {
    await disconnectTestDb();
  });

  test("connectDB() throws immediately when NEXT_PHASE is phase-production-build, before any network attempt", async () => {
    // Unlike the old Mongoose connectDB(), config/db.js's getPool() runs
    // assertNotBuildPhase() unconditionally as its very first line, before
    // even checking globalThis.__mysqlPoolCache — so, unlike the old
    // Mongoose guard, this fires even with an already-warm pool from an
    // earlier test file in this same `test:core` process. No cache reset
    // is needed to actually exercise it, but restoring NEXT_PHASE
    // afterward still matters so this test never affects any other test
    // file's ability to use the real test database.
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
      if (savedPhase === undefined) delete process.env.NEXT_PHASE;
      else process.env.NEXT_PHASE = savedPhase;
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
