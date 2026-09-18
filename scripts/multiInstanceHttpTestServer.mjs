#!/usr/bin/env node
// Phase 11, section I (mandatory) — spins up TWO independent, real
// `next start` server processes, both pointed at the SAME disposable test
// database, and runs tests/http/multiInstanceEvents.integration.test.mjs
// against them. This is the one piece of real, executable evidence that
// the MySQL-backed durable event outbox (lib/events.js, models/eventModel.js,
// the `events` table — see sql/schema.sql) actually solves the
// cross-instance problem a process-local EventEmitter never could: a
// client's SSE connection can land on either process, and an event
// committed by ONE process must still reach a client connected to the
// OTHER.
//
// Deliberately a separate script from scripts/httpTestServer.mjs (never
// modified) — this reuses that script's exact safety patterns
// (lib/testDbSafety.js's checkTestDbConfig, findFreePort,
// spawn/readiness-poll/cleanup) but needs to run TWO server processes at
// once instead of one, which is a large enough shape difference to
// warrant its own file rather than bolting a "how many instances"
// parameter onto the existing one.
//
// Usage: node --env-file-if-exists=.env.test scripts/multiInstanceHttpTestServer.mjs run

process.env.NODE_ENV = "test";

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkTestDbConfig, assertConnectedDbMatches } from "../lib/testDbSafety.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOG_DIR = path.join(ROOT, ".phase11-multi-instance-logs");

function log(message) {
  console.log(`[multiInstanceHttpTestServer] ${message}`);
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

async function spawnInstance(label, port, logFile) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const logFd = openSync(logFile, "a");
  const child = spawn("node_modules/.bin/next", ["start", "-p", String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...testDbEnv(),
      PORT: String(port),
      APP_ORIGIN: baseUrl,
      TRUST_PROXY_HEADERS: "true",
      TRUSTED_PROXY_HOP_COUNT: "1",
    },
    stdio: ["ignore", logFd, logFd],
  });

  const readyTimeoutMs = 45_000;
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < readyTimeoutMs) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${baseUrl}/api/health/live`);
      if (res.ok) {
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
    const tail = readFileSync(logFile, "utf8").split("\n").slice(-40).join("\n");
    throw new Error(`Instance ${label} did not become ready within ${readyTimeoutMs}ms. Last log lines:\n${tail}`);
  }
  log(`instance ${label} ready at ${baseUrl} (pid ${child.pid})`);
  return { child, baseUrl };
}

async function main() {
  const [, , mode] = process.argv;
  if (mode !== "run") {
    console.error("Usage: node scripts/multiInstanceHttpTestServer.mjs run");
    process.exitCode = 1;
    return;
  }

  mkdirSync(LOG_DIR, { recursive: true });
  const logA = path.join(LOG_DIR, "instance-a.log");
  const logB = path.join(LOG_DIR, "instance-b.log");
  writeFileSync(logA, "");
  writeFileSync(logB, "");

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

  let instanceA;
  let instanceB;
  let cleanedUp = false;
  let closePool;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const inst of [instanceA, instanceB]) {
      if (inst?.child && inst.child.exitCode === null) {
        log(`stopping instance (pid ${inst.child.pid})`);
        inst.child.kill("SIGTERM");
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
    // Clean event/order/user/product/category rows from any prior run —
    // this harness doesn't need the full catalog seed (unnecessary for
    // this test), just a clean slate for the tables this test writes to.
    // truncateAll() (tests/helpers/testDb.mjs) truncates every app table,
    // which is safe and simpler than hand-picking a subset — it carries
    // its own independent dbReady/TEST_DB_NAME_PATTERN guard on top of the
    // checkTestDbConfig() check above.
    const dbModule = await import("../config/db.js");
    closePool = dbModule.closePool;
    await dbModule.default();
    await assertConnectedDbMatches(dbModule.query, dbName);
    const { truncateAll } = await import("../tests/helpers/testDb.mjs");
    await truncateAll();

    // See scripts/httpTestServer.mjs's own comment on this exact line —
    // unstable_cache() persists to disk at .next/cache/fetch-cache across
    // `next start` invocations; without clearing it, either spawned
    // instance could serve a page from a stale entry this run's own
    // truncate+reseed never gets a chance to invalidate.
    rmSync(path.join(ROOT, ".next/cache/fetch-cache"), { recursive: true, force: true });

    const [portA, portB] = await Promise.all([findFreePort(), findFreePort()]);
    [instanceA, instanceB] = await Promise.all([
      spawnInstance("A", portA, logA),
      spawnInstance("B", portB, logB),
    ]);

    const testProcess = spawn(
      "node",
      [
        "--experimental-test-module-mocks",
        "--import",
        "./tests/helpers/nextResolveHook.mjs",
        "--test",
        "tests/http/multiInstanceEvents.integration.test.mjs",
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          ...testDbEnv(),
          NODE_ENV: "test",
          HTTP_TEST_BASE_URL_A: instanceA.baseUrl,
          HTTP_TEST_BASE_URL_B: instanceB.baseUrl,
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
