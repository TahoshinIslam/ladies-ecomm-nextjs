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

/**
 * Resolves the current request's session user for a Server Component, or
 * null if there isn't a valid one. Returns the same real user object
 * validateSessionToken() already returns — callers must still
 * serialize/strip fields themselves before handing anything to a Client
 * Component (see lib/serialize.js), exactly as a Route Handler must before
 * a JSON response.
 *
 * Realtime-durability-class fix: unlike a Route Handler (which gets
 * connection readiness for free from lib/http.js's withRoute()), a Server
 * Component render never establishes a database connection on its own —
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
 * that just need "who is this." Redirects to /login (with a `redirect`
 * param so the customer lands back where they meant to go — the same
 * query param name every client-side redirect to /login already uses:
 * AdminLayout.jsx, CheckoutPage.jsx, ProfilePage.jsx, RegisterPage.jsx, and
 * what LoginPage.jsx itself reads back — this used to send `next` instead,
 * a real, silent mismatch: LoginPage.jsx never read `next`, so anyone
 * bounced here from a protected page landed back on "/" after signing in,
 * not on the page they'd actually asked for) instead of throwing, since a
 * Server Component page has no JSON-error response to return — `redirect()`
 * is the supported Next.js mechanism for this, and it throws a special
 * (non-catchable-by-application-code) control-flow signal internally, so
 * nothing after this call ever executes.
 */
export async function requireServerUser(currentPath = "/") {
  const user = await getServerPageUser();
  if (!user) redirect(`/login?redirect=${encodeURIComponent(currentPath)}`);
  return user;
}

// requireServerPermission used to sit here: the page-level counterpart to
// the route guards, redirecting a signed-in but under-permissioned visitor
// home rather than to a login prompt they would just fail again. Its only
// callers were the admin pages. There are no permissions in this app to
// check any more — a shopper is either signed in or not — so the file's two
// remaining exports are getServerPageUser and requireServerUser.
