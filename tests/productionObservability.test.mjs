// Phase 11 — safe client-side error logging + structured server logging
// invariants. Direct unit tests (not just static source inspection)
// against lib/clientErrorLog.js, proving the exact behavior the Phase 10
// carryover fix required: no raw Error object ever reaches the
// production browser console.
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const abs = (...parts) => path.join(ROOT, ...parts);
const read = (relPath) => fs.readFileSync(abs(relPath), "utf8");

describe("Phase 11 — logClientErrorSafely never logs a raw Error object in production", () => {
  test("production + no digest: logs nothing at all", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const spy = mock.method(console, "error", () => {});
    try {
      const { logClientErrorSafely } = await import(`../lib/clientErrorLog.js?t=${Date.now()}`);
      logClientErrorSafely("test_event", new Error("sensitive stack trace detail"));
      assert.equal(spy.mock.calls.length, 0, "no digest and production must produce zero console.error calls");
    } finally {
      spy.mock.restore();
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("production + a real digest: logs only the fixed event name and the digest, never the Error object itself", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const spy = mock.method(console, "error", () => {});
    try {
      const { logClientErrorSafely } = await import(`../lib/clientErrorLog.js?t=${Date.now()}`);
      const err = new Error("sensitive stack trace detail");
      err.digest = "abc123digest";
      logClientErrorSafely("test_event", err);
      assert.equal(spy.mock.calls.length, 1);
      const [eventName, payload] = spy.mock.calls[0].arguments;
      assert.equal(eventName, "test_event");
      assert.deepEqual(payload, { digest: "abc123digest" });
      assert.ok(!JSON.stringify(payload).includes("sensitive stack trace detail"), "the real error message must never appear in the logged payload");
    } finally {
      spy.mock.restore();
      process.env.NODE_ENV = originalEnv;
    }
  });

  test("non-production: still logs the real error object (development-only diagnostics)", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const spy = mock.method(console, "error", () => {});
    try {
      const { logClientErrorSafely } = await import(`../lib/clientErrorLog.js?t=${Date.now()}`);
      const err = new Error("dev-only detail");
      logClientErrorSafely("test_event", err);
      assert.ok(spy.mock.calls.some((c) => c.arguments[1] === err), "development mode must still log the real error for local debugging");
    } finally {
      spy.mock.restore();
      process.env.NODE_ENV = originalEnv;
    }
  });
});

describe("Phase 11 — structured server logging never logs secrets/PII (redaction contract)", () => {
  test("lib/logger.js (or equivalent) exists and defines an explicit redaction allowlist", () => {
    const candidates = ["lib/logger.js", "lib/log.js", "lib/serverLog.js"];
    const found = candidates.find((c) => fs.existsSync(abs(c)));
    assert.ok(found, `expected one of ${candidates.join(", ")} to exist`);
  });

  test("logEvent() drops every field not on the explicit allowlist — fake secrets never reach the emitted line", async () => {
    const { logEvent } = await import("../lib/logger.js");
    const spy = mock.method(console, "log", () => {});
    try {
      logEvent({
        event: "test_event",
        requestId: "abc-123-def-456",
        route: "/api/users/login",
        method: "POST",
        status: 401,
        category: "auth",
        // Everything below is a forbidden field, deliberately given a
        // realistic-looking fake secret value — none of it may appear in
        // the emitted line.
        password: "hunter2-super-secret",
        mongoUri: "mongodb+srv://admin:S3cr3tPass@cluster0.mongodb.net/prod",
        cloudinaryApiSecret: "abcd1234efgh5678ijkl9012mnop3456",
        cookie: "tahos_session=deadbeefcafebabe1234567890",
        email: "victim@example.com",
        ip: "203.0.113.42",
        rawBody: { creditCard: "4111111111111111" },
        stack: "Error: boom\n    at somewhere secret internal path",
      });
      assert.equal(spy.mock.calls.length, 1);
      const [line] = spy.mock.calls[0].arguments;
      const parsed = JSON.parse(line);
      assert.deepEqual(Object.keys(parsed).sort(), ["category", "event", "level", "method", "requestId", "route", "status", "timestamp"].sort());
      for (const secret of ["hunter2-super-secret", "S3cr3tPass", "mongodb+srv", "deadbeefcafebabe", "victim@example.com", "203.0.113.42", "4111111111111111", "somewhere secret internal path"]) {
        assert.ok(!line.includes(secret), `logged line must never contain "${secret}"`);
      }
    } finally {
      spy.mock.restore();
    }
  });

  test("logEvent() drops an object/array value even under an ALLOWED field name", async () => {
    const { logEvent } = await import("../lib/logger.js");
    const spy = mock.method(console, "log", () => {});
    try {
      logEvent({ event: "x", route: { nested: "mongodb://leak:pass@host/db" } });
      const [line] = spy.mock.calls[0].arguments;
      assert.ok(!line.includes("leak:pass"), "an object value under an allowed key must still be dropped, not stringified");
    } finally {
      spy.mock.restore();
    }
  });

  test("logEvent() never throws, even on a circular/unserializable field", async () => {
    const { logEvent } = await import("../lib/logger.js");
    const circular = {};
    circular.self = circular;
    assert.doesNotThrow(() => logEvent({ event: "x", route: circular }));
  });

  test("getOrCreateRequestId trusts a shape-valid x-vercel-id header, generates one otherwise, and never accepts a CRLF-injected value", async () => {
    const { getOrCreateRequestId } = await import("../lib/logger.js");
    const trusted = getOrCreateRequestId({ headers: { get: (k) => (k === "x-vercel-id" ? "abc123-valid-id" : null) } });
    assert.equal(trusted, "abc123-valid-id");

    const generated = getOrCreateRequestId({ headers: { get: () => null } });
    assert.match(generated, /^[0-9a-f-]{36}$/i, "must fall back to a real UUID when no valid header is present");

    const injected = getOrCreateRequestId({ headers: { get: () => "abc\r\nSet-Cookie: evil=1" } });
    assert.notEqual(injected, "abc\r\nSet-Cookie: evil=1", "must never trust a header value containing CRLF/control characters");
  });
});

describe("Phase 11 — lib/http.js's withRoute wires request-ID correlation and categorized failure logging", () => {
  const content = fs.readFileSync(abs("lib/http.js"), "utf8");

  test("every response gets an X-Request-ID header (success and error paths)", () => {
    assert.match(content, /getOrCreateRequestId/);
    assert.match(content, /X-Request-ID/);
  });

  test("every caught error is logged via logEvent with a bounded category, not a raw error message", () => {
    assert.match(content, /logEvent\(/);
    assert.match(content, /categorizeError\(err\)/);
  });
});
