#!/usr/bin/env node
// Deterministic HTTP-integration test-server harness (Phase 1, section D;
// converted to MySQL/MariaDB as part of the Mongo -> MySQL migration).
//
// Orchestrates the whole lifecycle for tests/http/*.test.mjs in one place,
// so no individual test file ever starts (or races to start) its own
// server:
//   1. Validate the isolated test database (lib/testDbSafety.js — the same
//      shared guard scripts/assertTestDbSafety.mjs uses: DB_NAME must be
//      explicitly set, must not be "ladies_multi_ecomm", must end in
//      "_test"/"_ci", and must be on localhost unless explicitly overridden).
//   2. Connect via config/db.js's own pool, re-verify the LIVE connection
//      really is talking to that exact database (defense in depth — never
//      trust the resolved config alone right before a destructive
//      operation), then TRUNCATE every table (tests/helpers/testDb.mjs's
//      truncateAll(), which carries its own independent dbReady guard) and
//      reseed via scripts/seedCatalog.mjs so the HTTP suites' seed-data
//      assumptions (e.g. "Burqa"/"Hijab" departments exist) are met
//      deterministically on every run.
//   3. Pick a verified-free port (OS-assigned ephemeral port via `:0`,
//      not a fixed number — avoids colliding with a developer's own
//      `next dev` on 3000 or anything else already listening).
//   4. Spawn `next start -p <port>` with DB_HOST/DB_PORT/DB_NAME/DB_USER/
//      DB_PASSWORD explicitly set on its own env, sourced from THIS
//      process's already-verified-safe values — never left to `next
//      start`'s own .env/.env.local loading, which would resolve to the
//      real ladies_multi_ecomm application database (see config/db.js:
//      unlike the old Mongoose connectDB(), it has no MONGO_URI_DEV-style
//      environment tiering of its own, so this explicit override is the
//      ONLY thing standing between this harness and testing against
//      production data).
//   5. Poll a bounded health check; fail loudly on timeout, dumping the
//      captured server log.
//   6. Run the HTTP test files with HTTP_TEST_BASE_URL set to the actual
//      chosen port.
//   7. ALWAYS stop the server afterward — success, test failure, or an
//      interrupting signal (SIGINT/SIGTERM) — so no Node process is ever
//      left running behind this script.
//
// Usage: node --env-file-if-exists=.env.test scripts/httpTestServer.mjs run [testFileGlob...]
// Requires a completed `next build` (this script does not build itself —
// see the "pretest:http" npm script, which runs `npm run build` first).

// Forced here (not just relied on from the npm script) because
// tests/helpers/testDb.mjs's dbReady / truncateAll() gate on this
// explicitly, and this file is sometimes invoked directly during local
// debugging without going through "npm run test:http".
process.env.NODE_ENV = "test";

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, openSync, closeSync, unlinkSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkTestDbConfig, assertConnectedDbMatches } from "../lib/testDbSafety.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOG_DIR = path.join(ROOT, ".phase1-http-test-logs");
const LOCK_PATH = path.join(LOG_DIR, "server.lock");

function fail(message) {
  console.error(`\n✖ ${message}\n`);
}

function log(message) {
  console.log(`[httpTestServer] ${message}`);
}

// ---- Lockfile: prevent competing/overlapping harness invocations ----
function acquireLock() {
  mkdirSync(LOG_DIR, { recursive: true });
  try {
    const fd = openSync(LOCK_PATH, "wx"); // fails if it already exists
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch (err) {
    if (err.code === "EEXIST") {
      throw new Error(
        `${LOCK_PATH} already exists — another httpTestServer.mjs run may be in progress (pid ${readFileSync(LOCK_PATH, "utf8").trim()}). ` +
          `If you're sure none is, delete this file and retry.`,
      );
    }
    throw err;
  }
}
function releaseLock() {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // best-effort
  }
}

// ---- Free, verified-unused port ----
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function runToCompletion(cmd, args, { env, logFile, inherit = false }) {
  return new Promise((resolve) => {
    const stdio = inherit ? "inherit" : ["ignore", openSync(logFile, "a"), openSync(logFile, "a")];
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

// The exact DB_* vars a spawned process needs to connect to the SAME
// database this orchestrator itself just verified — never let a spawned
// child (the reseed script, or the real `next start` server) fall back to
// its own .env/.env.local resolution, which would silently point at the
// real application database.
function testDbEnv() {
  return {
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_NAME: process.env.DB_NAME,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD ?? "",
  };
}

async function main() {
  const [, , mode, ...rest] = process.argv;
  if (mode !== "run") {
    console.error("Usage: node scripts/httpTestServer.mjs run [testFileGlob...]");
    process.exitCode = 1;
    return;
  }

  mkdirSync(LOG_DIR, { recursive: true });
  const serverLog = path.join(LOG_DIR, "next-server.log");
  const seedLog = path.join(LOG_DIR, "seed.log");
  writeFileSync(serverLog, "");
  writeFileSync(seedLog, "");

  const dbName = process.env.DB_NAME;
  const dbHost = process.env.DB_HOST || "127.0.0.1";
  const configCheck = checkTestDbConfig({
    dbName,
    host: dbHost,
    allowRemoteHost: process.env.ALLOW_REMOTE_TEST_DB === "true",
  });
  if (!configCheck.ok) {
    fail(configCheck.reason);
    process.exitCode = 1;
    return;
  }

  try {
    acquireLock();
  } catch (err) {
    fail(err.message);
    process.exitCode = 1;
    return;
  }

  let serverProcess;
  let exitCode = 1;
  let cleanedUp = false;
  let closePool;

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (serverProcess && serverProcess.exitCode === null) {
      log(`stopping test server (pid ${serverProcess.pid})`);
      serverProcess.kill("SIGTERM");
    }
    if (closePool) await closePool().catch(() => {});
    releaseLock();
  };
  process.once("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", async () => {
    await cleanup();
    process.exit(143);
  });

  try {
    log(`isolated test database confirmed: "${dbName}"`);

    // Connect via the app's own pool (config/db.js), re-verify the LIVE
    // connection really is this exact database (not just the resolved
    // config — see lib/testDbSafety.js's own doc comment for why), then
    // truncate + reseed.
    const dbModule = await import("../config/db.js");
    closePool = dbModule.closePool;
    await dbModule.default(); // connectDB() — cheap SELECT 1 reachability probe
    await assertConnectedDbMatches(dbModule.query, dbName);

    log("truncating and reseeding the disposable test database...");
    const { truncateAll } = await import("../tests/helpers/testDb.mjs");
    await truncateAll();

    const seedExit = await runToCompletion("node", ["scripts/seedCatalog.mjs"], {
      env: { ...process.env, ...testDbEnv(), NODE_ENV: "test" },
      logFile: seedLog,
    });
    if (seedExit !== 0) {
      fail(`Seeding the test database failed (exit ${seedExit}) — see ${seedLog}`);
      exitCode = 1;
      return;
    }
    log("seed complete");

    // `unstable_cache()` (lib/serverDataCache.js) persists its entries to
    // disk at .next/cache/fetch-cache — NOT just in-memory — and that
    // directory survives across `next start` invocations, and even across
    // `npm run build` (Next's build cache is deliberately incremental/
    // persistent for build speed). Without clearing it, a `next start`
    // spawned here can serve a page from a cache entry populated by an
    // EARLIER run — one this run's own fresh truncate+reseed above never
    // gets a chance to invalidate, since revalidateTag() only invalidates
    // tags an actual mutation in THIS run calls, not stale entries left
    // over from a previous one. This is exactly what "deterministic" in
    // this file's own header comment promises and what a stale cache
    // would silently violate.
    rmSync(path.join(ROOT, ".next/cache/fetch-cache"), { recursive: true, force: true });

    const port = await findFreePort();
    log(`using free port ${port}`);

    const baseUrl = `http://127.0.0.1:${port}`;
    const logFd = openSync(serverLog, "a");
    serverProcess = spawn("node_modules/.bin/next", ["start", "-p", String(port)], {
      cwd: ROOT,
      env: {
        ...process.env,
        // Explicit DB_* override — see this file's own header comment for
        // why this, not next start's own .env/.env.local resolution, is
        // what actually keeps this real server instance off the real
        // application database.
        ...testDbEnv(),
        PORT: String(port),
        // The port is only known once findFreePort() resolves, so it can't
        // come from a static .env.test value — set it explicitly here so
        // this harness exercises the SAME explicit-APP_ORIGIN code path a
        // real deployment uses (lib/csrf.js's canonicalOrigin()), not just
        // the same-origin fallback meant for local single-process dev.
        APP_ORIGIN: baseUrl,
        // Phase 3B: `next start` always runs as a production server
        // regardless of NODE_ENV (confirmed in this codebase's own Phase 2
        // closure) — which means, WITHOUT this, register/reset-password's
        // Phase 3B fail-closed policy (lib/clientIp.js's requireClientIp())
        // would make this test server's default configuration behave
        // exactly like an unconfigured real deployment: those two routes
        // would 503 on every request, since no proxy trust is configured.
        // That fail-closed behavior itself IS tested — directly, in
        // tests/rateLimit.test.mjs, by forcing NODE_ENV=production
        // in-process (the exact same code path a real unconfigured
        // deployment hits, without needing a second real server here).
        // This harness's one real server instead runs WITH proxy trust
        // configured, matching a real deployment that HAS completed the
        // required setup — so the real-HTTP suite can verify correct IP
        // selection, per-IP bucket isolation, and spoofing resistance
        // against an actual running server.
        TRUST_PROXY_HEADERS: "true",
        TRUSTED_PROXY_HOP_COUNT: "1",
        // Test-only cache-activity tracing for
        // tests/http/serverCacheBehavior.integration.test.mjs — this is
        // Next's own internal debug switch
        // (node_modules/next/dist/server/lib/incremental-cache/file-system-cache.js's
        // `FileSystemCache.debug`), which ONLY gates extra `console.log`
        // calls inside FileSystemCache.get()/.set() (the key, and for
        // .get(), whether it was served from the in-memory store). It does
        // not change what gets cached, when, or for how long — verified by
        // reading that file directly: every `if (FileSystemCache.debug)`
        // block wraps only a console.log, nothing else. This lets that one
        // test file observe real get/set cache-handler activity for the
        // SPECIFIC request it just made (see this script's own
        // HTTP_TEST_SERVER_LOG_PATH, below) instead of inferring anything
        // from filesystem timing.
        NEXT_PRIVATE_DEBUG_CACHE: "1",
      },
      stdio: ["ignore", logFd, logFd],
    });

    const readyTimeoutMs = 45_000;
    const start = Date.now();
    let ready = false;
    while (Date.now() - start < readyTimeoutMs) {
      if (serverProcess.exitCode !== null) break; // crashed before we could poll it
      try {
        const res = await fetch(`${baseUrl}/api/settings/public`);
        if (res.status < 500) {
          ready = true;
          break;
        }
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    if (!ready) {
      closeSync(logFd);
      const tail = readFileSync(serverLog, "utf8").split("\n").slice(-40).join("\n");
      fail(`Test server did not become ready within ${readyTimeoutMs}ms. Last server log lines:\n${tail}`);
      exitCode = 1;
      return;
    }
    log(`server ready at ${baseUrl}`);

    const testGlob = rest.length ? rest : ["tests/http/*.test.mjs"];
    // --import registers the same "next/*" bare-subpath resolution hook the
    // main "test" script uses (see tests/helpers/nextResolveHook.mjs) —
    // these HTTP suites mostly avoid importing anything that touches
    // next/server, but productFilters.integration.test.mjs's before() does
    // (via services/productService.js -> lib/http.js -> next/server), so
    // this is required here too, not optional.
    exitCode = await runToCompletion(
      "node",
      ["--import", "./tests/helpers/nextResolveHook.mjs", "--test", "--test-concurrency=1", ...testGlob],
      {
        env: {
          ...process.env,
          ...testDbEnv(),
          HTTP_TEST_BASE_URL: baseUrl,
          NODE_ENV: "test",
          // Lets tests/http/serverCacheBehavior.integration.test.mjs tail
          // this exact run's server log for the NEXT_PRIVATE_DEBUG_CACHE
          // get/set lines above — same file the "server did not become
          // ready" diagnostic above already reads from.
          HTTP_TEST_SERVER_LOG_PATH: serverLog,
        },
        inherit: true,
      },
    );
  } catch (err) {
    fail(`httpTestServer.mjs failed: ${err.stack || err.message}`);
    exitCode = 1;
  } finally {
    await cleanup();
  }

  process.exitCode = exitCode;
}

main();
