import { NextResponse } from "next/server";

// Phase 11, section G — LIVENESS: proves only that this function instance
// itself can execute and respond; deliberately does NOT touch MongoDB or
// any other dependency. A liveness probe answering "is the process able
// to run at all" must stay up even while a downstream dependency (Mongo)
// is degraded — that distinction is what READINESS (route.js in
// app/api/health/ready/) is for. Mixing the two would make an unrelated
// database outage look like "this instance is dead," which is exactly
// the false signal a liveness check must not produce.
//
// Deliberately bypasses lib/http.js's withRoute() — that wrapper calls
// connectDB() unconditionally before every handler runs, which would
// silently turn this into a dependency-coupled check. This route is
// intentionally the one place in the app that does NOT go through it.
export async function GET() {
  return NextResponse.json(
    { status: "ok" },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
