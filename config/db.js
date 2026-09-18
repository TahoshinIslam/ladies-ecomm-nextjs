import mysql from "mysql2/promise";

import { checkLocalDevHost } from "../lib/localDevSafety.js";

// Cached on `global` so Next.js dev's module hot-reloading reuses the same
// pool instead of opening a new one on every file save — same reasoning the
// old Mongoose connectDB() documented (`globalThis` survives module
// reloads; a plain module-level variable would not).
const cache = (globalThis.__mysqlPoolCache ??= { pool: null });

// Same NEXT_PHASE guard the old MongoDB connectDB() had: `next build`'s
// static-generation workers can execute Server Component trees (probing
// whether a route COULD be static) before any request-time code runs. This
// app has no legitimate build-time database access — every route is
// request-time dynamic (see proxy.js) — so a Server Component that still
// tries to reach the database during `next build` needs its own
// `force-dynamic`, not a silent build-time connection.
function assertNotBuildPhase() {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    throw new Error(
      "getPool() was called during `next build` (NEXT_PHASE=phase-production-build). " +
        "This app has no legitimate build-time database access — every route is " +
        "request-time dynamic (see proxy.js). Whatever Server Component reached this " +
        "needs `export const dynamic = \"force-dynamic\"` (or its data fetch moved " +
        "behind a request-time-only code path) instead of connecting here.",
    );
  }
}

// Mirrors the old Mongoose pool's Fluid Compute sizing rationale: a warm
// Vercel Function instance reuses this same pool across concurrent
// requests, so the pool needs to absorb one instance's own concurrent
// in-flight queries, not the whole app's total traffic — see the git
// history of this file (pre-migration) for the full measured rationale
// behind these numbers; kept as the starting point here rather than
// re-guessed from scratch.
function buildPool() {
  const host = process.env.DB_HOST;
  const port = Number(process.env.DB_PORT || 3306);
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD || "";

  if (!host || !database || !user) {
    throw new Error(
      "DB_HOST, DB_NAME, and DB_USER must be set (see .env.example). " +
        "DB_PASSWORD may be empty (XAMPP's default root account has no password).",
    );
  }

  // Incident response, restored for MySQL — see lib/localDevSafety.js's
  // own header comment for the full history. Checked once here (pool
  // creation is itself a once-per-process event via getPool()'s cache).
  const hostCheck = checkLocalDevHost(process.env, host);
  if (!hostCheck.ok) {
    throw new Error(hostCheck.reason);
  }

  const connectionLimit = Number(process.env.DB_POOL_MAX || 20);

  const pool = mysql.createPool({
    host,
    port,
    database,
    user,
    password,
    waitForConnections: true,
    connectionLimit,
    // Bounded, not unlimited: a request that can't get a pooled connection
    // within a reasonable wait fails fast with a clear, translatable error
    // (see acquireConnection() below) instead of queuing indefinitely under
    // sustained pool exhaustion — confirmed audit finding, `queueLimit: 0`
    // previously meant "unlimited queue depth," not "no queueing."
    // Confirmed via a real regression while testing this fix: a much
    // tighter bound (connectionLimit * 4) broke a legitimate bulk-seed
    // workload (tests/http/seo.integration.test.mjs creating 105 products
    // for its sitemap-scale test) with mysql2's own hard, un-translated
    // "Queue limit reached." error — the goal here is to stop genuinely
    // UNBOUNDED growth (the original `queueLimit: 0` bug), not to
    // throttle legitimate concurrent bursts below what real admin/seed
    // operations already need. This is generous enough to absorb that,
    // while still being a real, finite ceiling (not "unlimited"), and
    // configurable for deployments with different burst profiles.
    queueLimit: Number(process.env.DB_POOL_QUEUE_LIMIT) || connectionLimit * 50,
    // Fails a query within a few seconds against a genuinely unreachable/
    // misconfigured database instead of hanging until the platform's own
    // function-duration limit kills it — same intent as the old Mongoose
    // serverSelectionTimeoutMS/connectTimeoutMS. Note this only bounds the
    // TCP/handshake step of opening a brand-new physical connection — it
    // does NOT bound how long a caller waits for an already-open pooled
    // connection to free up under load; see acquireConnection()'s own
    // timeout for that.
    connectTimeout: 5000,
    dateStrings: false,
    timezone: "Z",
    charset: "utf8mb4_unicode_ci",
    decimalNumbers: true,
  });

  // Confirmed audit finding: this app's DATETIME(3) columns are meant to
  // hold UTC (every comparison in lib/expiryCleanup.js, models/sessionModel.js,
  // models/couponModel.js deliberately uses a JS-computed cutoff instead of
  // SQL NOW() specifically because "the real server's own session time_zone
  // is SYSTEM, not UTC" — see those files' own comments). But SYSTEM here
  // resolves to this host's local zone (confirmed UTC+6 / Asia-Dhaka on the
  // verified dev host), and nothing was ever setting the *session*
  // time_zone the live app's pooled connections actually run queries on —
  // sql/schema.sql's own `SET time_zone = '+00:00'` (line ~65) only ever
  // affected the one-off schema-bootstrap script's session, never a single
  // request-serving connection from this pool. The practical effect:
  // DEFAULT CURRENT_TIMESTAMP(3)/ON UPDATE CURRENT_TIMESTAMP(3) column
  // defaults and every explicit `NOW(3)` in models/*.js (session
  // created_at/revoked_at/last_seen_at, payment paid_at/refunded_at, cart/
  // wishlist updated_at, notification read_at, ...) were computed in local
  // server time and stored as if they were UTC wall-clock values — a
  // reproducible, confirmed 6-hour drift (verified directly against this
  // pool's own config: a DEFAULT CURRENT_TIMESTAMP row came back ~360
  // minutes ahead of the real UTC instant it was inserted at).
  //
  // Fixed here, once, for every physical connection the pool ever opens
  // (not per-query, not per-model) — `timezone: "Z"` above already tells
  // mysql2 to treat every DATETIME it reads/writes as UTC; this makes that
  // true by setting each connection's own SESSION (never GLOBAL — this
  // never touches the server's own configured timezone, and never needs
  // elevated privileges) time_zone to '+00:00' before the pool ever hands
  // that connection to application code.
  pool.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'", (err) => {
      if (err) console.error("Failed to set connection session time_zone to UTC:", err);
    });
  });

  return pool;
}

/**
 * Returns the shared MySQL connection pool, creating it on first call.
 * Does NOT probe connectivity itself — mysql2 pools connect lazily on the
 * first query, so a bad host/credential surfaces as that first query's
 * rejection, not here. Callers that need an eager reachability check (see
 * app/api/health/ready/route.js) should run a real query (e.g. `SELECT 1`).
 */
export function getPool() {
  assertNotBuildPhase();
  if (!cache.pool) {
    cache.pool = buildPool();
  }
  return cache.pool;
}

// Confirmed audit finding: `connectTimeout` (above) only bounds the TCP/
// handshake step of opening a brand-new physical connection — it does
// nothing for a caller waiting on `pool.getConnection()` when every
// physical connection is already checked out and busy. Previously nothing
// bounded that wait at all beyond the platform's own function-duration
// limit, so sustained pool exhaustion produced a slow, confusing hang
// instead of a fast, clear error.
const POOL_ACQUIRE_TIMEOUT_MS = Number(process.env.DB_POOL_ACQUIRE_TIMEOUT_MS || 8000);

export class PoolExhaustedError extends Error {
  constructor(message) {
    super(message);
    this.name = "PoolExhaustedError";
  }
}

/**
 * Checks out a connection from the pool with an explicit wait bound
 * (POOL_ACQUIRE_TIMEOUT_MS), instead of trusting `connectTimeout` (which
 * doesn't apply here — see above) or the pool's own queue to fail fast.
 * If the timeout wins the race, the real `getConnection()` call is still
 * outstanding; when it eventually resolves, it is released straight back
 * to the pool rather than left dangling — a slow acquire must never leak a
 * connection or leave an unreleased handle for a transaction that was
 * never actually started.
 */
async function acquireConnection(pool) {
  const pending = pool.getConnection();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      // Reads the same DB_POOL_MAX value buildPool() used, rather than
      // reaching into mysql2's internal pool.pool.config shape (undocumented,
      // not worth depending on) just to report a number in an error message.
      const connectionLimit = Number(process.env.DB_POOL_MAX || 20);
      reject(
        new PoolExhaustedError(
          `Timed out after ${POOL_ACQUIRE_TIMEOUT_MS}ms waiting for a database connection from the pool (all ${connectionLimit} in use). The database may be overloaded or a prior query/transaction is holding connections open too long.`,
        ),
      );
      // The real `pending` request is still outstanding underneath this
      // race — if/when it eventually resolves, release it straight back to
      // the pool instead of leaking an open, never-used connection. Errors
      // here (pool destroyed, etc.) are deliberately swallowed: the caller
      // already has its own PoolExhaustedError to handle.
      pending.then((conn) => conn.release()).catch(() => {});
    }, POOL_ACQUIRE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `fn` with a single dedicated connection checked out from the pool,
 * for callers that need several statements to share one session (a
 * transaction, or a sequence of statements that must run on the same
 * connection) — see lib/db/tx.js's withTransaction(), the SQL equivalent of
 * the old `mongoose.startSession()` + `session.withTransaction()` pattern
 * used by order creation/cancellation. Always releases the connection back
 * to the pool, even on error — never closes the pool itself.
 */
export async function withConnection(fn) {
  const pool = getPool();
  const conn = await acquireConnection(pool);
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

/**
 * Convenience one-shot query against the shared pool (auto-checks-out and
 * releases a connection). Use withConnection()/withTransaction() instead
 * when more than one statement needs to share a session.
 */
export async function query(sql, params) {
  const pool = getPool();
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (err) {
    // pool.query() manages its own connection acquisition internally
    // (unlike withConnection()'s explicit acquireConnection() above) and
    // throws mysql2's own plain, un-typed `Error('Queue limit reached.')`
    // when DB_POOL_QUEUE_LIMIT is exceeded — normalized here to the same
    // PoolExhaustedError shape lib/http.js already translates to a clean,
    // no-detail-leaked 503, instead of a raw message reaching the client.
    if (err.message === "Queue limit reached.") {
      throw new PoolExhaustedError(err.message);
    }
    throw err;
  }
}

/**
 * Closes the shared pool cleanly — used by scripts (migration, seeding) and
 * graceful-shutdown paths, never by a request-handling code path (a live
 * Next.js server process serves many other requests; closing the pool
 * because one request finished would break every other in-flight request).
 */
export async function closePool() {
  if (cache.pool) {
    const pool = cache.pool;
    cache.pool = null;
    await pool.end();
  }
}

/**
 * Compatibility entry point for the old Mongoose `connectDB()` call sites
 * (lib/http.js's withRoute(), lib/serverPageAuth.js, lib/serverDataCache.js,
 * the health/ready route) — every one of them just does `await connectDB()`
 * once before doing real work and never touches its return value, except
 * the health/ready route, which specifically wants a real reachability
 * check. A `SELECT 1` here serves both: it's cheap enough to run on every
 * request/page load, and it genuinely proves the database is reachable
 * (getPool() alone would not — mysql2 pools connect lazily on first query).
 */
export async function connectDB() {
  const pool = getPool();
  await pool.query("SELECT 1");
  return pool;
}

export default connectDB;
