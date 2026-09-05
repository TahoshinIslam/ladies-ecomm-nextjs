// Phase 5 — safe construction of absolute, app-origin links (password
// reset, email verification, ...) from the configured CLIENT_URL.
//
// Replaces the old pattern of `${process.env.CLIENT_URL || ""}/path/${token}`
// — a bare string template that silently produces a broken RELATIVE link
// (just "/path/token", no scheme/host at all) whenever CLIENT_URL is unset,
// and has no opinion at all about scheme, host, or a trailing slash.
//
// This module throws (HttpError(500, ...)) rather than ever falling back
// to something relative/guessable — a misconfigured origin must fail the
// request loudly server-side (and never send out a broken/dangerous link),
// not degrade silently.
import { HttpError } from "./http.js";

const PRODUCTION_PROTOCOLS = new Set(["https:"]);
const NON_PRODUCTION_PROTOCOLS = new Set(["https:", "http:"]);

function isProduction() {
  return process.env.NODE_ENV === "production";
}

// Resolves CLIENT_URL into a validated origin string (scheme + host +
// port — no path/query/fragment; those are deliberately discarded even if
// someone configures CLIENT_URL with a trailing path by mistake, e.g.
// "https://example.com/app/", which becomes just "https://example.com").
export function resolveAppOrigin() {
  const raw = process.env.CLIENT_URL;
  if (!raw) {
    throw new HttpError(500, "Application origin is not configured");
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(500, "Application origin is misconfigured");
  }

  // Rejects javascript:, data:, file:, and any other non-http(s) scheme —
  // CLIENT_URL is operator/deployment configuration, not user input, but
  // this is still a real safety net against a bad deploy value ever
  // becoming a link this app emails out.
  const allowed = isProduction() ? PRODUCTION_PROTOCOLS : NON_PRODUCTION_PROTOCOLS;
  if (!allowed.has(url.protocol)) {
    throw new HttpError(500, "Application origin uses an unsupported protocol");
  }

  if (isProduction() && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1")) {
    throw new HttpError(500, "Application origin cannot be localhost in production");
  }

  if (url.username || url.password) {
    throw new HttpError(500, "Application origin must not contain embedded credentials");
  }

  return url.origin;
}

// Builds an absolute URL under the app's own origin from path segments,
// each individually percent-encoded (so a token/id is always a single,
// safe path segment, never accidentally reinterpreted as extra path
// structure or query syntax). Uses the URL constructor's own base-relative
// resolution (`new URL(path, origin)`), not string concatenation — this is
// what makes a trailing slash in CLIENT_URL incapable of ever producing a
// double slash.
export function buildAppUrl(...segments) {
  const origin = resolveAppOrigin();
  const path = `/${segments.map((s) => encodeURIComponent(String(s))).join("/")}`;
  return new URL(path, origin).toString();
}
