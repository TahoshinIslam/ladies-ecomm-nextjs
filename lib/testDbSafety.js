// Shared, pure test-database safety checks — used by scripts/assertTestDbSafety.mjs
// (the `pretest`/`pretest:http` gate) and scripts/httpTestServer.mjs (the
// HTTP-integration harness, which additionally TRUNCATEs and reseeds
// whatever database it connects to). Split out into its own module,
// instead of being copy-pasted logic inside each script as it was for the
// Mongo-era guards, specifically so it has real unit test coverage
// (tests/testDbSafety.test.mjs) independent of any live database.
//
// Every function here is a pure predicate (returns {ok, reason}, never
// throws, never exits) so callers decide what "unsafe" means for their own
// context (warn-and-skip locally, hard-fail in CI, hard-fail always for the
// HTTP harness, which is inherently destructive).

// The one database name this migration's docs/.env/.env.example actually
// name as the real, non-test one — see sql/schema.sql's header comment and
// .env.example's own "--- Database ---" section.
export const KNOWN_NON_TEST_DB_NAMES = ["ladies_multi_ecomm"];

export const TEST_DB_NAME_PATTERN = /(_test|_ci)$/i;

/** @returns {{ok: true} | {ok: false, reason: string}} */
export function checkTestDbName(dbName) {
  if (!dbName) return { ok: false, reason: "DB_NAME is not set" };
  if (KNOWN_NON_TEST_DB_NAMES.includes(dbName)) {
    return { ok: false, reason: `"${dbName}" is the real application database name` };
  }
  if (!TEST_DB_NAME_PATTERN.test(dbName)) {
    return { ok: false, reason: `"${dbName}" does not end in "_test" or "_ci"` };
  }
  return { ok: true };
}

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

/** @returns {{ok: true} | {ok: false, reason: string}} */
export function checkTestDbHost(host, { allowRemote = false } = {}) {
  if (!host) return { ok: false, reason: "DB_HOST is not set" };
  if (LOCAL_HOSTNAMES.has(host)) return { ok: true };
  if (allowRemote) return { ok: true };
  return { ok: false, reason: `"${host}" is not localhost (set ALLOW_REMOTE_TEST_DB=true to confirm an intentional shared remote test database)` };
}

/**
 * Runs both checks together — the shape every caller actually wants.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkTestDbConfig({ dbName, host, allowRemoteHost = false }) {
  const nameCheck = checkTestDbName(dbName);
  if (!nameCheck.ok) return nameCheck;
  const hostCheck = checkTestDbHost(host, { allowRemote: allowRemoteHost });
  if (!hostCheck.ok) return hostCheck;
  return { ok: true };
}

/**
 * Defense in depth: re-verifies the database a LIVE connection is actually
 * talking to, right before a destructive operation (TRUNCATE, DROP,
 * mass DELETE) — never trusts a resolved config value alone, since a stale
 * pool, a connection-string override, or a misconfigured env could in
 * principle diverge from what config/db.js's own getPool() resolved at
 * startup. `queryFn` is anything shaped like config/db.js's `query()` /
 * a pool's `.query()` (returns rows for a SELECT).
 *
 * Throws (never returns false) — every call site of this is immediately
 * followed by a destructive operation, so a soft {ok:false} return that a
 * caller could forget to check is the wrong shape here.
 */
export async function assertConnectedDbMatches(queryFn, expectedDbName) {
  const rows = await queryFn("SELECT DATABASE() AS db");
  const actual = rows[0]?.db;
  if (actual !== expectedDbName) {
    throw new Error(
      `Connected database is "${actual ?? "(none)"}", expected "${expectedDbName}" — refusing to run a destructive operation. ` +
        "This means the live connection disagrees with the resolved DB_NAME config, which should never happen; investigate before retrying.",
    );
  }
  return actual;
}
