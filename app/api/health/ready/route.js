import { NextResponse } from "next/server";
import mongoose from "mongoose";

import connectDB from "../../../../config/db.js";

// Phase 11, section G — READINESS: proves this instance can actually
// serve a real request right now (a warm, pingable Mongo connection),
// distinct from LIVENESS (app/api/health/live/route.js), which proves
// only that the process itself is running. A load balancer/orchestrator
// should stop routing traffic here on a 503 but must NOT restart the
// process for it — that's exactly why these are two separate endpoints
// with two separate meanings.
//
// Bounded: a `ping` against a genuinely unreachable Mongo host can hang
// for the driver's own (much longer) server-selection timeout otherwise —
// this uses its own strict, short timeout so a degraded database turns
// into a fast, clear 503 rather than a slow, ambiguous one.
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
    // Reuses the app's single cached connection (config/db.js's
    // globalThis-cached promise) — never opens a second connection just
    // to check the first one's health.
    await withTimeout(connectDB(), READY_TIMEOUT_MS);
    await withTimeout(mongoose.connection.db.admin().ping(), READY_TIMEOUT_MS);
    return NextResponse.json(
      { status: "ok" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // No internal detail (host, error message, driver error) ever
    // reaches the client — only a generic, safe status.
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
