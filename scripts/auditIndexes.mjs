// Phase 11, section H — a safe, idempotent, generalized index-audit/ensure
// script covering every production-critical index in this app: sessions
// (models/sessionModel.js), rate limits (models/rateLimitModel.js), order
// idempotency + status/user lookups (models/orderModel.js), payment
// uniqueness (models/paymentModel.js), coupon-usage uniqueness
// (models/couponUsageModel.js), product slug/category/search
// (models/productModel.js), and reviews (models/reviewModel.js). Every one
// of these indexes is already declared on its schema (autoIndex: true
// builds them automatically the first time a normal app process connects
// and the model is loaded — same as scripts/ensureOrderIdempotencyIndex.mjs
// documents for the order idempotency index specifically) — this script
// generalizes that one existing script's exact safety pattern into a
// single audit covering every model at once, for deployments that
// deliberately disable autoIndex in production.
//
// Modes:
//   node scripts/auditIndexes.mjs            (default: dry-run/list mode —
//                                              reports drift, changes nothing)
//   node scripts/auditIndexes.mjs --ensure    (also calls createIndexes()
//                                              for any index declared on a
//                                              schema but missing from the
//                                              live collection)
//
// Safety, identical to scripts/ensureOrderIdempotencyIndex.mjs:
//   - createIndexes() only — NEVER syncIndexes(), which would also DROP
//     any index present on the live collection but not declared on the
//     current schema. This script only ever ADDS; it never removes
//     anything, in either mode.
//   - Never logs the connection string — only a redacted host/database
//     name; any thrown driver error is passed through the same redaction
//     pass, since MongoDB connection errors can otherwise echo the URI
//     (credentials included) back in err.message.
//   - Resolves exactly one explicit URI source based on NODE_ENV, with no
//     fallback between environments — same as
//     scripts/ensureOrderIdempotencyIndex.mjs.
//   - Always closes its own connection before exiting, and always exits
//     non-zero on any failure or (in dry-run mode) on any detected drift,
//     so it's safe to wire into a deploy pipeline as a gate.

import mongoose from "mongoose";

import Session from "../models/sessionModel.js";
import RateLimit from "../models/rateLimitModel.js";
import Order from "../models/orderModel.js";
import Payment from "../models/paymentModel.js";
import CouponUsage from "../models/couponUsageModel.js";
import Product from "../models/productModel.js";
import Review from "../models/reviewModel.js";

const MODELS = [Session, RateLimit, Order, Payment, CouponUsage, Product, Review];

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

// Compares the schema-declared index keys (mongoose's own normalized
// `schema.indexes()`) against what the live collection actually has,
// keyed by the index's `key` object (order-sensitive, matching Mongo's
// own index-key comparison) rather than by name — two indexes with
// different names but the same key/options are the same index to Mongo.
// A MongoDB text index is stored under synthesized keys (`_fts`/`_ftsx`),
// never the literal field names declared on the schema — so a plain
// key-object comparison can never match a text index and would falsely
// report it as perpetually missing. Any declared key containing a "text"
// value is treated as a single normalized signature, matched against
// whether the live collection has any index carrying `textIndexVersion`
// (Mongo's own marker that an index is a text index) — this collection
// only ever declares one text index (Mongoose only allows one per
// collection), so there is no ambiguity in treating "a text index exists"
// as sufficient.
function isTextIndexKey(key) {
  return Object.values(key).includes("text");
}

function keySignature(key) {
  return isTextIndexKey(key) ? "TEXT_INDEX" : JSON.stringify(key);
}

async function auditModel(model, ensure) {
  const declared = model.schema.indexes(); // [[keyObj, optionsObj], ...]
  const existing = await model.collection.indexes().catch(() => []);
  const existingSignatures = new Set(
    existing.map((idx) => (idx.textIndexVersion ? "TEXT_INDEX" : keySignature(idx.key))),
  );

  const missing = declared.filter(([key]) => !existingSignatures.has(keySignature(key)));

  if (ensure && missing.length > 0) {
    // createIndexes() builds every schema-declared index; already-present
    // ones are a no-op (Mongo treats an identical createIndex call as
    // idempotent), so calling it unconditionally here is safe even though
    // we already know which ones are "missing" — no separate per-index
    // call is needed.
    await model.createIndexes();
  }

  return { modelName: model.modelName, declaredCount: declared.length, missing: missing.map(([key]) => key) };
}

async function main() {
  const ensure = process.argv.includes("--ensure");
  const uri = resolveUri();

  await mongoose.connect(uri);
  console.log(`Connected: ${redact(mongoose.connection.host)}/${mongoose.connection.name}`);

  const results = [];
  try {
    for (const model of MODELS) {
      results.push(await auditModel(model, ensure));
    }
  } finally {
    await mongoose.disconnect();
  }

  let anyMissing = false;
  for (const r of results) {
    if (r.missing.length > 0) {
      anyMissing = true;
      console.log(`${r.modelName}: ${r.declaredCount} declared, ${r.missing.length} MISSING${ensure ? " (now created)" : ""}`);
      for (const key of r.missing) console.log(`  - ${JSON.stringify(key)}`);
    } else {
      console.log(`${r.modelName}: ${r.declaredCount} declared, all present`);
    }
  }

  if (anyMissing && !ensure) {
    console.log("\nRun with --ensure to create the missing indexes (createIndexes only — never drops anything).");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(redact(err.message || String(err)));
  process.exit(1);
});
