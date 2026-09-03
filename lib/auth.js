import jwt from "jsonwebtoken";

import User from "../models/userModel.js";
import { HttpError } from "./http.js";
import { hasPermission } from "./permissions.js";

async function userFromToken(token) {
  if (!token) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id);
  return user || null;
}

// Bearer-token auth only — store/apiSlice.js sends `Authorization: Bearer
// <token>` on every request (token lives in localStorage via authSlice.js).
// No cookie handling: this app was originally split across a Vercel
// frontend / Render backend where third-party cookies get blocked, so
// bearer tokens were the deliberate choice (see utlis/generateToken.js).
export async function getSessionUser(request) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  return userFromToken(header.slice("Bearer ".length).trim());
}

// The browser's EventSource API (used for our SSE streams) can't send
// custom headers, so it can't carry Authorization: Bearer like every other
// request — the token has to travel as a query param instead
// (?token=<jwt>). Only the two SSE routes should ever accept a token this
// way; everything else stays header-only.
export async function getSessionUserFromQuery(request) {
  const token = new URL(request.url).searchParams.get("token");
  return userFromToken(token);
}

export async function requireAdmin(request) {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no token");
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
  if (!user) throw new HttpError(401, "Not authorized, no token");
  if (!hasPermission(user, permission)) {
    throw new HttpError(403, "You don't have permission to do this");
  }
  return user;
}

// Any logged-in user — no role check. For routes like cart that just need
// "who is this," not "is this an admin."
export async function requireUser(request) {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no token");
  return user;
}

// Admin or employee, no specific permission required — for things every
// staff member should see regardless of their granular permissions (the
// admin notification/event stream). Not exported by requirePermission's
// hasPermission() check since that always needs a concrete permission
// string; this is the coarser "are they staff at all" gate.
export async function requireStaff(request) {
  const user = await getSessionUser(request);
  if (!user) throw new HttpError(401, "Not authorized, no token");
  if (!["admin", "employee"].includes(user.role)) {
    throw new HttpError(403, "Staff access only");
  }
  return user;
}
