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

  return mysql.createPool({
    host,
    port,
    database,
    user,
    password,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_MAX || 20),
    queueLimit: 0,
    // Fails a query within a few seconds against a genuinely unreachable/
    // misconfigured database instead of hanging until the platform's own
    // function-duration limit kills it — same intent as the old Mongoose
    // serverSelectionTimeoutMS/connectTimeoutMS.
    connectTimeout: 5000,
    dateStrings: false,
    timezone: "Z",
    charset: "utf8mb4_unicode_ci",
    decimalNumbers: true,
  });
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
  const conn = await pool.getConnection();
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
  const [rows] = await pool.query(sql, params);
  return rows;
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
