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
 * Staff authorization does not exist in the storefront any more.
 *
 * Shop management moved to the admin dashboard, which owns its own accounts,
 * roles and permissions, and writes an audit trail for every change. The
 * accounts this app can authenticate are shoppers: `customers` has no `role`
 * and no `permissions` column, because a shopper has neither.
 *
 * These guards already refused everyone once userModel started reporting
 * every account as "customer" — but only as a side effect of that value, not
 * as a decision. That is a bad way to hold twenty write endpoints shut: one
 * plausible-looking change to the role field and they all quietly reopen,
 * against a database that is now shared with every other store. So the
 * refusal is stated here instead, ahead of any role check.
 *
 * Removing the routes that call these is the honest end state; until then
 * this is the lock, and the message says where the door is.
 */
const STAFF_MOVED =
  "Shop management has moved to the admin dashboard. This storefront can no longer perform staff actions.";

export async function requireAdmin(request) {
  // Still resolves the session first, so an unauthenticated caller gets 401
  // rather than a 403 that implies signing in would have helped.
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no session");
  throw new HttpError(403, STAFF_MOVED);
}

// Was: admin bypasses every check, an employee needs the named permission.
// Now refuses everyone — see STAFF_MOVED above. `permission` is still taken
// so the twenty call sites keep saying what they meant, and so removing them
// is a deletion rather than a rewrite.
export async function requirePermission(request, permission) {
  void permission;
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no session");
  throw new HttpError(403, STAFF_MOVED);
}

// Any logged-in user — no role check. For routes like cart that just need
// "who is this," not "is this an admin."
export async function requireUser(request) {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no session");
  return user;
}

// Was the coarse "are they staff at all" gate, for the admin notification
// and event stream. Refuses everyone now — see STAFF_MOVED above.
export async function requireStaff(request) {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no session");
  throw new HttpError(403, STAFF_MOVED);
}
