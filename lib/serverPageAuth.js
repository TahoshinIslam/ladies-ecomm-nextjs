// Phase 7 — session authentication for Server Components (pages), as
// opposed to lib/auth.js's Route Handler authentication. Both read the
// SAME opaque, hashed, HttpOnly cookie session (lib/session.js's
// validateSessionToken — identical expiry/revocation rules, identical
// cookie name/prefix logic via lib/cookies.js's SESSION_COOKIE_NAME) —
// this file only swaps the cookie-reading front end for the one Server
// Components actually have available (next/headers' cookies() jar, not a
// Request object with a `cookie` header to parse by hand), so there is no
// second authentication implementation to keep in sync, only a second
// entry point into the same one.
//
// Deliberately does NOT read a bearer header or a `?token=` query string —
// there is no such fallback anywhere in this codebase (see lib/auth.js's
// own header comment), and Server Components have no legitimate reason to
// ever start one.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import connectDB from "../config/db.js";
import { SESSION_COOKIE_NAME } from "./cookies.js";
import { validateSessionToken } from "./session.js";
import { hasPermission } from "./permissions.js";

/**
 * Resolves the current request's session user for a Server Component, or
 * null if there isn't a valid one. Returns the same real Mongoose user
 * document validateSessionToken() already returns — callers must still
 * serialize/strip fields themselves before handing anything to a Client
 * Component (see lib/serialize.js), exactly as a Route Handler must before
 * a JSON response.
 *
 * Realtime-durability-class fix: unlike a Route Handler (which gets
 * connection readiness for free from lib/http.js's withRoute()), a Server
 * Component render never establishes a MongoDB connection on its own —
 * this is the single most-used entry point into that gap (every
 * auth-gated Server Component page calls this, directly or via
 * requireServerUser()/requirePermissionOrRedirect() below), so it's the
 * one place that needs to guarantee readiness to fix all of them at once.
 * See lib/serverDataCache.js's own header comment for the full story and
 * the reproduction that first surfaced this.
 */
export async function getServerPageUser() {
  await connectDB();
  const store = await cookies();
  const rawToken = store.get(SESSION_COOKIE_NAME)?.value;
  if (!rawToken) return null;
  const session = await validateSessionToken(rawToken);
  return session?.user || null;
}

/**
 * Any logged-in user, no role check — for pages like Orders/Order Detail
 * that just need "who is this." Redirects to /login (with a `next` param
 * so the customer lands back where they meant to go) instead of throwing,
 * since a Server Component page has no JSON-error response to return —
 * `redirect()` is the supported Next.js mechanism for this, and it throws
 * a special (non-catchable-by-application-code) control-flow signal
 * internally, so nothing after this call ever executes.
 */
export async function requireServerUser(currentPath = "/") {
  const user = await getServerPageUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(currentPath)}`);
  return user;
}

/**
 * Admin or employee holding `permission` (or admin, unconditionally — see
 * hasPermission()). An authenticated-but-under-permissioned user is
 * redirected home rather than shown a login prompt they'd just fail again;
 * an unauthenticated one still goes to /login first.
 */
export async function requireServerPermission(permission, currentPath = "/") {
  const user = await requireServerUser(currentPath);
  if (!hasPermission(user, permission)) redirect("/");
  return user;
}
