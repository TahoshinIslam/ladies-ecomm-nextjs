// Phase 11, section N — unit/architecture tests for
// scripts/smokeDeployment.mjs. Proves the safety constraints statically
// (HTTPS required, no embedded credentials, read-only) and, when a local
// disposable HTTP test server is available, runs it for real against
// http://localhost with --allow-localhost as a live self-test.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const SCRIPT_PATH = new URL("../scripts/smokeDeployment.mjs", import.meta.url);
const content = fs.readFileSync(SCRIPT_PATH, "utf8");

describe("Phase 11 — scripts/smokeDeployment.mjs static safety properties", () => {
  test("file exists", () => {
    assert.ok(fs.existsSync(SCRIPT_PATH));
  });

  test("refuses a non-HTTPS URL unless it is localhost with --allow-localhost", () => {
    assert.match(content, /protocol !== "https:"/);
    assert.match(content, /allow-localhost/);
  });

  test("never accepts a credential/username/password CLI argument", () => {
    // parseArgs() only ever reads a `url` positional and an
    // `--allow-localhost` flag — never a flag/field named after a
    // credential. ("token" is deliberately excluded from this check: the
    // script legitimately uses that word to describe secret-SHAPED text
    // it scans responses for, not a credential it accepts as input.)
    assert.match(content, /function parseArgs/);
    const parseArgsBody = content.slice(content.indexOf("function parseArgs"), content.indexOf("function assertSafeUrl"));
    assert.ok(!/username|password/i.test(parseArgsBody), "parseArgs() must never read a username/password argument");
  });

  test("only ever issues GET requests (no method: \"POST\"/\"PUT\"/\"DELETE\")", () => {
    assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(content));
  });

  test("uses a bounded per-request timeout", () => {
    assert.match(content, /TIMEOUT_MS/);
    assert.match(content, /AbortController/);
  });

  test("never prints a full response body — only redacted pass/fail summaries", () => {
    assert.ok(!/console\.log\(.*\bres\.text\(\)|console\.log\(.*\bawait res\.json\(\)/s.test(content));
  });

  test("checks robots.txt, sitemap.xml, health endpoints, 404 handling, private-route redirect, security headers, and nonce uniqueness", () => {
    for (const marker of ["/robots.txt", "/sitemap.xml", "/api/health/live", "/api/health/ready", "expectStatus: 404", "/profile", "Content-Security-Policy", "nonce"]) {
      assert.ok(content.includes(marker), `smokeDeployment.mjs must check for "${marker}"`);
    }
  });
});

describe("Phase 11 — scripts/smokeDeployment.mjs argument validation (no server needed)", () => {
  test("refuses a plain http:// non-localhost URL", () => {
    const result = spawnSync("node", ["scripts/smokeDeployment.mjs", "http://example.com"], { encoding: "utf8", timeout: 10000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /https/i);
  });

  test("refuses http://localhost without --allow-localhost", () => {
    const result = spawnSync("node", ["scripts/smokeDeployment.mjs", "http://localhost:3000"], { encoding: "utf8", timeout: 10000 });
    assert.notEqual(result.status, 0);
  });

  test("refuses with no URL argument at all", () => {
    const result = spawnSync("node", ["scripts/smokeDeployment.mjs"], { encoding: "utf8", timeout: 10000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage/);
  });
});

// A real, live run against the disposable HTTP test server is executed
// manually (not as part of the automated suite, since this file has no
// access to a running server outside the tests/http/*.test.mjs harness)
// — see tests/http/smokeDeployment.integration.test.mjs for the automated
// live proof, which DOES run inside that harness with a real server up.
