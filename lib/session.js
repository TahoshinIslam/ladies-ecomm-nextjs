import crypto from "crypto";

import Session from "../models/sessionModel.js";
// Phase 11 fix: models/sessionModel.js's `user` field is a `ref: "users"`
// populated below (validateSessionToken's `.populate("user")`) — Mongoose
// only resolves a ref by model NAME, which requires that model to have
// been registered (i.e. models/userModel.js actually imported/executed)
// somewhere in this process first. In a real serverless/Fluid Compute
// instance, whichever route happens to run FIRST in a cold process is not
// guaranteed to import userModel.js itself (the new SSE routes,
// app/api/admin/events/route.js and app/api/orders/[id]/events/route.js,
// are a concrete example — confirmed to throw "Schema hasn't been
// registered for model 'users'" when hit as the first request on a fresh
// instance during Phase 11's multi-instance test). Importing it here,
// for its registration side effect only, makes every session-validating
// request self-sufficient regardless of which route happens to run
// first.
import "../models/userModel.js";
import { SESSION_MAX_AGE_SECONDS } from "./cookies.js";

// Core session lifecycle — used by lib/auth.js (validation on every
// authenticated request), services/authService.js (login/register),
// app/api/users/logout/route.js, and every password-reset/change path.
// Never call Session.* directly from anywhere else; this file is the one
// place that knows the hashing/expiry/revocation rules.
//
// Server-only by construction — see lib/cookies.js's header comment for
// why no separate package is needed to enforce this.

const RAW_TOKEN_BYTES = 32; // 256 bits, per the Phase 2 spec's minimum

// Configurable via MAX_SESSIONS_PER_USER (see .env.example); defaults to 10.
const configuredLimit = Number(process.env.MAX_SESSIONS_PER_USER);
const MAX_ACTIVE_SESSIONS_PER_USER = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 10;

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000; // only write lastSeenAt if it's this stale

const sha256 = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

/**
 * Creates a fresh session for `userId`. Returns the RAW token and RAW CSRF
 * value — callers (Route Handlers, via lib/cookies.js) put these directly
 * into cookies and MUST NOT log them, return them in a JSON body, or
 * persist them anywhere else. Only their SHA-256 hashes are ever written
 * to the database.
 *
 * Timeout model (documented, not changed — see .env.example's "KNOWN,
 * DOCUMENTED, LOWER-PRIORITY RISK" note for the full writeup): `expiresAt`
 * below is an ABSOLUTE deadline set once, here, and never extended by
 * activity — there is no sliding/rolling expiration. `lastSeenAt` is
 * tracked (see touchLastSeen()) but is purely informational; nothing in
 * validateSessionToken() reads it, so there is currently no idle timeout.
 * A session that is created and then abandoned (no explicit logout) stays
 * fully valid for the entire configured lifetime regardless of inactivity
 * — including for admin/employee sessions.
 */
export async function createSession(userId, { userAgent = "" } = {}) {
  const rawToken = crypto.randomBytes(RAW_TOKEN_BYTES).toString("hex");
  const rawCsrfToken = crypto.randomBytes(RAW_TOKEN_BYTES).toString("hex");

  await Session.create({
    user: userId,
    tokenHash: sha256(rawToken),
    csrfTokenHash: sha256(rawCsrfToken),
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
    userAgent: String(userAgent || "").slice(0, 200),
  });

  // Prevent unbounded accumulation: cap active sessions per user, oldest
  // first. Runs after create so the just-created session is never the one
  // culled by its own creation.
  await pruneExcessSessions(userId);

  return { rawToken, rawCsrfToken };
}

async function pruneExcessSessions(userId) {
  const active = await Session.find({ user: userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();
  if (active.length <= MAX_ACTIVE_SESSIONS_PER_USER) return;
  const excessIds = active.slice(MAX_ACTIVE_SESSIONS_PER_USER).map((s) => s._id);
  await Session.updateMany({ _id: { $in: excessIds } }, { $set: { revokedAt: new Date() } });
}

/**
 * Validates a raw session token from a request cookie. Returns the live
 * Session document (with `.user` populated) if valid, or null — never
 * throws for an invalid/expired/revoked token, since "no valid session" is
 * an entirely ordinary, expected outcome for lib/auth.js to translate into
 * a 401, not an exceptional one.
 *
 * Explicitly re-checks expiresAt/revokedAt here rather than trusting only
 * the TTL index (see models/sessionModel.js's comment) or a stale
 * in-memory read.
 */
export async function validateSessionToken(rawToken) {
  if (!rawToken) return null;
  const tokenHash = sha256(rawToken);
  // csrfTokenHash is select:false by default (see models/sessionModel.js) —
  // re-selected explicitly here because lib/csrf.js's verifyCsrfForSession()
  // needs to read it off the returned session. tokenHash itself is never
  // read back after this query's filter, so it stays excluded.
  const session = await Session.findOne({ tokenHash }).select("+csrfTokenHash").populate("user");
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt <= new Date()) return null;
  if (!session.user) return null; // the referenced user no longer exists

  touchLastSeen(session).catch(() => {}); // best-effort, never blocks the request

  return session;
}

/** Fire-and-forget: only writes lastSeenAt when it's meaningfully stale, so a logged-in user browsing normally doesn't generate a write on every single request. */
async function touchLastSeen(session) {
  const isStale = Date.now() - new Date(session.lastSeenAt).getTime() > LAST_SEEN_THROTTLE_MS;
  if (!isStale) return;
  await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } });
}

/** Revokes exactly the session matching this raw token (logout). No-ops (does not throw) if the token doesn't match any session — logging out twice, or logging out after the session already expired, must not surface as an error. */
export async function revokeSessionByToken(rawToken) {
  if (!rawToken) return;
  const tokenHash = sha256(rawToken);
  await Session.updateOne({ tokenHash, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

/** Revokes every active session for a user — password reset, password change, and (optionally) an explicit "log out everywhere" action. */
export async function revokeAllSessionsForUser(userId) {
  await Session.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}
