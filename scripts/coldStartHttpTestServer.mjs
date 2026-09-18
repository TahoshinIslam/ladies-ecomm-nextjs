#!/usr/bin/env node
// Realtime-durability-class fix — regression harness for the cold-start
// homepage 500 that originally motivated this test (a MongooseError from
// an unbuffered `categories.find()` at the time; the underlying "first
// request must not have already warmed the DB connection" scenario is
// framework/driver-agnostic and still worth guarding for MySQL).
//
// Deliberately separate from scripts/httpTestServer.mjs: that harness's
// own readiness poll hits `/api/settings/public` (a DB-backed route)
// before handing control to the test files — which would itself
// establish the connection this bug depends on NEVER having happened yet.
// This harness polls ONLY `/api/health/live` (which by design never
// touches the database — see app/api/health/live/route.js), so the very
// first real request this spawned server instance ever serves can be the
// test's own GET / — a faithful reproduction of a genuinely cold instance
// whose first request is a Server Component page, not an API route that
// would have warmed the connection pool via lib/http.js's withRoute().
//
// Usage: node --env-file-if-exists=.env.test scripts/coldStartHttpTestServer.mjs run [testFileGlob...]

process.env.NODE_ENV = "test";

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, openSync, writeFileSync, readFileSync, closeSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkTestDbConfig, assertConnectedDbMatches } from "../lib/testDbSafety.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOG_DIR = path.join(ROOT, ".phase11-coldstart-logs");

function log(message) {
  console.log(`[coldStartHttpTestServer] ${message}`);
}
function fail(message) {
  console.error(`\n✖ ${message}\n`);
}

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

function runToCompletion(cmd, args, { env, logFile }) {
  return new Promise((resolve) => {
    const fd = openSync(logFile, "a");
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", fd, fd] });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

// Same "never let a spawned child fall back to its own .env/.env.local
// resolution" rationale as scripts/httpTestServer.mjs's own testDbEnv().
function testDbEnv() {
  return {
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_NAME: process.env.DB_NAME,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD: process.env.DB_PASSWORD ?? "",
  };
}

// Only ever polls /api/health/live — see this file's header comment for
// why that specific choice is load-bearing for the test this harness
// exists to run.
async function waitForLiveOnly(baseUrl, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health/live`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  const [, , mode, ...rest] = process.argv;
  if (mode !== "run") {
    console.error("Usage: node scripts/coldStartHttpTestServer.mjs run [testFileGlob...]");
    process.exitCode = 1;
    return;
  }

  mkdirSync(LOG_DIR, { recursive: true });
  const serverLogA = path.join(LOG_DIR, "instance-a.log");
  const serverLogB = path.join(LOG_DIR, "instance-b.log");
  writeFileSync(serverLogA, "");
  writeFileSync(serverLogB, "");

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

  const instances = [];
  let cleanedUp = false;
  let closePool;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const inst of instances) {
      if (inst?.exitCode === null) {
        log(`stopping instance (pid ${inst.pid})`);
        inst.kill("SIGTERM");
      }
    }
    if (closePool) await closePool().catch(() => {});
  };
  process.once("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", async () => {
    await cleanup();
    process.exit(143);
  });

  let exitCode = 1;
  try {
    log(`isolated test database confirmed: "${dbName}"`);
    log("truncating and reseeding the disposable test database...");
    const dbModule = await import("../config/db.js");
    closePool = dbModule.closePool;
    await dbModule.default();
    await assertConnectedDbMatches(dbModule.query, dbName);
    const { truncateAll } = await import("../tests/helpers/testDb.mjs");
    await truncateAll();

    const seedLog = path.join(LOG_DIR, "seed.log");
    writeFileSync(seedLog, "");
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

    // Close this orchestrator's own pool BEFORE spawning the "never
    // DB-touched yet" server instances below — an open pool here is
    // harmless in practice (each `next start` child gets its own process
    // and its own pool), but closing it keeps this script's intent
    // honest: nothing it does after this point may implicitly warm any
    // connection the spawned instances will use.
    await closePool();
    closePool = undefined;

    // See scripts/httpTestServer.mjs's own comment on this exact line —
    // unstable_cache() persists to disk at .next/cache/fetch-cache across
    // `next start` invocations; without clearing it, a "never DB-touched
    // yet" instance could still serve a stale cached page on its very
    // first request, defeating the whole point of this harness.
    rmSync(path.join(ROOT, ".next/cache/fetch-cache"), { recursive: true, force: true });

    const [portA, portB] = await Promise.all([findFreePort(), findFreePort()]);

    async function spawnFreshInstance(label, port, logFile) {
      const baseUrl = `http://127.0.0.1:${port}`;
      const child = spawn("node_modules/.bin/next", ["start", "-p", String(port)], {
        cwd: ROOT,
        env: {
          ...process.env,
          ...testDbEnv(),
          PORT: String(port),
          APP_ORIGIN: baseUrl,
        },
        stdio: ["ignore", openSync(logFile, "a"), openSync(logFile, "a")],
      });
      instances.push(child);

      const ready = await waitForLiveOnly(baseUrl, 45_000);
      if (!ready) {
        const tail = readFileSync(logFile, "utf8").split("\n").slice(-40).join("\n");
        throw new Error(`Instance ${label} did not become live within 45s. Last log lines:\n${tail}`);
      }
      log(`instance ${label} live (never DB-touched yet) at ${baseUrl} (pid ${child.pid})`);
      return baseUrl;
    }

    const [baseUrlA, baseUrlB] = await Promise.all([
      spawnFreshInstance("A", portA, serverLogA),
      spawnFreshInstance("B", portB, serverLogB),
    ]);

    const testGlob = rest.length ? rest : ["tests/http/coldStartHomepage.integration.test.mjs"];
    const testProcess = spawn(
      "node",
      ["--experimental-test-module-mocks", "--import", "./tests/helpers/nextResolveHook.mjs", "--test", ...testGlob],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          ...testDbEnv(),
          NODE_ENV: "test",
          COLD_START_BASE_URL_A: baseUrlA,
          COLD_START_BASE_URL_B: baseUrlB,
        },
        stdio: "inherit",
      },
    );

    exitCode = await new Promise((resolve) => {
      testProcess.on("exit", (code) => resolve(code ?? 1));
      testProcess.on("error", () => resolve(1));
    });
  } catch (err) {
    fail(err.message);
    exitCode = 1;
  } finally {
    await cleanup();
  }

  process.exitCode = exitCode;
}

main();
