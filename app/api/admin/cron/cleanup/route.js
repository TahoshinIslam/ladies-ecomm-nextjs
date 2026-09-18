import { NextResponse } from "next/server";

import connectDB, { query } from "../../../../../config/db.js";
import { requireCronSecret } from "../../../../../lib/cronAuth.js";
import { runExpiryCleanup } from "../../../../../lib/expiryCleanup.js";
import { HttpError } from "../../../../../lib/http.js";
import { logEvent } from "../../../../../lib/logger.js";

// Confirmed audit gap, closed: scripts/cleanupExpired.mjs's batched,
// idempotent expiry sweep (sessions/rate_limit_counters/events) existed
// but nothing ever invoked it automatically — deployed, this table set
// grows without bound. This is the HTTP entry point a real scheduler
// (Vercel Cron, or any external cron caller) hits.
//
// Deliberately bypasses lib/http.js's withRoute(): that wrapper enforces
// Origin/Sec-Fetch-Site + session-CSRF for every unsafe method, which is
// the correct defense against a BROWSER forging a request on a logged-in
// admin's behalf — but a scheduler is not a browser, sends neither an
// Origin header nor a session cookie, and would be rejected by that gate
// before ever reaching this handler. Authentication here is a shared
// CRON_SECRET bearer token instead (see lib/cronAuth.js) — the correct
// mechanism for server-to-server trust, and one withRoute() has no concept
// of. GET, not POST: Vercel Cron Jobs invoke their configured path via GET.
//
// Repeat-safe by construction: every delete underneath is a plain,
// idempotent `WHERE expires_at < <cutoff>` batch (lib/expiryCleanup.js) —
// calling this twice in a row, or from two overlapping scheduler runs,
// only ever deletes each already-expired row once.
//
// EXTERNAL STEP STILL REQUIRED (this audit cannot do this unilaterally —
// see docs/DEPLOYMENT_RUNBOOK.md): set a real CRON_SECRET value in the
// hosting platform's environment variables, and add a `crons` entry
// (vercel.ts, or the scheduler's own equivalent) pointing at this route
// with an `Authorization: Bearer $CRON_SECRET` header, on whatever
// interval is chosen (e.g. hourly).
export async function GET(request) {
  try {
    requireCronSecret(request);
    await connectDB();
    const { deleted, total } = await runExpiryCleanup(query);

    // Structured, secret-free — matches every other route's logging
    // discipline (see lib/logger.js's strict field allowlist): a single
    // safe numeric count, never a token/key hash or any other column
    // value. The per-table breakdown is in the response body, not logged.
    logEvent({ event: "scheduled_cleanup", count: total, level: "info" });

    return NextResponse.json({ success: true, deleted, total }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ success: false, message: err.message }, { status: err.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error(err);
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
