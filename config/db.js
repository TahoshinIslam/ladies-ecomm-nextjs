import mongoose from "mongoose";

// Cached on `global` so Next.js dev's module hot-reloading reuses the same
// connection instead of opening a new one on every file save (a well-known
// Next.js + Mongoose pitfall — without this, dev traffic alone can exhaust
// MongoDB Atlas's connection limit). `globalThis` survives module reloads;
// a plain module-level variable would not.
const cache = (globalThis.__mongooseCache ??= { conn: null, promise: null });

// --- Local-machine safety guard (incident response, 2026-09-12) ---
//
// Root cause of the incident: a plain `next dev` (or an equally plain local
// `next start`), run directly on a developer's own machine with none of
// the two pre-existing test-only overrides set, silently fell through to
// `MONGO_URI` — the real Production database — with no guard at all. An
// ordinary admin-UI verification session on that server mutated a real
// order. See the incident report for the full account (not committed to
// the repo).
//
// `VERCEL` is the correct discriminator, not NODE_ENV: Vercel sets
// `VERCEL=1` automatically on every Preview and Production deployment,
// both at build time and at runtime, and never on a developer's own
// machine — so gating on it (rather than trying to infer "local" from
// NODE_ENV, which `next start` also forces to "production") protects both
// `next dev` and a bare local `next start` while leaving real Vercel
// Preview/Production behavior completely untouched.
function isVercelRuntime() {
  return !!process.env.VERCEL;
}

// Parses only the database name and hostname out of a URI — never returns
// or logs the URI itself, so a thrown error built from this can never leak
// credentials or query parameters.
function extractDbInfo(uri) {
  try {
    const u = new URL(uri);
    const dbName = u.pathname.replace(/^\//, "").split("?")[0] || null;
    return { dbName, hostname: u.hostname || null };
  } catch {
    return { dbName: null, hostname: null };
  }
}

const SAFE_LOCAL_DB_NAME_PATTERN = /(_dev|_test|_preview)$/i;

function isLocalHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

// No pino/logger dependency here on purpose — `pino`/`pino-pretty` were
// never installed packages (the old, unreferenced utlis/logger.js that
// wanted them was confirmed dead and removed in Phase 6). Plain console
// output is enough for connection status.
//
// Does NOT call process.exit() on failure — this runs inside a live Next.js
// server process handling other requests; killing the whole process because
// one request's DB connection attempt failed would take down every other
// route too. Failures propagate as a rejected promise instead, which
// lib/http.js's withRoute() turns into a 500 for that one request.
const connectDB = async () => {
  if (cache.conn) return cache.conn;

  // `next build`'s static-generation workers execute Server Component
  // trees to probe whether a route COULD be static, before any route's
  // own runtime logic (this app's own proxy.js middleware, which reads
  // the session cookie on every real request) ever runs — so a shared
  // Server Component that fetches data unconditionally (no
  // `force-dynamic`, no dynamic API call ahead of it) can get invoked
  // during the build itself, not just at request time. That already
  // happened here once: app/(routes)/layout.jsx's category fetch was
  // silently connecting to and reading MONGO_URI (this project's
  // Production database) on every `npm run build`. NEXT_PHASE is the
  // official, documented way (next/dist/shared/lib/constants) to detect
  // exactly that build phase — failing loudly here is the actual fix
  // (app/(routes)/layout.jsx now also declares `force-dynamic`, which is
  // what should prevent this from being reached during a build at all),
  // this is the fail-safe for any other page/layout that adds a data
  // fetch later without that same guard.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    throw new Error(
      "connectDB() was called during `next build` (NEXT_PHASE=phase-production-build). " +
        "This app has no legitimate build-time database access — every route is " +
        "request-time dynamic (see proxy.js). Whatever Server Component reached this " +
        "needs `export const dynamic = \"force-dynamic\"` (or its data fetch moved " +
        "behind a request-time-only code path) instead of connecting here.",
    );
  }

  if (!cache.promise) {
    mongoose.set("strictQuery", true);

    // Phase 1 HTTP-integration test harness only (scripts/httpTestServer.mjs):
    // a running `next start`/`next dev` process forces its own NODE_ENV
    // ("production"/"development"), so the NODE_ENV==="test" branch below
    // can never select MONGO_URI_TEST for a real Next.js server process —
    // this is a second, independent path for that one case. It requires
    // BOTH of two unusual, non-NODE_ENV-derived flags to be set together
    // (never true by accident, and never set by anything other than the
    // test harness itself), so it cannot silently activate in a real
    // deployment the way trusting NODE_ENV alone could.
    const useTestServerOverride =
      process.env.ALLOW_TEST_DB_OVERRIDE === "true" && !!process.env.TEST_SERVER_MONGO_URI;
    const isNodeTestEnv = process.env.NODE_ENV === "test";
    // Any local-machine run (developer's own `next dev` or a bare local
    // `next start`) that isn't already covered by one of the two existing,
    // explicitly-flagged exceptions above. See the guard block above this
    // function for why VERCEL (not NODE_ENV) is the right discriminator.
    const isLocalMachineRuntime = !isVercelRuntime() && !useTestServerOverride && !isNodeTestEnv;

    let uri;
    let missingVarLabel;
    if (useTestServerOverride) {
      uri = process.env.TEST_SERVER_MONGO_URI;
      missingVarLabel = "TEST_SERVER_MONGO_URI";
    } else if (isNodeTestEnv) {
      uri = process.env.MONGO_URI_TEST;
      missingVarLabel = "MONGO_URI_TEST";
    } else if (isLocalMachineRuntime) {
      const devUri = process.env.MONGO_URI_DEV || process.env.MONGO_URI_TEST;
      const devVarName = process.env.MONGO_URI_DEV ? "MONGO_URI_DEV" : "MONGO_URI_TEST";
      if (!devUri) {
        throw new Error(
          "Running locally (not on Vercel) requires MONGO_URI_DEV or MONGO_URI_TEST to be set. " +
            "Refusing to fall back to MONGO_URI — that is the Production database and must never " +
            "be reachable from a plain local `next dev`/`next start`.",
        );
      }
      const { dbName, hostname } = extractDbInfo(devUri);
      if (dbName === "nextjs_ecomm") {
        throw new Error(
          `${devVarName} resolves to database "nextjs_ecomm" (the Production database name) — ` +
            "refusing to use it for local development.",
        );
      }
      if (!dbName || !SAFE_LOCAL_DB_NAME_PATTERN.test(dbName)) {
        throw new Error(
          `${devVarName}'s database name ("${dbName || "unknown"}") doesn't look like a safe local/` +
            'development database (expected a name ending in "_dev", "_test", or "_preview") — refusing to use it.',
        );
      }
      if (hostname && !isLocalHostname(hostname) && process.env.ALLOW_REMOTE_DEV_DB !== "true") {
        throw new Error(
          `${devVarName} points at a remote host ("${hostname}"), not localhost. If this is an intentional ` +
            "shared remote dev/preview database, set ALLOW_REMOTE_DEV_DB=true to confirm that explicitly.",
        );
      }
      uri = devUri;
      missingVarLabel = devVarName;
    } else {
      // Vercel Preview/Production (VERCEL is set) — unchanged behavior.
      uri = process.env.MONGO_URI;
      missingVarLabel = "MONGO_URI";
    }
    if (!uri) {
      throw new Error(`${missingVarLabel} is not set`);
    }
    // Phase 11, section H — explicit pool/timeout settings for a Vercel
    // Fluid Compute deployment. Fluid Compute REUSES a warm function
    // instance across concurrent requests (not one-request-per-instance),
    // so each warm instance keeps its own cached connection+pool
    // (globalThis.__mongooseCache above) for its lifetime — the pool size
    // needs to absorb one instance's own concurrent in-flight requests,
    // not the whole app's total traffic (many instances each hold their
    // own pool in parallel).
    //   - maxPoolSize: 20 — conservative default. Formula: (Atlas
    //     connection-limit tier) / (expected concurrent warm instances)
    //     with headroom for admin/monitoring connections; 20 is a safe
    //     starting point for a low/medium free-tier-adjacent Atlas
    //     cluster (typically 500 connection limit) even at a few hundred
    //     concurrent warm instances, while leaving enough headroom for
    //     one instance to hold several concurrently-open SSE streams
    //     (each polling the durable event outbox roughly once per
    //     second — see lib/events.js) at the same time as ordinary
    //     request traffic without those polls queuing behind each
    //     other for a free connection. (Empirically: this repo's own
    //     local single-process HTTP-integration harness, which routes
    //     every test file's traffic through ONE shared pool, showed rare
    //     intermittent cache-invalidation-timing test flakiness at
    //     maxPoolSize 10 under its own concurrent load/SSE tests, and
    //     none across repeated runs at 20 — a real, if narrow and
    //     local-harness-specific, signal that 10 cuts it close for even
    //     modest concurrent DB-bound work on one instance.) Raise
    //     further only with real Atlas connection-count evidence
    //     (Atlas's own connection metrics), never speculatively.
    //   - minPoolSize: 1 (was 0) — real production measurement (admin
    //     routes, which get lower/burstier traffic than the storefront and
    //     so hit a genuinely idle pool far more often) showed a live,
    //     uncached query against an 11-document collection consistently
    //     taking 1.2-1.3s end to end, on both a "cold" and an immediately-
    //     repeated "warm" request — i.e. NOT explained by a data-cache miss
    //     (this endpoint has none, by design: an admin's own product table
    //     must always read live) but by the driver re-establishing a
    //     MongoDB connection from scratch on every request whenever the
    //     pool had already dropped to zero. minPoolSize:0's own reasoning
    //     ("don't pay to hold a connection just to save a small reconnect
    //     latency") undersold that latency — keeping exactly one warm
    //     connection per instance is a negligible fraction of the same
    //     maxPoolSize:20 headroom already budgeted above, in exchange for
    //     removing a real, repeatedly-measured multi-hundred-ms-to-second
    //     tax from every request that lands on an instance whose pool had
    //     gone idle.
    //   - serverSelectionTimeoutMS/connectTimeoutMS: bounded so a
    //     genuinely unreachable/misconfigured database fails a request
    //     within a few seconds instead of hanging until the platform's
    //     own function-duration limit kills it.
    cache.promise = mongoose
      .connect(uri, {
        maxPoolSize: 20,
        minPoolSize: 1,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      })
      .then((m) => {
      // Database NAME is not sensitive (it's not a credential — knowing
      // "which database" a running instance is talking to is exactly the
      // kind of thing operators legitimately need from logs) and is
      // genuinely useful: this exact detail was missing during Phase 11's
      // live-verification work, where an ambiguous/duplicate env var made
      // it impossible to confirm from the outside which database a
      // deployment had actually connected to without this.
      console.log(`MongoDB connected: ${m.connection.host}/${m.connection.name}`);
      return m;
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (err) {
    cache.promise = null;
    throw err;
  }
  return cache.conn;
};

export default connectDB;
