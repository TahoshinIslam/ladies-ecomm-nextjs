// Targeted, narrow backfill for a real data-fidelity gap found during
// post-migration validation: scripts/migrateMongoToMysql.mjs's order/cart
// migration originally read `snapshot.attributes` directly, which is
// empty/absent on any Mongo document written before the cosmetics-
// generalization change (those instead carry `snapshot.color`/`size`/
// `fabric` as separate legacy fields — see that script's own
// resolveSnapshotAttributes(), added alongside this backfill). Every
// order_items row already migrated under the OLD logic is stuck with
// `snapshot_attributes = '{}'`, even though the real color/size/fabric the
// customer ordered is sitting right there in the Mongo source, read-only.
//
// This script does NOT touch anything except order_items.snapshot_attributes,
// and ONLY rows that are currently empty ('{}') — every other column, every
// other table, and every already-correct row is left untouched. Read-only
// against Mongo (MONGO_MIGRATION_URI); Mongo is never written to.
//
// Modes:
//   node --env-file=.env scripts/backfillOrderSnapshotAttributes.mjs            (dry-run — reports what WOULD change)
//   node --env-file=.env scripts/backfillOrderSnapshotAttributes.mjs --apply    (writes)
//
// Safe to re-run: once applied, the affected rows no longer match the
// `snapshot_attributes = '{}'` selection criterion, so a second run finds
// nothing left to do.

import { MongoClient, ObjectId } from "mongodb";

import connectDB, { query, closePool } from "../config/db.js";
import { resolveSnapshotAttributes } from "../lib/legacySnapshotAttributes.js";

const APPLY = process.argv.includes("--apply");

function resolveLegacyAttributes(snapshot) {
  const resolved = resolveSnapshotAttributes(snapshot);
  return Object.keys(resolved).length ? resolved : null;
}

async function main() {
  const mongoUri = process.env.MONGO_MIGRATION_URI;
  if (!mongoUri) throw new Error("MONGO_MIGRATION_URI is not set — nothing to read the original snapshot data from.");

  await connectDB();
  const emptyRows = await query(
    "SELECT order_id, position, product_id, variant_id FROM order_items WHERE snapshot_attributes = '{}' ORDER BY order_id, position",
  );

  if (!emptyRows.length) {
    console.log("No order_items rows with an empty snapshot_attributes — nothing to do.");
    await closePool();
    return;
  }

  console.log(`Found ${emptyRows.length} order_items row(s) with empty snapshot_attributes. Checking Mongo source...`);

  const mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  const db = mongoClient.db();

  let resolved = 0;
  let skipped = 0;
  for (const row of emptyRows) {
    const order = await db.collection("orders").findOne({ _id: toObjectIdIfValid(row.order_id) });
    const item = order?.items?.find(
      (it) => String(it.product) === row.product_id && String(it.variantId) === row.variant_id,
    );
    const legacy = resolveLegacyAttributes(item?.snapshot);
    if (!legacy) {
      skipped++;
      console.log(`  skip order ${row.order_id} pos ${row.position} — no legacy color/size/fabric found in Mongo source either (genuinely no attributes to backfill)`);
      continue;
    }
    resolved++;
    console.log(`  ${APPLY ? "UPDATE" : "would update"} order ${row.order_id} pos ${row.position}: ${JSON.stringify(legacy)}`);
    if (APPLY) {
      await query("UPDATE order_items SET snapshot_attributes = ? WHERE order_id = ? AND position = ?", [
        JSON.stringify(legacy),
        row.order_id,
        row.position,
      ]);
    }
  }

  await mongoClient.close();
  await closePool();

  console.log(`\n${APPLY ? "Applied" : "Dry run only — re-run with --apply to write"}: ${resolved} row(s) resolved, ${skipped} row(s) had nothing to backfill.`);
}

function toObjectIdIfValid(hex) {
  // The mongodb driver's findOne({_id: <24-hex-string>}) requires a real
  // ObjectId instance, not a bare string, to match.
  return ObjectId.isValid(hex) ? new ObjectId(hex) : hex;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
