// Local-machine safety guard.
//
// It exists because of a real incident: a plain `next dev` run connected to
// the real Production database on a REMOTE host, and an ordinary admin-UI
// verification session mutated a real order.
//
// The current architecture has one DB_NAME concept, no separate "dev"
// database, and XAMPP's MySQL is inherently local-only — local dev is
// SUPPOSED to point at DB_HOST=127.0.0.1, and does, by design.
//
// The one piece of that incident that genuinely could still recur is the
// REMOTE-HOST half: if this app is ever pointed at a real remote
// production MySQL host (a managed DB service, post-deployment), nothing
// today stops an ordinary local `next dev` from silently connecting to
// it — there is no MySQL-native "which environment is this" signal.
// This function is that guard: never let a plain local run connect to a
// non-localhost database without an explicit, deliberate opt-in.
//
// Pure predicate (never throws) so config/db.js's buildPool() decides what
// to do with the result — same shape as lib/testDbSafety.js's checks, and
// for the same reason: this needs to be unit-testable without a live
// database or a real Vercel/test environment.

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * @param {object} env - a process.env-shaped object (never process.env
 *   directly, so this stays a pure function callers can unit test)
 * @param {string} host - the resolved DB_HOST value
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkLocalDevHost(env, host) {
  // Vercel Preview/Production sets VERCEL=1 itself, automatically, at both
  // build and runtime, and never on a developer's own machine — the same
  // discriminator the old guard used, and for the same reason: NODE_ENV
  // alone can't tell "local machine" apart from a real deployment (`next
  // start` always forces NODE_ENV=production regardless of where it runs).
  if (env.VERCEL) return { ok: true };
  // The automated test suite has its own independent, stricter guard
  // (lib/testDbSafety.js) — this one is specifically about protecting a
  // human's ordinary `next dev`/local `next start` session.
  if (env.NODE_ENV === "test") return { ok: true };
  if (!host) return { ok: false, reason: "DB_HOST is not set" };
  if (LOCAL_HOSTNAMES.has(host)) return { ok: true };
  if (env.ALLOW_REMOTE_DEV_DB === "true") return { ok: true };
  return {
    ok: false,
    reason:
      `DB_HOST ("${host}") is not localhost, and this looks like a local-machine run (not Vercel, not a test run). ` +
      "Refusing to connect a plain `next dev`/local `next start` to a remote database without an explicit opt-in. " +
      "If this is an intentional shared remote dev/preview database, set ALLOW_REMOTE_DEV_DB=true to confirm that explicitly.",
  };
}
