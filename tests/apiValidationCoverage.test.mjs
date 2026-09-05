// Phase 5B — a maintainable coverage manifest: a lightweight static scan
// over every app/api/**/route.js file that fails if a NEW raw,
// unvalidated `request.json()` call appears anywhere outside the three
// routes that have a documented, deliberate reason to read the body raw
// before validating it (login/register/forgot-password all key a rate-
// limit check off the SUBMITTED value before schema validation can reject
// it — see each route's own comment). This does not replace real route/
// service tests (see the many other tests/*.test.mjs files covering the
// actual validation behavior) — it exists so that adding a new route
// handler that reads `request.json()` directly, without wiring
// lib/validation.js's parseJsonBody(), fails a test immediately instead of
// silently shipping unvalidated.
//
// This is a text scan, not a full static analyzer — it catches the most
// common and highest-value bypass shape (a raw `await request.json()` call
// sitting in a route file) without needing to parse the AST.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const APP_API_DIR = new URL("../app/api", import.meta.url).pathname;

// Routes with a documented, deliberate reason to call `request.json()`
// directly rather than through parseJsonBody()/validateData() — each
// reads the raw body so a rate-limit check can run against the submitted
// value BEFORE schema validation might reject it (see each route file's
// own comment for the full reasoning). All three still validate the
// parsed result via `validateData()` before it reaches any service.
const DOCUMENTED_RAW_JSON_EXCEPTIONS = new Set([
  "users/register/route.js",
  "users/login/route.js",
  "users/forgot-password/route.js",
]);

function findRouteFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRouteFiles(full));
    } else if (entry.name === "route.js") {
      results.push(full);
    }
  }
  return results;
}

describe("Phase 5B — API validation coverage manifest (static scan)", () => {
  const routeFiles = findRouteFiles(APP_API_DIR);

  test(`found the expected number of route files (${routeFiles.length})`, () => {
    // Not a fixed magic number — this just records what the scan actually
    // found, so a future run's count is visible in the test output.
    assert.ok(routeFiles.length > 0);
  });

  test("no NEW raw `request.json()` call sites appear outside the documented rate-limit exceptions", () => {
    const offenders = [];
    for (const file of routeFiles) {
      const relative = path.relative(APP_API_DIR, file);
      if (DOCUMENTED_RAW_JSON_EXCEPTIONS.has(relative)) continue;
      const content = fs.readFileSync(file, "utf8");
      if (/await\s+request\.json\(\)/.test(content)) {
        offenders.push(relative);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these route files call request.json() directly instead of lib/validation.js's parseJsonBody(): ${offenders.join(", ")}`,
    );
  });

  test("every route file that imports the schema-consuming helpers (parseJsonBody/parseQuery/parsePathParams) also imports a schemas/*.js module", () => {
    // requireObjectIdFormat/requireSafeFolder are deliberately standalone,
    // schema-free validators (a bare format check, not a Zod schema) —
    // only the three helpers that actually TAKE a schema argument are
    // expected to pair with a schemas/*.js import.
    const SCHEMA_CONSUMING_HELPERS = /\b(parseJsonBody|parseQuery|parsePathParams)\b/;
    const offenders = [];
    for (const file of routeFiles) {
      const content = fs.readFileSync(file, "utf8");
      const importsHelperLine = content.split("\n").find((line) => /from ["'].*lib\/validation\.js["']/.test(line));
      if (!importsHelperLine || !SCHEMA_CONSUMING_HELPERS.test(importsHelperLine)) continue;
      const importsSchema = /from ["'].*schemas\/[a-zA-Z]+\.js["']/.test(content);
      if (!importsSchema) offenders.push(path.relative(APP_API_DIR, file));
    }
    assert.deepEqual(offenders, [], `these route files import a schema-consuming validation helper with no schemas/*.js import: ${offenders.join(", ")}`);
  });
});
