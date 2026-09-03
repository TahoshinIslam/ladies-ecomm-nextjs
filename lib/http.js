import { NextResponse } from "next/server";

import connectDB from "../config/db.js";

// Thrown explicitly by route handlers/services for expected failures
// (bad input, not found, forbidden). Anything else (Mongoose errors, JWT
// errors, unexpected exceptions) is translated by withRoute() below.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Mirrors app/middleware/errorMiddleware.js's translation table, adapted
// for Route Handlers (no CSRF branch — bearer-token auth has no ambient
// credential to forge, so CSRF doesn't apply here).
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
  if (err.name === "JsonWebTokenError") {
    return NextResponse.json({ success: false, message: "Invalid token" }, { status: 401 });
  }
  if (err.name === "TokenExpiredError") {
    return NextResponse.json(
      { success: false, message: "Session expired, please log in again" },
      { status: 401 },
    );
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
export function withRoute(handler) {
  return async (request, ctx) => {
    try {
      await connectDB();
      return await handler(request, ctx);
    } catch (err) {
      return toResponse(err);
    }
  };
}
