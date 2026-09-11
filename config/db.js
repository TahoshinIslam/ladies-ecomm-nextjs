import mongoose from "mongoose";

// Cached on `global` so Next.js dev's module hot-reloading reuses the same
// connection instead of opening a new one on every file save (a well-known
// Next.js + Mongoose pitfall — without this, dev traffic alone can exhaust
// MongoDB Atlas's connection limit). `globalThis` survives module reloads;
// a plain module-level variable would not.
const cache = (globalThis.__mongooseCache ??= { conn: null, promise: null });

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

    const uri = useTestServerOverride
      ? process.env.TEST_SERVER_MONGO_URI
      : process.env.NODE_ENV === "test"
        ? process.env.MONGO_URI_TEST
        : process.env.MONGO_URI;
    if (!uri) {
      const missingVar = useTestServerOverride
        ? "TEST_SERVER_MONGO_URI"
        : process.env.NODE_ENV === "test"
          ? "MONGO_URI_TEST"
          : "MONGO_URI";
      throw new Error(`${missingVar} is not set`);
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
