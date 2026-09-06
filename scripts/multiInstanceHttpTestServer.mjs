#!/usr/bin/env node
// Phase 11, section I (mandatory) — spins up TWO independent, real
// `next start` server processes, both pointed at the SAME disposable test
// database, and runs tests/http/multiInstanceEvents.integration.test.mjs
// against them. This is the one piece of real, executable evidence that
// the MongoDB-backed durable event outbox (lib/events.js,
// models/eventModel.js) actually solves the cross-instance problem the
// old process-local EventEmitter (lib/events.js, pre-Phase-11) could
// never solve: a client's SSE connection can land on either process, and
// an event committed by ONE process must still reach a client connected
// to the OTHER.
//
// Deliberately a separate script from scripts/httpTestServer.mjs (never
// modified) — this reuses that script's exact safety patterns
// (isolated-test-URI assertion, findFreePort, spawn/readiness-poll/
// cleanup) but needs to run TWO server processes at once instead of one,
// which is a large enough shape difference to warrant its own file rather
// than bolting a "how many instances" parameter onto the existing one.
//
// Usage: node scripts/multiInstanceHttpTestServer.mjs run

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOG_DIR = path.join(ROOT, ".phase11-multi-instance-logs");

function log(message) {
  console.log(`[multiInstanceHttpTestServer] ${message}`);
}
function fail(message) {
  console.error(`\n✖ ${message}\n`);
}

// Same isolation rule as scripts/httpTestServer.mjs's assertIsolatedTestUri.
function assertIsolatedTestUri(uri) {
  const prodUri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI_TEST is not set");
  if (prodUri && uri === prodUri) throw new Error("MONGO_URI_TEST equals MONGO_URI — refusing to use it");
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
    throw new Error(`MONGO_URI_TEST's database name ("${dbName}") does not contain "test" — refusing to use it`);
  }
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

async function spawnInstance(label, port, logFile) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const logFd = openSync(logFile, "a");
  const child = spawn("node_modules/.bin/next", ["start", "-p", String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      ALLOW_TEST_DB_OVERRIDE: "true",
      TEST_SERVER_MONGO_URI: process.env.MONGO_URI_TEST,
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

  try {
    assertIsolatedTestUri(process.env.MONGO_URI_TEST);
  } catch (err) {
    fail(err.message);
    process.exitCode = 1;
    return;
  }

  let instanceA;
  let instanceB;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const inst of [instanceA, instanceB]) {
      if (inst?.child && inst.child.exitCode === null) {
        log(`stopping instance (pid ${inst.child.pid})`);
        inst.child.kill("SIGTERM");
      }
    }
  };
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  let exitCode = 1;
  try {
    // Clean event/order/user collections from any prior run — this
    // harness does not run the full catalog seed (unnecessary for this
    // test), just ensures the collections this test writes to start
    // empty.
    await mongoose.connect(process.env.MONGO_URI_TEST);
    for (const coll of ["events", "orders", "users", "products", "categories"]) {
      await mongoose.connection.db.collection(coll).deleteMany({}).catch(() => {});
    }
    await mongoose.disconnect();

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
    cleanup();
  }

  process.exitCode = exitCode;
}

main();
