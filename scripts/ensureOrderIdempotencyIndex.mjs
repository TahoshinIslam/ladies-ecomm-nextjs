// Phase 4/4B — explicit, idempotent production index-deployment step.
//
// config/db.js does not set `autoIndex: false`, so Mongoose's default
// (autoIndex: true) already builds this index automatically in the
// background the first time a normal app process connects and
// models/orderModel.js is loaded — same as the two pre-existing Order
// indexes. This script exists for deployments that DO run with autoIndex
// disabled in production (a common, reasonable ops practice — background
// index builds on a live connection can be slow/surprising on a large
// collection), so there is an explicit, safe step to run instead of
// relying on that default.
//
// Deliberately self-contained — does NOT import config/db.js's connectDB().
// That helper exists to serve the running app (including its
// ALLOW_TEST_DB_OVERRIDE test-harness side channel, irrelevant to a
// deployment step) and silently reuses a cached connection across calls in
// the same process. This script instead resolves exactly one explicit URI
// source based on NODE_ENV, with no fallback between environments: NODE_ENV=
// production/undefined requires MONGO_URI; NODE_ENV=test requires
// MONGO_URI_TEST. Missing the relevant one is a hard, immediate failure —
// never silently falls through to the other.
//
// Safety:
//   - createIndex() only — NEVER syncIndexes(), which would also DROP any
//     index present in MongoDB but absent from the current schema
//     definition. This script only ever adds the one Phase 4 index; it
//     never touches, rebuilds, or drops anything else, and is safe to run
//     repeatedly (createIndex on an already-identical index is a no-op).
//   - Never logs the connection string, only a redacted host/database
//     name — and any thrown driver error is passed through a redaction
//     pass first, since MongoDB connection errors can otherwise echo the
//     URI (credentials included) back in err.message.
//   - Always closes its own connection before exiting, and always exits
//     non-zero on any failure.
//
// Usage:
//   NODE_ENV=production MONGO_URI=<...> node scripts/ensureOrderIdempotencyIndex.mjs
//   NODE_ENV=test MONGO_URI_TEST=<...> node scripts/ensureOrderIdempotencyIndex.mjs   (dry run)

import mongoose from "mongoose";

import Order from "../models/orderModel.js";

function redact(value) {
  return String(value).replace(/:\/\/[^/@\s]*@/g, "://<redacted>@");
}

function resolveUri() {
  const isTest = process.env.NODE_ENV === "test";
  const varName = isTest ? "MONGO_URI_TEST" : "MONGO_URI";
  const uri = process.env[varName];
  if (!uri) {
    throw new Error(
      `${varName} is not set. This script requires it explicitly for NODE_ENV=${process.env.NODE_ENV || "production"} ` +
        `— it does not fall back to any other environment variable.`,
    );
  }
  return { uri, varName };
}

async function main() {
  const { uri, varName } = resolveUri();
  console.log(`Connecting using ${varName}...`);

  const conn = await mongoose.connect(uri);
  const dbName = conn.connection?.db?.databaseName || "(unknown)";
  const host = conn.connection?.host || "(unknown)";
  console.log(`Connected to database "${dbName}" on host "${host}".`);

  try {
    const indexName = await Order.collection.createIndex(
      { user: 1, idempotencyKeyHash: 1 },
      { unique: true, partialFilterExpression: { idempotencyKeyHash: { $exists: true } } },
    );
    console.log(`Order idempotency index ensured: ${indexName}`);
  } finally {
    await mongoose.disconnect();
    console.log("Connection closed.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to ensure Order idempotency index:", redact(err?.message || err));
    process.exit(1);
  });
