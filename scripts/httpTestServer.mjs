#!/usr/bin/env node
// Deterministic HTTP-integration test-server harness (Phase 1, section D).
//
// Orchestrates the whole lifecycle for tests/http/*.test.mjs in one place,
// so no individual test file ever starts (or races to start) its own
// server:
//   1. Validate the isolated test database (reuses the same safety rules
//      as scripts/assertTestDbSafety.mjs — never MONGO_URI, never a
//      hosted-provider host, database name must contain "test").
//   2. Wipe and re-seed that database (scripts/seedCatalog.mjs) so the two
//      HTTP suites' seed-data assumptions (e.g. "Burqa"/"Hijab"
//      departments exist) are met deterministically on every run.
//   3. Pick a verified-free port (OS-assigned ephemeral port via `:0`,
//      not a fixed number — avoids colliding with a developer's own
//      `next dev` on 3000 or anything else already listening).
//   4. Spawn `next start -p <port>` with the double-gated
//      ALLOW_TEST_DB_OVERRIDE / TEST_SERVER_MONGO_URI env vars (see
//      config/db.js) so this one server process — and only this one — is
//      pointed at the disposable test database, never production/dev.
//   5. Poll a bounded health check; fail loudly on timeout, dumping the
//      captured server log.
//   6. Run the HTTP test files with HTTP_TEST_BASE_URL set to the actual
//      chosen port.
//   7. ALWAYS stop the server afterward — success, test failure, or an
//      interrupting signal (SIGINT/SIGTERM) — so no Node process is ever
//      left running behind this script.
//
// Usage: node scripts/httpTestServer.mjs run [testFileGlob...]
// Requires a completed `next build` (this script does not build itself —
// see the "pretest:http" npm script, which runs `npm run build` first).

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, openSync, closeSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

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

// ---- Reuse the same isolation rules as scripts/assertTestDbSafety.mjs ----
function assertIsolatedTestUri(uri) {
  const prodUri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI_TEST is not set");
  if (prodUri && uri === prodUri) throw new Error("MONGO_URI_TEST equals MONGO_URI — refusing to use it for the HTTP test server");
  const hostPatterns = [/mongodb\.net/i, /\.mongodb\.com/i, /amazonaws\.com/i, /compute\.internal/i];
  for (const p of hostPatterns) {
    if (p.test(uri)) throw new Error(`MONGO_URI_TEST matches a hosted-provider pattern (${p}) — refusing to use it`);
  }
  let dbName;
  try {
    dbName = decodeURIComponent(new URL(uri).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("MONGO_URI_TEST is not a parseable URI");
  }
  if (!dbName || !/test/i.test(dbName)) {
    throw new Error(`MONGO_URI_TEST's database name ("${dbName}") does not contain "test" — refusing to seed/serve from it`);
  }
  return dbName;
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

  let dbName;
  try {
    dbName = assertIsolatedTestUri(process.env.MONGO_URI_TEST);
  } catch (err) {
    fail(err.message);
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

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (serverProcess && serverProcess.exitCode === null) {
      log(`stopping test server (pid ${serverProcess.pid})`);
      serverProcess.kill("SIGTERM");
    }
    releaseLock();
  };
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  try {
    log(`isolated test database confirmed: "${dbName}"`);

    log("wiping and reseeding the disposable test database...");
    await mongoose.connect(process.env.MONGO_URI_TEST);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();

    const seedExit = await runToCompletion("node", ["scripts/seedCatalog.mjs"], {
      env: { ...process.env, NODE_ENV: "test" },
      logFile: seedLog,
    });
    if (seedExit !== 0) {
      fail(`Seeding the test database failed (exit ${seedExit}) — see ${seedLog}`);
      exitCode = 1;
      return;
    }
    log("seed complete");

    const port = await findFreePort();
    log(`using free port ${port}`);

    const baseUrl = `http://127.0.0.1:${port}`;
    const logFd = openSync(serverLog, "a");
    serverProcess = spawn("node_modules/.bin/next", ["start", "-p", String(port)], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(port),
        ALLOW_TEST_DB_OVERRIDE: "true",
        TEST_SERVER_MONGO_URI: process.env.MONGO_URI_TEST,
        // The port is only known once findFreePort() resolves, so it can't
        // come from a static .env.test value — set it explicitly here so
        // this harness exercises the SAME explicit-APP_ORIGIN code path a
        // real deployment uses (lib/csrf.js's canonicalOrigin()), not just
        // the same-origin fallback meant for local single-process dev.
        APP_ORIGIN: baseUrl,
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
        env: { ...process.env, HTTP_TEST_BASE_URL: baseUrl, NODE_ENV: "test" },
        inherit: true,
      },
    );
  } catch (err) {
    fail(`httpTestServer.mjs failed: ${err.stack || err.message}`);
    exitCode = 1;
  } finally {
    cleanup();
  }

  process.exitCode = exitCode;
}

main();
