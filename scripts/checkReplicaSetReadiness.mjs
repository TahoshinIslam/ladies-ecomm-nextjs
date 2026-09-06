// Phase 11, section H — a READ-ONLY check that the configured MongoDB
// deployment is transaction-capable. This app relies on multi-document
// transactions (session.withTransaction — order creation, COD payment
// creation, order cancellation, guarded stock decrement, atomic coupon
// claims); a standalone (non-replica-set) mongod cannot run these at all,
// and fails at the FIRST live transaction attempt, not at connection
// time — so this check exists to catch that misconfiguration ahead of
// time, in CI or a pre-deploy step, rather than in production traffic.
//
// Read-only: runs `hello`/`isMaster` and `replSetGetStatus` only — never
// writes, never modifies data, never touches indexes or collections.
//
// Usage:
//   node scripts/checkReplicaSetReadiness.mjs
//     (NODE_ENV=production/unset -> requires MONGO_URI;
//      NODE_ENV=test -> requires MONGO_URI_TEST)
//
// Exit code: 0 if the deployment is transaction-capable, 1 otherwise
// (with a clear, redacted reason). Never prints the connection string.

import mongoose from "mongoose";

function redact(value) {
  return String(value).replace(/:\/\/[^/@\s]*@/g, "://<redacted>@");
}

function resolveUri() {
  const isTest = process.env.NODE_ENV === "test";
  const varName = isTest ? "MONGO_URI_TEST" : "MONGO_URI";
  const uri = process.env[varName];
  if (!uri) throw new Error(`${varName} is not set`);
  return uri;
}

async function main() {
  const uri = resolveUri();
  await mongoose.connect(uri);
  try {
    const admin = mongoose.connection.db.admin();
    const hello = await admin.command({ hello: 1 });

    // `setName` is present only when the server is a member of a replica
    // set (standalone mongod never has it); `msg === "isdbgrid"` marks a
    // mongos (sharded cluster) front-end, also transaction-capable.
    const isReplicaSetMember = !!hello.setName;
    const isMongos = hello.msg === "isdbgrid";

    if (!isReplicaSetMember && !isMongos) {
      console.error("NOT transaction-capable: connected to a standalone mongod (no replica set, no mongos).");
      console.error("This app requires multi-document transactions (order/payment creation, stock decrement, coupon claims) and cannot run correctly against a standalone instance.");
      process.exit(1);
    }

    if (isReplicaSetMember) {
      const status = await admin.command({ replSetGetStatus: 1 });
      const primaryUp = status.members?.some((m) => m.stateStr === "PRIMARY");
      if (!primaryUp) {
        console.error("Replica set has no reachable PRIMARY right now — transactions would fail until one is elected.");
        process.exit(1);
      }
      console.log(`Transaction-capable: replica set "${status.set}", ${status.members?.length ?? "?"} member(s), PRIMARY reachable.`);
    } else {
      console.log("Transaction-capable: connected via mongos (sharded cluster).");
    }
    process.exit(0);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(redact(err.message || String(err)));
  process.exit(1);
});
