// Phase 11, section H — a safe, idempotent, generalized index-audit/ensure
// script. Phase 12 closure extended it from 7 to all 19 active models
// (models/*.js) — see the MODELS array below, kept in sync with the
// models directory by tests/auditIndexesCoverage.test.mjs. Every one
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
import Address from "../models/addressModel.js";
import AttributeDefinition from "../models/attributeDefinitionModel.js";
import Brand from "../models/brandModel.js";
import Cart from "../models/cartModel.js";
import Category from "../models/categoryModel.js";
import Coupon from "../models/couponModel.js";
import Notification from "../models/notificationModel.js";
import Event from "../models/eventModel.js";
import Settings from "../models/settingsModel.js";
import Theme from "../models/themeModel.js";
import User from "../models/userModel.js";
import Wishlist from "../models/wishlistModel.js";

// Phase 12 closure — every active Mongoose model in models/*.js, covering
// all 19 real production collections (previously only 7 were audited by
// this script; the other 12 were only ever cross-checked once, indirectly,
// via a Preview backup/restore drill). tests/auditIndexesCoverage.test.mjs
// enforces that this list stays exactly in sync with models/*.js — a new
// model file added later without updating this array fails that test.
const MODELS = [
  Session,
  RateLimit,
  Order,
  Payment,
  CouponUsage,
  Product,
  Review,
  Address,
  AttributeDefinition,
  Brand,
  Cart,
  Category,
  Coupon,
  Notification,
  Event,
  Settings,
  Theme,
  User,
  Wishlist,
];

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

// A missing UNIQUE index can fail to build if live documents already
// violate it (duplicate values under the new key). Reported as a bare
// COUNT of conflicting groups only — never a document, a field value, or
// which value is duplicated — so an operator knows to investigate before
// running --ensure, without this script itself ever exposing potentially
// sensitive field contents (an email, a SKU, a coupon code, ...).
async function countDuplicateGroupsFor(model, key) {
  const groupId = {};
  for (const field of Object.keys(key)) groupId[field] = `$${field}`;
  const pipeline = [
    { $group: { _id: groupId, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: "conflictingGroups" },
  ];
  const [result] = await model.collection.aggregate(pipeline).toArray();
  return result?.conflictingGroups ?? 0;
}

async function auditModel(model, ensure) {
  const declared = model.schema.indexes(); // [[keyObj, optionsObj], ...]
  const existing = await model.collection.indexes().catch(() => []);
  const existingSignatures = new Set(
    existing.map((idx) => (idx.textIndexVersion ? "TEXT_INDEX" : keySignature(idx.key))),
  );

  const missing = declared.filter(([key]) => !existingSignatures.has(keySignature(key)));

  // For any missing index that's declared unique (and not a text index,
  // which can't be "unique"), check for pre-existing duplicate values
  // BEFORE attempting to create it — read-only, reported as a count only.
  const conflictWarnings = [];
  for (const [key, options] of missing) {
    if (!options?.unique || isTextIndexKey(key)) continue;
    const conflicts = await countDuplicateGroupsFor(model, key);
    if (conflicts > 0) {
      conflictWarnings.push({ key, conflicts });
    }
  }

  if (ensure && missing.length > 0) {
    // createIndexes() builds every schema-declared index; already-present
    // ones are a no-op (Mongo treats an identical createIndex call as
    // idempotent), so calling it unconditionally here is safe even though
    // we already know which ones are "missing" — no separate per-index
    // call is needed. A unique index whose duplicate-conflict count is
    // nonzero (see above) will still be attempted here — Mongo itself is
    // the final, authoritative arbiter (createIndexes rejects the build
    // and throws if real conflicting documents exist), this function just
    // makes that risk visible to the operator beforehand rather than
    // silently discovering it via a thrown error.
    await model.createIndexes();
  }

  return {
    modelName: model.modelName,
    declaredCount: declared.length,
    missing: missing.map(([key]) => key),
    conflictWarnings,
  };
}

async function main() {
  const ensure = process.argv.includes("--ensure");
  const uri = resolveUri();

  // autoIndex: false on THIS connection only — a dry-run audit must never
  // have a side effect of its own. Every model in this app has schema-level
  // autoIndex: true (a normal app process builds its own indexes on
  // connect), but that means this diagnostic connection could otherwise
  // race to silently rebuild the very index it's trying to report as
  // missing, before this script ever reads the collection's real state —
  // confirmed happening in CI (fast enough there to consistently win the
  // race, unlike this repo's slower local dev Mongo). This override makes
  // "dry-run" genuinely side-effect-free regardless of timing; `--ensure`
  // still explicitly calls createIndexes() itself when needed.
  await mongoose.connect(uri, { autoIndex: false });
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
      for (const w of r.conflictWarnings) {
        console.log(
          `  ! WARNING: ${JSON.stringify(w.key)} is declared unique but ${w.conflicts} conflicting group(s) of duplicate values already exist — creating this index may fail until those are resolved (no document values shown)`,
        );
      }
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
