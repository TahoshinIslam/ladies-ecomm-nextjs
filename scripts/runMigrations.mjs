// Versioned, idempotent ALTER-style migration runner for the live MySQL/
// MariaDB database — distinct from sql/schema.sql's CREATE TABLE IF NOT
// EXISTS bootstrap, which only ever creates tables that don't exist yet
// and never alters an existing table's columns/indexes (confirmed audit
// point: "do not assume editing CREATE TABLE IF NOT EXISTS updates
// existing tables" — it doesn't; MySQL simply no-ops the whole statement
// if the table is already there, constraint changes and all).
//
// Tracks applied migrations in a `schema_migrations` table (id, applied_at)
// so this script is safe to run repeatedly and only ever applies each
// migration once, in order. Each migration module in scripts/migrations/
// exports { id, description, up(conn) }. A migration that cannot safely
// apply (e.g. existing data would violate a new constraint) must throw a
// clear, actionable error and leave the schema untouched — never silently
// skip, never auto-repair data itself.
//
// Usage: node --env-file=.env scripts/runMigrations.mjs
//        node --env-file=.env.test scripts/runMigrations.mjs   (test DB)

import { withConnection, closePool } from "../config/db.js";
import { checkTestDbConfig, KNOWN_NON_TEST_DB_NAMES } from "../lib/testDbSafety.js";

async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(64) PRIMARY KEY,
      description VARCHAR(255) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function alreadyApplied(conn, id) {
  const [rows] = await conn.query("SELECT id FROM schema_migrations WHERE id = ?", [id]);
  return rows.length > 0;
}

async function main() {
  // This script runs real ALTER TABLE / CREATE TABLE statements against
  // whatever DB_NAME the current environment points at — deliberately NOT
  // restricted to the test DB (production/dev need these migrations too),
  // but it prints which database it's about to touch and, for the one
  // known real application database name, requires an explicit
  // confirmation flag so this is never run against it by accident.
  const dbName = process.env.DB_NAME;
  if (KNOWN_NON_TEST_DB_NAMES.includes(dbName) && process.env.CONFIRM_MIGRATE_PRODUCTION !== "true") {
    throw new Error(
      `DB_NAME="${dbName}" is the real application database. Re-run with CONFIRM_MIGRATE_PRODUCTION=true once you've reviewed what each pending migration does (see scripts/migrations/) and taken a backup.`,
    );
  }
  console.log(`Running migrations against database "${dbName}" on host "${process.env.DB_HOST}".`);
  // Not a safety gate (this script legitimately targets non-test DBs too)
  // — just an informational label so migration output is unambiguous
  // about which kind of database it ran against.
  const isTestDb = checkTestDbConfig({ dbName, host: process.env.DB_HOST, allowRemoteHost: true }).ok;
  console.log(isTestDb ? "(recognized as a test database)" : "(NOT a recognized test database name)");

  const modules = await Promise.all([
    import("./migrations/0001_review_helpful_votes.mjs"),
    import("./migrations/0002_product_variants_sku_unique.mjs"),
    import("./migrations/0003_bdt_price_currency.mjs"),
    import("./migrations/0004_bdt_hijab_burqa.mjs"),
    import("./migrations/0005_bdt_default_currency.mjs"),
    import("./migrations/0006_image_framing.mjs"),
    import("./migrations/0007_repair_variant_attribute_assignments.mjs"),
    import("./migrations/0008_deleted_products_log.mjs"),
  ]);
  const migrations = modules.map((m) => m.default);

  await withConnection(async (conn) => {
    await ensureMigrationsTable(conn);
    for (const migration of migrations) {
      if (await alreadyApplied(conn, migration.id)) {
        console.log(`[skip] ${migration.id} — already applied`);
        continue;
      }
      console.log(`[run]  ${migration.id} — ${migration.description}`);
      await migration.up(conn);
      await conn.query("INSERT INTO schema_migrations (id, description) VALUES (?, ?)", [migration.id, migration.description]);
      console.log(`[done] ${migration.id}`);
    }
  });
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Migration failed:", err.message);
    await closePool().catch(() => {});
    process.exit(1);
  });
