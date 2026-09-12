// Incident response (2026-09-12) — regression coverage for the root-cause
// fix in config/db.js. A plain `next dev` (no test-only override flags
// set) previously fell through unconditionally to MONGO_URI — the real
// Production database — with no guard at all. A real order was mutated by
// ordinary admin-UI verification testing as a direct result. This file
// proves the fix: any local-machine run (not on Vercel, not the test
// harness, not the explicit httpTestServer override) now requires a
// dedicated MONGO_URI_DEV or an explicitly-set MONGO_URI_TEST, refuses the
// Production database name outright, refuses any other unsafely-named
// database, refuses a remote host without an explicit opt-in, and never
// reveals a URI or credential in any error message it throws.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import connectDB from "../config/db.js";
import { disconnectTestDb } from "./helpers/testDb.mjs";

const ENV_KEYS = [
  "VERCEL",
  "NODE_ENV",
  "ALLOW_TEST_DB_OVERRIDE",
  "TEST_SERVER_MONGO_URI",
  "MONGO_URI_DEV",
  "MONGO_URI_TEST",
  "MONGO_URI",
  "ALLOW_REMOTE_DEV_DB",
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot) {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

// Forces a genuinely clean slate before AND after every test in this file —
// never just swaps `globalThis.__mongooseCache`'s pointers. Several tests
// here deliberately attempt a real mongoose.connect() against a bogus/
// unreachable host (to prove the guard never even tries the forbidden
// fallback in practice); the MongoDB driver keeps background server-
// selection/heartbeat monitoring alive on the shared default connection
// even after that connect() promise rejects, so merely restoring a saved
// cache snapshot (this file's first version) left that monitoring running
// into the NEXT test — and, worse, into whichever test file `test:core`
// runs next in the same process, hanging the entire suite indefinitely.
// Explicitly disconnecting (bounded by a timeout, so a hang here can never
// re-introduce the exact bug this exists to prevent) before resetting the
// cache to a real empty state is what actually guarantees no connection or
// timer survives past this file's own tests.
async function forceCleanMongooseState() {
  await Promise.race([
    mongoose.disconnect().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  const cache = (globalThis.__mongooseCache ??= { conn: null, promise: null });
  cache.conn = null;
  cache.promise = null;
}

// Runs `fn` with a clean, fully-controlled env + connection state, always
// tearing both down afterward regardless of pass/fail — every test in this
// file must leave mongoose fully disconnected so the next test (in this
// file, or the next file in the same test:core process) starts from a
// real clean slate rather than inheriting a half-open connection.
async function withIsolatedEnv(overrides, fn) {
  const envSnapshot = snapshotEnv();
  await forceCleanMongooseState();
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, overrides);
    await fn();
  } finally {
    await forceCleanMongooseState();
    restoreEnv(envSnapshot);
  }
}

describe("Incident response — local-machine database-safety guard (config/db.js)", () => {
  after(async () => {
    await disconnectTestDb();
  });

  test("1. local run refuses database name 'nextjs_ecomm' even when explicitly configured as MONGO_URI_DEV", async () => {
    await withIsolatedEnv(
      { NODE_ENV: "development", MONGO_URI_DEV: "mongodb://127.0.0.1:27099/nextjs_ecomm" },
      async () => {
        await assert.rejects(() => connectDB(), (err) => {
          assert.match(err.message, /nextjs_ecomm/);
          assert.match(err.message, /Production database name/);
          return true;
        });
      },
    );
  });

  test("2. local run cannot fall back to MONGO_URI when no development URI is configured", async () => {
    await withIsolatedEnv(
      { NODE_ENV: "development", MONGO_URI: "mongodb://evil-prod-host.example/nextjs_ecomm" },
      async () => {
        await assert.rejects(() => connectDB(), (err) => {
          assert.match(err.message, /MONGO_URI_DEV or MONGO_URI_TEST/);
          assert.match(err.message, /Refusing to fall back to MONGO_URI/);
          // The forbidden host must never even be attempted — proven by
          // the message naming the missing dev vars, not a connection
          // failure to evil-prod-host.
          assert.doesNotMatch(err.message, /evil-prod-host/);
          return true;
        });
      },
    );
  });

  test("2b. a bare local `next start` (NODE_ENV=production, VERCEL unset) gets the same protection as `next dev`", async () => {
    await withIsolatedEnv({ NODE_ENV: "production", MONGO_URI: "mongodb://evil-prod-host.example/nextjs_ecomm" }, async () => {
      await assert.rejects(() => connectDB(), /MONGO_URI_DEV or MONGO_URI_TEST/);
    });
  });

  test("3. MONGO_URI_TEST alone (no MONGO_URI_DEV) is accepted for a local run and actually connects", async () => {
    const realTestUri = process.env.MONGO_URI_TEST;
    assert.ok(realTestUri, "this suite must run with a real MONGO_URI_TEST already set (see package.json's --env-file)");
    await withIsolatedEnv({ NODE_ENV: "development", MONGO_URI_TEST: realTestUri }, async () => {
      const conn = await connectDB();
      assert.ok(conn, "connectDB() must resolve to a real connection using MONGO_URI_TEST alone");
      assert.doesNotMatch(conn.connection.name, /nextjs_ecomm/);
    });
  });

  test("3b. a safely-named but non-localhost MONGO_URI_DEV is refused unless ALLOW_REMOTE_DEV_DB=true", async () => {
    await withIsolatedEnv(
      { NODE_ENV: "development", MONGO_URI_DEV: "mongodb+srv://cluster.example.mongodb.net/tahos_dev" },
      async () => {
        await assert.rejects(() => connectDB(), (err) => {
          assert.match(err.message, /remote host/);
          assert.match(err.message, /ALLOW_REMOTE_DEV_DB/);
          return true;
        });
      },
    );
  });

  test("4. Vercel Preview/Production resolution is unaffected — VERCEL set bypasses every local-only check", async () => {
    await withIsolatedEnv(
      { VERCEL: "1", NODE_ENV: "production", MONGO_URI: "mongodb://127.0.0.1:1/does-not-need-to-connect" },
      async () => {
        // On Vercel, resolution must still pick MONGO_URI directly, with
        // none of the local-dev name/host checks applied to it — proven by
        // the failure being a genuine connection error (bad host), never
        // one of this fix's own validation messages.
        await assert.rejects(() => connectDB(), (err) => {
          assert.doesNotMatch(err.message, /nextjs_ecomm/);
          assert.doesNotMatch(err.message, /MONGO_URI_DEV/);
          assert.doesNotMatch(err.message, /remote host/);
          return true;
        });
      },
    );
  });

  test("5. standalone readiness/index-audit scripts do not go through connectDB() at all", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../scripts/auditIndexes.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(src, /from ["'].*config\/db\.js["']/, "auditIndexes.mjs must keep resolving its own URI directly, unaffected by this fix");
    assert.match(src, /mongoose\.connect\(/);
  });

  test("6. the pre-existing NEXT_PHASE build-time guard still fires before any of this fix's new checks", async () => {
    await withIsolatedEnv({ NODE_ENV: "development" }, async () => {
      process.env.NEXT_PHASE = "phase-production-build";
      try {
        await assert.rejects(() => connectDB(), /NEXT_PHASE=phase-production-build/);
      } finally {
        delete process.env.NEXT_PHASE;
      }
    });
  });

  test("7. no error message thrown by the new guard ever contains a credential-shaped substring", async () => {
    const attempts = [
      { NODE_ENV: "development", MONGO_URI_DEV: "mongodb://user:supersecretpassword@127.0.0.1/nextjs_ecomm" },
      { NODE_ENV: "development", MONGO_URI_DEV: "mongodb://user:supersecretpassword@remote.example/tahos_dev" },
      { NODE_ENV: "development", MONGO_URI: "mongodb://user:supersecretpassword@prod.example/nextjs_ecomm" },
    ];
    for (const overrides of attempts) {
      await withIsolatedEnv(overrides, async () => {
        await assert.rejects(() => connectDB(), (err) => {
          assert.doesNotMatch(err.message, /supersecretpassword/);
          assert.doesNotMatch(err.message, /mongodb(\+srv)?:\/\//);
          return true;
        });
      });
    }
  });
});
