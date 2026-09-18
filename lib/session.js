import crypto from "crypto";

import Session from "../models/sessionModel.js";
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

// Confirmed audit finding, fixed: sessions previously had no idle timeout
// at all — an abandoned session (no explicit logout) stayed valid for the
// full absolute lifetime regardless of inactivity. `lastSeenAt` was
// already tracked but never read by validateSessionToken(). Configurable
// via SESSION_IDLE_TIMEOUT_MINUTES (see .env.example); defaults to 30
// days — long enough that no legitimate "closed the tab, came back next
// week" user session is falsely killed, short enough to bound a
// genuinely abandoned/stolen session's remaining lifetime meaningfully
// below the full absolute expiry.
const DEFAULT_IDLE_TIMEOUT_MINUTES = 30 * 24 * 60; // 30 days

// Confirmed configuration-validation gap, fixed: `lastSeenAt` is only
// written when it's already more than LAST_SEEN_THROTTLE_MS stale (see
// touchLastSeen() below) — a genuinely active user's lastSeenAt can
// legitimately lag "now" by almost that entire window. An idle timeout
// configured SHORTER than the throttle window would therefore log out
// real, active users mid-session, not just abandoned ones. Floored at
// 3x the throttle window (15 minutes) — comfortably above the worst-case
// lag with real margin, never silently accepting a misconfiguration that
// would break normal use.
const MIN_IDLE_TIMEOUT_MS = LAST_SEEN_THROTTLE_MS * 3;

// Pure — takes the raw (possibly unset/invalid/too-small) configured value
// and returns a validated timeout in milliseconds, applying the default
// and the floor above. Exported directly so this validation logic itself
// has real, isolated unit test coverage without needing to reload the
// whole module (env vars are read once at module load elsewhere in this
// file — see MAX_ACTIVE_SESSIONS_PER_USER's identical, established
// pattern above) or touch a database.
export function resolveIdleTimeoutMs(configuredMinutesRaw) {
  const configuredMinutes = Number(configuredMinutesRaw);
  const minutes = Number.isFinite(configuredMinutes) && configuredMinutes > 0 ? configuredMinutes : DEFAULT_IDLE_TIMEOUT_MINUTES;
  const ms = minutes * 60 * 1000;
  if (ms < MIN_IDLE_TIMEOUT_MS) {
    console.error(
      `[lib/session.js] SESSION_IDLE_TIMEOUT_MINUTES=${configuredMinutesRaw} is too short (below the minimum ` +
        `${MIN_IDLE_TIMEOUT_MS / 60000} minutes, which accounts for lastSeenAt's own write-throttle lag) — ` +
        `using ${MIN_IDLE_TIMEOUT_MS / 60000} minutes instead to avoid logging out genuinely active users.`,
    );
    return MIN_IDLE_TIMEOUT_MS;
  }
  return ms;
}

const SESSION_IDLE_TIMEOUT_MS = resolveIdleTimeoutMs(process.env.SESSION_IDLE_TIMEOUT_MINUTES);

const sha256 = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

/**
 * Creates a fresh session for `userId`. Returns the RAW token and RAW CSRF
 * value — callers (Route Handlers, via lib/cookies.js) put these directly
 * into cookies and MUST NOT log them, return them in a JSON body, or
 * persist them anywhere else. Only their SHA-256 hashes are ever written
 * to the database.
 *
 * Timeout model: `expiresAt` below is an ABSOLUTE deadline set once, here,
 * and never extended by activity — there is no sliding/rolling expiration
 * of the absolute deadline. Separately, `validateSessionToken()` now also
 * enforces an IDLE timeout against `lastSeenAt` (SESSION_IDLE_TIMEOUT_MS
 * above) — a session with no request in that window is treated as
 * expired even if its absolute deadline hasn't arrived yet. Confirmed
 * audit fix: previously `lastSeenAt` was tracked but never read, so an
 * abandoned session (no explicit logout) stayed fully valid for the
 * entire absolute lifetime regardless of inactivity.
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
  const activeIds = await Session.findActiveIdsByUser(userId);
  if (activeIds.length <= MAX_ACTIVE_SESSIONS_PER_USER) return;
  await Session.revokeByIds(activeIds.slice(MAX_ACTIVE_SESSIONS_PER_USER));
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
  const session = await Session.findByTokenHash(tokenHash);
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt <= new Date()) return null;
  const lastSeen = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : new Date(session.createdAt).getTime();
  if (Date.now() - lastSeen > SESSION_IDLE_TIMEOUT_MS) return null;
  if (!session.user) return null; // the referenced user no longer exists

  touchLastSeen(session).catch(() => {}); // best-effort, never blocks the request

  return session;
}

/** Fire-and-forget: only writes lastSeenAt when it's meaningfully stale, so a logged-in user browsing normally doesn't generate a write on every single request. */
async function touchLastSeen(session) {
  const isStale = Date.now() - new Date(session.lastSeenAt).getTime() > LAST_SEEN_THROTTLE_MS;
  if (!isStale) return;
  await Session.touchLastSeen(session._id);
}

/** Revokes exactly the session matching this raw token (logout). No-ops (does not throw) if the token doesn't match any session — logging out twice, or logging out after the session already expired, must not surface as an error. */
export async function revokeSessionByToken(rawToken) {
  if (!rawToken) return;
  await Session.revokeByTokenHash(sha256(rawToken));
}

/** Revokes every active session for a user — password reset, password change, and (optionally) an explicit "log out everywhere" action. */
export async function revokeAllSessionsForUser(userId) {
  await Session.revokeAllForUser(userId);
}
