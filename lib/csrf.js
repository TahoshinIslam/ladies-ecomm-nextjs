// @ts-check
import crypto from "crypto";

import { readCsrfCookieFromRequest } from "./cookies.js";

// Two independent CSRF layers — Origin
// validation and a session-bound CSRF token. Both are applied uniformly to
// every unsafe (POST/PUT/PATCH/DELETE) request from lib/http.js's
// withRoute(), not per-route, so no individual Route Handler needs to
// remember to call this.

const sha256 = (/** @type {string} */ raw) => crypto.createHash("sha256").update(raw).digest("hex");

/**
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const isUnsafeMethod = (/** @type {string} */ method) => UNSAFE_METHODS.has(method);

/**
 * Layer 1 — Origin validation. Applied to every unsafe request, including
 * the unauthenticated auth endpoints (login/register/forgot-password/
 * reset-password), per the spec's explicit instruction that those need it
 * too (they're exactly the requests a CSRF attack would target before a
 * session even exists).
 *
 * Trust model, documented rather than assumed:
 *   - If the `Origin` header is present (true for essentially all modern
 *     browser-originated fetch/XHR/form-post requests to a POST/PUT/PATCH/
 *     DELETE endpoint), it MUST exactly equal the configured canonical
 *     origin (APP_ORIGIN) — or, if APP_ORIGIN isn't configured (local dev
 *     convenience only), it must match the scheme+host the request itself
 *     arrived on.
 *   - If `Origin` is absent, we fall back to `Sec-Fetch-Site` (a
 *     browser-set, non-spoofable-by-script header on modern browsers) —
 *     `same-origin` is accepted, anything else is rejected. If neither
 *     header is present at all (old browsers, some non-browser clients),
 *     we do NOT silently allow the request; we reject it. This
 *     deliberately does not fall back to trusting `Host`/`X-Forwarded-Host`
 *     alone, since those are attacker-controllable unless a specific
 *     trusted-proxy configuration guarantees otherwise, which this
 *     codebase has no way to verify generically.
 *
 * @param {Request} request
 * @returns {boolean}
 */
export function validateOrigin(request) {
  const origin = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site");

  if (origin) {
    const expected = canonicalOrigin(request);
    return origin === expected;
  }

  if (secFetchSite) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }

  // Neither signal present — refuse rather than guess.
  return false;
}

/**
 * @param {Request} request
 * @returns {string}
 */
function canonicalOrigin(request) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN;
  // No explicit APP_ORIGIN: derive from the request's own URL (same-origin by construction for a same-process `next dev`/`next start`).
  const own = new URL(request.url);

  // Local development only. `next dev` reports every request's URL as http://localhost:<port>, whatever address the browser actually
  // used — so opening the store as http://127.0.0.1:<port> or by the machine's LAN address (http://192.168.x.x:<port>) sent an Origin
  // that could never equal it, and every login/registration was refused as "cross-origin". The Host header is what the browser used to
  // reach the server, so an Origin equal to it is the page's own origin. Trusted ONLY when NODE_ENV is "development" and the host is
  // `localhost` or an IP address — never a domain name (a name an attacker controls could be pointed at this machine) and never in
  // production, where a proxy can rewrite Host and APP_ORIGIN must be set (see .env.example).
  if (process.env.NODE_ENV === "development") {
    const host = request.headers.get("host");
    if (host && isLocalDevHost(host)) return `${own.protocol}//${host}`;
  }
  return own.origin;
}

/** `localhost`, or an IPv4/IPv6 address literal, with an optional port. */
/**
 * @param {string} host
 * @returns {boolean}
 */
function isLocalDevHost(host) {
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.replace(/:\d+$/, "");
  return hostname === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || /^\[[0-9a-f:]+\]$/i.test(hostname);
}

/**
 * Layer 2 — session-bound CSRF token, for authenticated unsafe requests
 * only. Callers pass the already-resolved `session` (or null, if the
 * request carries no valid session at all — in which case there is no
 * csrfTokenHash to check against, and this correctly returns true: an
 * unauthenticated unsafe request is Layer 1's job, not this one's. Once
 * `requireUser`/etc. run inside the handler, a missing session still
 * produces its own 401).
 *
 * @param {Request} request
 * @param {{ csrfTokenHash?: string | null } | null | undefined} session
 * @returns {boolean}
 */
export function verifyCsrfForSession(request, session) {
  if (!session) return true;

  const headerToken = request.headers.get("x-csrf-token");
  const cookieToken = readCsrfCookieFromRequest(request);

  // Never accepted from a query parameter — deliberately not read from
  // request.url at all, only from the header + cookie.
  if (!headerToken || !cookieToken) return false;
  if (!constantTimeEqual(headerToken, cookieToken)) return false;

  const headerHash = sha256(headerToken);
  return constantTimeEqual(headerHash, session.csrfTokenHash);
}
