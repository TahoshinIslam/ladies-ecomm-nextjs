// Machine-to-machine auth for scheduled/cron-triggered routes (see
// app/api/admin/cron/cleanup/route.js). Deliberately NOT the same
// Origin/Sec-Fetch-Site + session-CSRF gate lib/http.js's withRoute()
// enforces for browser-originated requests — a scheduler (Vercel Cron, or
// any external cron caller) sends neither an Origin header nor a session
// cookie, so that gate would reject every legitimate invocation before
// ever reaching the handler. A shared bearer secret is the correct
// mechanism for server-to-server trust here, not browser-CSRF defenses.
//
// Fails CLOSED, matching this codebase's existing policy for other
// no-fallback-identity situations (see lib/clientIp.js's
// requireClientIp()): if CRON_SECRET isn't configured at all, every
// request is rejected — never silently "no auth required" just because
// nothing was set up yet.

import crypto from "crypto";

import { HttpError } from "./http.js";

export function requireCronSecret(request) {
  const configured = process.env.CRON_SECRET;
  if (!configured) {
    throw new HttpError(503, "Scheduled endpoint is not configured (CRON_SECRET unset)");
  }

  const header = request.headers.get("authorization") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented) {
    throw new HttpError(401, "Missing Authorization: Bearer token");
  }

  // Timing-safe, and only after confirming equal length (timingSafeEqual
  // throws on a length mismatch rather than returning false) — matches
  // the same pattern lib/csrf.js's CSRF-token comparison already uses.
  const a = Buffer.from(presented);
  const b = Buffer.from(configured);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, "Invalid scheduled-endpoint credential");
  }
}
