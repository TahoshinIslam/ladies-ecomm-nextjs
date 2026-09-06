import { HttpError } from "./http.js";
import { hasPermission } from "./permissions.js";
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
 * null if there isn't a valid one. Returns a real Mongoose user document
 * (never sent directly to a client — every caller that returns user data
 * to a response goes through services/authService.js's publicUser()).
 */
export async function getSessionUser(request) {
  const rawToken = readSessionTokenFromRequest(request);
  if (!rawToken) return null;
  const session = await validateSessionToken(rawToken);
  return session?.user || null;
}

export async function requireAdmin(request) {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no session");
  if (user.role !== "admin") throw new HttpError(403, "Admin access only");
  return user;
}

// Admin bypasses every check (see hasPermission); an employee needs the
// specific permission on their account. Replaces requireAdmin on routes
// that should be reachable by a permitted employee, not just role "admin" —
// requireAdmin itself stays for the handful of callers that genuinely mean
// "the owner/admin only," and requireUser stays for routes an employee
// should never need special permission for (e.g. their own notifications).
export async function requirePermission(request, permission) {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no session");
  if (!hasPermission(user, permission)) {
    throw new HttpError(403, "You don't have permission to do this");
  }
  return user;
}

// Any logged-in user — no role check. For routes like cart that just need
// "who is this," not "is this an admin."
export async function requireUser(request) {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no session");
  return user;
}

// Admin or employee, no specific permission required — for things every
// staff member should see regardless of their granular permissions (the
// admin notification/event stream). Not exported by requirePermission's
// hasPermission() check since that always needs a concrete permission
// string; this is the coarser "are they staff at all" gate.
export async function requireStaff(request) {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no session");
  if (!["admin", "employee"].includes(user.role)) {
    throw new HttpError(403, "Staff access only");
  }
  return user;
}
