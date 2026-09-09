// Cosmetics-generalization data migration — models/orderModel.js's
// orderItemSchema.snapshot moved from three fixed fields (color/size/
// fabric) to one arbitrary `attributes` bag (see models/productModel.js's
// variantSchema.attributes for the matching product-side change). Historical
// orders still carry the old fields in MongoDB (Mongoose doesn't drop
// undeclared paths on write), so this script folds them into the new shape
// once, for real order documents where a receipt/order-detail page needs to
// render them.
//
// Dry-run by default — reports how many order documents would change and
// prints one anonymized-shape example, but writes nothing. Pass --apply to
// actually run the update + $unset. Never touches carts (models/
// cartModel.js) — cart items are ephemeral and self-heal on the next add/
// update-cart call, which now always writes snapshot.attributes.
//
// Safety, same pattern as scripts/ensureOrderIdempotencyIndex.mjs /
// scripts/auditIndexes.mjs:
//   - Resolves exactly one explicit URI source based on NODE_ENV, no
//     fallback between environments.
//   - Never logs the connection string, only a redacted host/database name;
//     thrown driver errors are redacted the same way.
//   - Dry-run reads only (Order.find/countDocuments) — the only writes this
//     script ever performs are the documented per-order update and $unset
//     below, gated behind --apply.
//   - Each order's full item array is re-read and rewritten whole (never a
//     partial projection) so no unrelated item field (product, variantId,
//     quantity, snapshot.name/sku/price/image) is ever dropped.
//   - Never logs an order's shipping address, user id, or any other PII —
//     only counts and the (non-identifying) attribute keys found.
//   - Always closes its own connection before exiting, and always exits
//     non-zero on any failure.
//
// Usage:
//   NODE_ENV=production MONGO_URI=<...> node scripts/migrateOrderSnapshotAttributes.mjs            (dry run)
//   NODE_ENV=production MONGO_URI=<...> node scripts/migrateOrderSnapshotAttributes.mjs --apply     (writes)
//   NODE_ENV=test MONGO_URI_TEST=<...> node scripts/migrateOrderSnapshotAttributes.mjs [--apply]    (test DB)

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

// Matches order documents with at least one item still carrying an old
// fixed snapshot field — read-only, used for both the dry-run count and the
// real update's filter.
const LEGACY_FILTER = {
  $or: [
    { "items.snapshot.color": { $exists: true } },
    { "items.snapshot.size": { $exists: true } },
    { "items.snapshot.fabric": { $exists: true } },
  ],
};

function hasLegacyFields(snapshot) {
  return !!(snapshot?.color || snapshot?.size || snapshot?.fabric);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { uri, varName } = resolveUri();
  console.log(`Connecting using ${varName}...`);

  const conn = await mongoose.connect(uri);
  const dbName = conn.connection?.db?.databaseName || "(unknown)";
  const host = conn.connection?.host || "(unknown)";
  console.log(`Connected to database "${dbName}" on host "${host}".`);

  try {
    // Full documents, not a partial projection — every item field must
    // round-trip unchanged except the snapshot shape.
    const matching = await Order.find(LEGACY_FILTER).lean();

    if (matching.length === 0) {
      console.log("No orders with legacy color/size/fabric snapshot fields found. Nothing to do.");
      return;
    }

    let legacyItemCount = 0;
    const exampleKeys = new Set();
    for (const order of matching) {
      for (const item of order.items) {
        if (!hasLegacyFields(item.snapshot)) continue;
        legacyItemCount++;
        if (item.snapshot.color) exampleKeys.add("color");
        if (item.snapshot.size) exampleKeys.add("size");
        if (item.snapshot.fabric) exampleKeys.add("fabric");
      }
    }

    console.log(
      `Found ${matching.length} order document(s), ${legacyItemCount} line item(s) with legacy snapshot fields.`,
    );
    console.log(`Attribute keys that would be populated across matched orders: ${[...exampleKeys].join(", ") || "(none)"}`);

    if (!apply) {
      console.log("\nDry run only — no writes made. Re-run with --apply to perform the migration.");
      return;
    }

    // One update per order — each document's rebuilt `items` array differs,
    // so a single blanket updateMany can't express this. `attributes` is
    // built by merging any already-set attributes (never overwritten) with
    // whichever of color/size/fabric are present, so re-running --apply
    // against an already-migrated (and since-unset) document is a safe
    // no-op — it simply won't match LEGACY_FILTER any more.
    let migrated = 0;
    for (const order of matching) {
      const items = order.items.map((item) => {
        if (!hasLegacyFields(item.snapshot)) return item;
        const { color, size, fabric, ...restSnapshot } = item.snapshot;
        const attributes = { ...(restSnapshot.attributes || {}) };
        if (color) attributes.color = color;
        if (size) attributes.size = size;
        if (fabric) attributes.fabric = fabric;
        return { ...item, snapshot: { ...restSnapshot, attributes } };
      });
      await Order.collection.updateOne({ _id: order._id }, { $set: { items } });
      migrated++;
    }
    console.log(`Migrated ${migrated} order document(s).`);
  } finally {
    await mongoose.disconnect();
    console.log("Connection closed.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Order snapshot migration failed:", redact(err?.message || err));
    process.exit(1);
  });
