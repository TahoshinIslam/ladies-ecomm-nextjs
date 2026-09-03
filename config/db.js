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
    const uri = process.env.NODE_ENV === "test" ? process.env.MONGO_URI_TEST : process.env.MONGO_URI;
    if (!uri) {
      throw new Error(`${process.env.NODE_ENV === "test" ? "MONGO_URI_TEST" : "MONGO_URI"} is not set`);
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
