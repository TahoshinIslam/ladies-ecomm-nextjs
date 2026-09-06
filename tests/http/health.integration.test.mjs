// Phase 11, section G — real HTTP evidence for the liveness/readiness
// endpoints. Liveness must stay 200 even independent of DB state (proven
// here simply by it responding fast with no DB dependency in its source —
// see tests/productionArchitecture.test.mjs for the source-level proof it
// never imports connectDB); readiness must reflect the real DB's state.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.HTTP_TEST_BASE_URL || "http://localhost:3000";

let serverUp = false;
try {
  const res = await fetch(`${BASE_URL}/`);
  serverUp = res.ok;
} catch {
  serverUp = false;
}

const skip = !serverUp ? "test server not reachable — run via `npm run test:http`" : false;

describe("Phase 11 — health endpoints over real HTTP", { skip }, () => {
  test("GET /api/health/live returns 200 with a minimal, safe body and no-store", async () => {
    const res = await fetch(`${BASE_URL}/api/health/live`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.deepEqual(body, { status: "ok" });
  });

  test("GET /api/health/ready returns 200 with a minimal, safe body when the DB is reachable", async () => {
    const res = await fetch(`${BASE_URL}/api/health/ready`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.deepEqual(body, { status: "ok" });
  });

  test("health responses never leak internal detail (host, driver name, stack)", async () => {
    for (const path of ["/api/health/live", "/api/health/ready"]) {
      const res = await fetch(`${BASE_URL}${path}`);
      const raw = await res.text();
      assert.ok(!/mongo|mongoose|stack|127\.0\.0\.1|ECONNREFUSED/i.test(raw), `${path} must not leak internal detail`);
    }
  });
});
