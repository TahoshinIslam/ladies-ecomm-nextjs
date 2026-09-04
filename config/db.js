import mongoose from "mongoose";

// Cached on `global` so Next.js dev's module hot-reloading reuses the same
// connection instead of opening a new one on every file save (a well-known
// Next.js + Mongoose pitfall — without this, dev traffic alone can exhaust
// MongoDB Atlas's connection limit). `globalThis` survives module reloads;
// a plain module-level variable would not.
const cache = (globalThis.__mongooseCache ??= { conn: null, promise: null });

// No pino/logger dependency here on purpose — utlis/logger.js requires the
// `pino`/`pino-pretty` packages, neither of which is installed (see Phase 1
// notes). Plain console output is enough for connection status.
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
    cache.promise = mongoose.connect(uri).then((m) => {
      console.log(`MongoDB connected: ${m.connection.host}`);
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
