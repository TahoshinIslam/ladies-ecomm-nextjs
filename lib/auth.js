import { HttpError } from "./http.js";
import { readSessionTokenFromRequest } from "./cookies.js";
import { validateSessionToken } from "./session.js";

// Phase 2: cookie-based, server-side session auth. Replaces the old
// Authorization: Bearer JWT — no bearer-header fallback exists anywhere in
// this file. A request without a valid __Host-tahos_session (or
// tahos_session in dev) cookie is unauthenticated, full stop.
//
// Every exported function here keeps its exact Phase-1 name and signature
// (getSessionUser(request), requireUser(request), requireAdmin(request),
// requirePermission(request, permission), requireStaff(request)) —
// deliberately, so none of the ~39 Route Handlers that already call these
// need to change at all. Only what backs them changed.
//
// getSessionUserFromQuery (the old ?token= reader for the two SSE routes)
// is gone: EventSource sends cookies automatically same-origin, so the two
// SSE routes now call getSessionUser(request) like every other route —
// see app/api/admin/events/route.js and app/api/orders/[id]/events/route.js.

/**
 * Resolves the current request's session user via the session cookie, or
 * null if there isn't a valid one. Returns a real user object from the
 * database (never sent directly to a client — every caller that returns user data
 * to a response goes through services/authService.js's publicUser()).
 */
export async function getSessionUser(request) {
  const rawToken = readSessionTokenFromRequest(request);
  if (!rawToken) return null;
  const session = await validateSessionToken(rawToken);
  return session?.user || null;
}

/**
 * There is no staff authorization here any more.
 *
 * requireAdmin, requirePermission and requireStaff used to live here. Every
 * route that called them has moved to the admin dashboard, which owns its
 * own accounts, roles and permissions and writes an audit trail for each
 * change. They were kept for one commit as an explicit lock while those
 * routes were still present; with the routes gone there is nothing to lock,
 * and a guard with no callers is an invitation to give it some.
 *
 * What is left is what a storefront needs: who is this (getSessionUser) and
 * is anyone signed in (requireUser). The accounts this app authenticates are
 * shoppers — `customers` has no role and no permissions column, because a
 * shopper has neither.
 */

// Any logged-in user — no role check. For routes like cart that just need
// "who is this," not "is this an admin."
export async function requireUser(request) {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no session");
  return user;
}

