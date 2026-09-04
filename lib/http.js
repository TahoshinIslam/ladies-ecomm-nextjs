import { NextResponse } from "next/server";

import connectDB from "../config/db.js";
import { isUnsafeMethod, validateOrigin, verifyCsrfForSession } from "./csrf.js";
import { readSessionTokenFromRequest } from "./cookies.js";
import { validateSessionToken } from "./session.js";

// Thrown explicitly by route handlers/services for expected failures
// (bad input, not found, forbidden). Anything else (Mongoose errors,
// unexpected exceptions) is translated by withRoute() below.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Mirrors app/middleware/errorMiddleware.js's translation table, adapted
// for Route Handlers.
function toResponse(err) {
  if (err instanceof HttpError) {
    return NextResponse.json({ success: false, message: err.message }, { status: err.status });
  }
  if (err.name === "CastError" && err.kind === "ObjectId") {
    return NextResponse.json({ success: false, message: "Resource not found" }, { status: 404 });
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
  console.error(err);
  return NextResponse.json({ success: false, message: err.message || "Server error" }, { status: 500 });
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
