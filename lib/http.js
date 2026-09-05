import { NextResponse } from "next/server";

import connectDB from "../config/db.js";
import { isUnsafeMethod, validateOrigin, verifyCsrfForSession } from "./csrf.js";
import { readSessionTokenFromRequest } from "./cookies.js";
import { validateSessionToken } from "./session.js";

// Thrown explicitly by route handlers/services for expected failures
// (bad input, not found, forbidden). Anything else (Mongoose errors,
// unexpected exceptions) is translated by withRoute() below.
//
// `details` (Phase 5) is an optional array of safe, field-level validation
// errors — `[{path, message}]` only, never a raw submitted value, never a
// Zod issue object — set by lib/validation.js's parseJsonBody/parseQuery/
// parsePathParams. Omitted entirely for every other HttpError, so no
// existing `{success:false,message}` response shape changes.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Mirrors app/middleware/errorMiddleware.js's translation table, adapted
// for Route Handlers.
function toResponse(err) {
  if (err instanceof HttpError) {
    const body = { success: false, message: err.message };
    if (err.details) body.errors = err.details;
    return NextResponse.json(body, { status: err.status });
  }
  if (err.name === "CastError") {
    // Phase 5 ObjectId contract: malformed path-param IDs are validated
    // (and rejected with 400) explicitly by services/routes before they
    // ever reach a Mongoose query — see lib/validation.js's
    // requireObjectIdFormat(). This branch is the pre-Phase-5 safety net
    // for anything not yet migrated to that explicit check (kept as
    // 404, matching existing behavior/tests) plus a generic 400 for any
    // OTHER cast failure (e.g. a non-numeric value cast against a Number
    // schema field) — previously fell through to the unsanitized 500
    // below.
    if (err.kind === "ObjectId") {
      return NextResponse.json({ success: false, message: "Resource not found" }, { status: 404 });
    }
    return NextResponse.json({ success: false, message: "Invalid request data" }, { status: 400 });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "field";
    return NextResponse.json(
      { success: false, message: `Duplicate ${field}: ${err.keyValue?.[field]} already exists` },
      { status: 400 },
    );
  }
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors).map((e) => e.message).join(", ");
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
  // Phase 3 rate limiting (lib/rateLimit.js) — duck-typed by name to avoid
  // a circular import between this file and lib/rateLimit.js. A generic
  // message and no internal keys/hashes/counters ever reach the client.
  if (err.name === "RateLimitExceededError") {
    return NextResponse.json(
      { success: false, message: "Too many requests, please try again later" },
      { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } },
    );
  }
  if (err.name === "RateLimitStoreError") {
    // Fail CLOSED for the routes that use enforceRateLimit() (all of them
    // are auth-sensitive — login/register/forgot-password/reset-password/
    // coupon validation) — a database outage must not silently become
    // "unlimited attempts allowed." Documented availability tradeoff: a
    // real rate-limit-store outage makes these specific endpoints
    // unavailable (503) rather than insecure. No internal detail leaks.
    console.error(err);
    return NextResponse.json({ success: false, message: "Service temporarily unavailable, please try again shortly" }, { status: 503 });
  }
  // Phase 3B: register/reset-password have no rate-limit dimension other
  // than client IP — in production, with no trustworthy IP resolvable
  // (lib/clientIp.js's requireClientIp()), proceeding would mean running
  // those two routes completely unprotected. Fails closed instead,
  // identically to a rate-limit-store outage — same response shape,
  // nothing proxy-configuration-specific ever reaches the client.
  if (err.name === "ClientIpUnavailableError") {
    return NextResponse.json({ success: false, message: err.message }, { status: 503 });
  }
  // Phase 5: previously echoed `err.message` verbatim to the client for
  // ANY unmapped exception — a raw MongoDB driver error, a third-party SDK
  // error, or any other unexpected exception could carry a connection
  // string, a filesystem path, or other internal detail straight into the
  // HTTP response. Full diagnostic detail is still logged server-side
  // (this console.error is unchanged); the client only ever sees a fixed,
  // generic message for anything not explicitly mapped above.
  console.error(err);
  return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
}

// Reconstructs bracket-notation range params (`basePrice[lte]=25` — see
// lib/utils.js's buildQueryString, the client's one way to send a range
// filter) into the nested `{ basePrice: { lte: "25" } }` shape
// productService.js's buildFilter() expects for its gte/gt/lte/lt
// handling. Plain `Object.fromEntries(searchParams.entries())` does NOT do
// this on its own: URLSearchParams treats "basePrice[lte]" as one opaque
// flat key, never as nested syntax, so it was arriving at buildFilter as
// a literal attribute key nothing could ever match — every basePrice range
// filter (the Shop page's price slider included) silently returned zero
// results instead of a real basePrice range. Any other query param passes
// through unchanged.
export function parseQueryParams(searchParams) {
  const query = {};
  for (const [rawKey, value] of searchParams.entries()) {
    const match = rawKey.match(/^([^[\]]+)\[([^[\]]+)\]$/);
    if (match) {
      const [, key, op] = match;
      query[key] = { ...(query[key] || {}), [op]: value };
    } else {
      query[rawKey] = value;
    }
  }
  return query;
}

// Wraps a Route Handler so it can `throw` (HttpError or otherwise) instead
// of manually try/catching in every route. Also ensures a Mongoose
// connection exists before the handler runs — every DB-backed route in this
// app goes through here, so this is the one place that needs to know about
// connectDB(), not every service function individually.
//
// Phase 2: this is also the ONE place CSRF/Origin protection is enforced,
// so none of the ~60 Route Handlers need to remember to call it
// individually. Applied uniformly to every unsafe (POST/PUT/PATCH/DELETE)
// request, including the public auth endpoints (login/register/
// forgot-password/reset-password) — Layer 1 (Origin) protects those too,
// exactly as the spec requires. Layer 2 (the session-bound CSRF token)
// only engages when a session cookie is actually present; an
// unauthenticated unsafe request has no CSRF token to check and is left to
// Layer 1 plus whatever the handler's own requireUser()/etc. call decides.
export function withRoute(handler) {
  return async (request, ctx) => {
    try {
      await connectDB();

      if (isUnsafeMethod(request.method)) {
        if (!validateOrigin(request)) {
          throw new HttpError(403, "Cross-origin request rejected");
        }
        const rawToken = readSessionTokenFromRequest(request);
        if (rawToken) {
          const session = await validateSessionToken(rawToken);
          if (session && !verifyCsrfForSession(request, session)) {
            throw new HttpError(403, "Invalid or missing CSRF token");
          }
        }
      }

      return await handler(request, ctx);
    } catch (err) {
      return toResponse(err);
    }
  };
}
