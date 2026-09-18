import { NextResponse } from "next/server";

import connectDB from "../../../../config/db.js";

// Phase 11, section G — READINESS: proves this instance can actually serve
// a real request right now (a warm, pingable MySQL connection), distinct
// from LIVENESS (app/api/health/live/route.js), which proves only that the
// process itself is running. A load balancer/orchestrator should stop
// routing traffic here on a 503 but must NOT restart the process for it —
// that's exactly why these are two separate endpoints with two separate
// meanings.
//
// Bounded: a `SELECT 1` against a genuinely unreachable MySQL host can hang
// for the driver's own (much longer) connect timeout otherwise — this uses
// its own strict, short timeout so a degraded database turns into a fast,
// clear 503 rather than a slow, ambiguous one.
const READY_TIMEOUT_MS = 2000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

// Deliberately bypasses lib/http.js's withRoute(): that wrapper's own
// connectDB() call, CSRF/Origin checks, and generic error translation are
// all built for authenticated/mutating application routes, not a public,
// unauthenticated, GET-only health probe with its own distinct
// bounded-timeout and no-detail-leak contract.
export async function GET() {
  try {
    // connectDB() itself runs a real `SELECT 1` against the pool (see
    // config/db.js) — that one query IS the readiness ping, so no second
    // round trip is needed here.
    await withTimeout(connectDB(), READY_TIMEOUT_MS);
    return NextResponse.json(
      { status: "ok" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // No internal detail (host, error message, driver error) ever reaches
    // the client — only a generic, safe status.
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
