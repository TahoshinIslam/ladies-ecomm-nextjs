#!/usr/bin/env node
// Performance audit Closure Pass 2 — dev server pointed at the disposable
// LOCAL TEST DATABASE ONLY, for manual/browser-based verification
// (DataTable render profiling, admin walkthroughs) without ever touching
// MONGO_URI. Reuses the exact same double-gated override config/db.js
// already has for scripts/httpTestServer.mjs — this script just runs
// `next dev` instead of `next start` under it, for hot-reload convenience
// while iterating on temporary measurement instrumentation.
//
// Usage: node --env-file=.env.test scripts/devTestDb.mjs
import { spawn } from "node:child_process";

if (!process.env.MONGO_URI_TEST) {
  throw new Error("MONGO_URI_TEST is not set — run with --env-file=.env.test");
}
if (!/test/i.test(process.env.MONGO_URI_TEST)) {
  throw new Error("MONGO_URI_TEST does not look like a test database — refusing to start");
}

const env = {
  ...process.env,
  ALLOW_TEST_DB_OVERRIDE: "true",
  TEST_SERVER_MONGO_URI: process.env.MONGO_URI_TEST,
};

const extraArgs = process.argv.slice(2);
const child = spawn("npx", ["next", "dev", ...extraArgs], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
