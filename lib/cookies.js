// Centralized, server-only cookie configuration for the session-cookie
// auth system (Phase 2). Every place that sets, reads, or clears the
// session/CSRF cookies goes through here — nothing else should construct
// a Set-Cookie header or a cookie name string by hand.
//
// Server-only by construction, not by an added package: this module is
// only ever imported by lib/session.js, lib/auth.js, lib/http.js and
// Route Handlers, all of which already import next/server (NextResponse)
// and/or Node's `crypto` — neither is bundleable into a Client Component,
// so Next's own bundler already refuses to include this file (or anything
// that imports it) in client code. This matches how every other
// server-only module in this codebase (models/*, config/db.js, lib/auth.js
// itself) is already protected, without adding a new dependency just to
// restate a guarantee the existing import graph already provides.

// Pure, parameterized so tests/session.test.mjs can verify both branches
// directly — without needing to flip process.env.NODE_ENV mid-test-run,
// which would also (undesirably) affect config/db.js's own NODE_ENV==="test"
// database-selection check.
export const sessionCookieNameFor = (isProdEnv) => (isProdEnv ? "__Host-tahos_session" : "tahos_session");

const isProd = () => process.env.NODE_ENV === "production";

// __Host- is a browser-enforced cookie-name prefix: a cookie named this way
// is REQUIRED to have Secure, Path=/, and no Domain attribute, or the
// browser silently refuses to set it at all. Using it in production is a
// second, browser-enforced guarantee on top of the attributes we set
// ourselves below — not just a naming convention.
//
// Computed once at module load: NODE_ENV doesn't change during a real
// server process's lifetime, and freezing it here keeps every call site
// consistent within one process. (The `secure` flag below is instead
// re-checked per-call — see setSessionCookie()'s own comment for why.)
export const SESSION_COOKIE_NAME = sessionCookieNameFor(isProd());
// Not HttpOnly — see lib/csrf.js for why the CSRF value is deliberately
// JavaScript-readable (it is not a credential on its own).
export const CSRF_COOKIE_NAME = "tahos_csrf";

// Configurable via SESSION_MAX_AGE_DAYS (see .env.example); defaults to 30
// days — long enough that a customer isn't forced to re-login constantly,
// short enough that a stolen cookie doesn't stay valid indefinitely.
// Session-level revocation (logout, password reset/change) is the real
// control; this is just an outer bound.
const configuredDays = Number(process.env.SESSION_MAX_AGE_DAYS);
const SESSION_MAX_AGE_DAYS = Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : 30;
export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60;

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd(), // production must never emit an insecure cookie; dev/test run over plain HTTP
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    // No `domain` attribute — required for __Host- in production, and
    // there's no cross-subdomain need in dev/test either.
  };
}

/** Sets the HttpOnly session cookie on a NextResponse. `rawToken` is the ONLY place this raw value should ever appear — never logged, never in a JSON body. */
export function setSessionCookie(response, rawToken) {
  response.cookies.set(SESSION_COOKIE_NAME, rawToken, baseCookieOptions());
}

/** Clears the session cookie — same name/path/attributes it was set with, or the browser won't recognize it as the same cookie to remove. */
export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE_NAME, "", { ...baseCookieOptions(), maxAge: 0 });
}

/**
 * The raw CSRF cookie is intentionally NOT HttpOnly — RTK Query's client
 * code (store/apiSlice.js) needs to read it to attach X-CSRF-Token on
 * unsafe requests. It is not an authentication credential by itself: an
 * attacker who can read this cookie via XSS already has full script
 * execution in the page and doesn't need CSRF at all. Its only job is to
 * prove a request originated from JavaScript that could read this
 * same-origin cookie — a cross-site form post can't.
 */
export function setCsrfCookie(response, rawCsrfToken) {
  response.cookies.set(CSRF_COOKIE_NAME, rawCsrfToken, {
    httpOnly: false,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearCsrfCookie(response) {
  response.cookies.set(CSRF_COOKIE_NAME, "", {
    httpOnly: false,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// Parses the raw `Cookie` request header directly (standard Fetch API,
// `request.headers.get("cookie")`) rather than relying on NextRequest's
// `.cookies` convenience reader. Deliberate: it means these two functions
// work identically whether `request` is a real NextRequest (production) or
// a plain, spec-compliant Request object (every Phase 1/2 test in this repo
// constructs requests this way, via tests/helpers/testDb.mjs's requestAs())
// — `.cookies` doesn't exist on a plain Request at all, so relying on it
// here would make this code path untestable without a running Next server.
function readRawCookie(request, name) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      // A malformed percent-encoding (e.g. a bare "%" or "%zz") makes
      // decodeURIComponent throw a URIError. An untrusted, attacker- or
      // proxy-mutated Cookie header is exactly the kind of input that can
      // contain this — it must be treated the same as "no valid cookie"
      // (null, eventually a clean 401 from lib/auth.js), never allowed to
      // propagate up as an unhandled exception that lib/http.js's
      // catch-all would otherwise turn into a generic 500.
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Reads the raw session token from an incoming Route Handler request. Returns null if absent — never throws. */
export function readSessionTokenFromRequest(request) {
  return readRawCookie(request, SESSION_COOKIE_NAME);
}

/** Reads the raw CSRF cookie value from an incoming Route Handler request. */
export function readCsrfCookieFromRequest(request) {
  return readRawCookie(request, CSRF_COOKIE_NAME);
}
