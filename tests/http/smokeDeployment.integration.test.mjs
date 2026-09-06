// Phase 11, section N — runs the real scripts/smokeDeployment.mjs as a
// child process against the actual disposable `next start` server this
// HTTP-test harness (scripts/httpTestServer.mjs) already has running,
// with --allow-localhost. This is the live proof that the script's checks
// (health endpoints, robots/sitemap, 404, private-route redirect, security
// headers, nonce uniqueness, no-secret-leakage) actually pass against a
// real running deployment, not just that the script parses correctly.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const BASE_URL = process.env.HTTP_TEST_BASE_URL || "http://localhost:3000";

let serverUp = false;
try {
  const res = await fetch(`${BASE_URL}/`);
  serverUp = res.ok;
} catch {
  serverUp = false;
}

const skip = !serverUp ? "test server not reachable — run via `npm run test:http`" : false;

describe("Phase 11 — smokeDeployment.mjs live run against the real disposable test server", { skip }, () => {
  test("every check passes (exit code 0)", () => {
    const result = spawnSync("node", ["scripts/smokeDeployment.mjs", BASE_URL, "--allow-localhost"], {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.status, 0, `smokeDeployment.mjs exited non-zero:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    assert.match(result.stdout, /checks passed/);
  });
});
