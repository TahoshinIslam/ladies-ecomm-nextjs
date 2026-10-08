// Strengthens the backup/restore drill beyond "a marker row and a table
// count" (a confirmed gap in the first drill this audit ran): compares
// EXACT row counts for every table between the source database and a
// restored database, and verifies the restored schema still carries the
// key constraints this app depends on for correctness (SKU uniqueness,
// session token uniqueness) — not just that the tables exist.
//
// Usage:
//   node --env-file=.env.test scripts/verifyRestoreDrill.mjs <sourceDbName> <restoredDbName>

import mysql from "mysql2/promise";

async function tableNames(conn) {
  const [rows] = await conn.query("SHOW TABLES");
  return rows.map((r) => Object.values(r)[0]).sort();
}

async function rowCount(conn, table) {
  const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
  return n;
}

async function uniqueConstraintExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT non_unique FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, indexName],
  );
  return rows.length > 0 && rows[0].non_unique === 0;
}

async function connect(database) {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database,
  });
}

async function main() {
  const [, , sourceDb, restoredDb] = process.argv;
  if (!sourceDb || !restoredDb) {
    throw new Error("Usage: node scripts/verifyRestoreDrill.mjs <sourceDbName> <restoredDbName>");
  }

  const source = await connect(sourceDb);
  const restored = await connect(restoredDb);

  const failures = [];

  const sourceTables = await tableNames(source);
  const restoredTables = await tableNames(restored);
  if (JSON.stringify(sourceTables) !== JSON.stringify(restoredTables)) {
    failures.push(`Table list mismatch:\n  source:   ${sourceTables.join(", ")}\n  restored: ${restoredTables.join(", ")}`);
  }

  console.log(`Comparing row counts across ${sourceTables.length} tables...`);
  for (const table of sourceTables) {
    const sourceCount = await rowCount(source, table);
    const restoredCount = await rowCount(restored, table);
    if (sourceCount !== restoredCount) {
      failures.push(`Row count mismatch in "${table}": source=${sourceCount}, restored=${restoredCount}`);
    } else {
      console.log(`  ✓ ${table}: ${sourceCount} rows (match)`);
    }
  }

  console.log("Verifying key constraints survived the restore...");
  const constraintChecks = [
    ["product_variants", "uq_product_variants_sku"],
    ["sessions", "uq_sessions_token_hash"],
    ["reviews", "uq_reviews_user_product"],
    ["orders", "uq_orders_customer_idempotency"],
    ["payments", "uq_payments_order"],
  ];
  for (const [table, indexName] of constraintChecks) {
    const inSource = await uniqueConstraintExists(source, table, indexName);
    const inRestored = await uniqueConstraintExists(restored, table, indexName);
    if (inSource !== inRestored) {
      failures.push(`Constraint "${indexName}" on "${table}": present in source=${inSource}, present in restored=${inRestored}`);
    } else {
      console.log(`  ✓ ${indexName} on ${table}: ${inSource ? "present" : "absent"} in both (match)`);
    }
  }

  await source.end();
  await restored.end();

  if (failures.length) {
    console.error("\n✖ Restore drill verification FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log("\n✓ Restore drill fully verified: identical table set, identical row counts per table, identical key constraints.");
}

main().catch((err) => {
  console.error("[verifyRestoreDrill] failed:", err.message || err);
  process.exitCode = 1;
});
