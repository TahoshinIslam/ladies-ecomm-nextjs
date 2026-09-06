#!/usr/bin/env node
// Realtime-durability-class fix — regression harness for the cold-start
// homepage 500 (MongooseError: `categories.find()` buffering timed out).
//
// Deliberately separate from scripts/httpTestServer.mjs: that harness's
// own readiness poll hits `/api/settings/public` (a DB-backed route)
// before handing control to the test files — which would itself
// establish the connection this bug depends on NEVER having happened yet.
// This harness polls ONLY `/api/health/live` (which by design never
// touches MongoDB — see app/api/health/live/route.js), so the very first
// real request this spawned server instance ever serves can be the
// test's own GET / — a faithful reproduction of a genuinely cold Vercel
// instance whose first request is a Server Component page, not an API
// route that would have warmed the connection via lib/http.js's
// withRoute().
//
// Usage: node scripts/coldStartHttpTestServer.mjs run [testFileGlob...]

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, openSync, writeFileSync, readFileSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOG_DIR = path.join(ROOT, ".phase11-coldstart-logs");

function log(message) {
  console.log(`[coldStartHttpTestServer] ${message}`);
}
function fail(message) {
  console.error(`\n✖ ${message}\n`);
}

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
  return dbName;
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

  let dbName;
  try {
    dbName = assertIsolatedTestUri(process.env.MONGO_URI_TEST);
  } catch (err) {
    fail(err.message);
    process.exitCode = 1;
    return;
  }

  const instances = [];
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const inst of instances) {
      if (inst?.exitCode === null) {
        log(`stopping instance (pid ${inst.pid})`);
        inst.kill("SIGTERM");
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
    log(`isolated test database confirmed: "${dbName}"`);
    log("wiping and reseeding the disposable test database...");
    await mongoose.connect(process.env.MONGO_URI_TEST);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();

    const seedLog = path.join(LOG_DIR, "seed.log");
    writeFileSync(seedLog, "");
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

    const [portA, portB] = await Promise.all([findFreePort(), findFreePort()]);

    async function spawnFreshInstance(label, port, logFile) {
      const baseUrl = `http://127.0.0.1:${port}`;
      const child = spawn("node_modules/.bin/next", ["start", "-p", String(port)], {
        cwd: ROOT,
        env: {
          ...process.env,
          PORT: String(port),
          ALLOW_TEST_DB_OVERRIDE: "true",
          TEST_SERVER_MONGO_URI: process.env.MONGO_URI_TEST,
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
    cleanup();
  }

  process.exitCode = exitCode;
}

main();
