/**
 * Prepares the test database: verifies it has the shared schema, and gives
 * it the one organization every fixture belongs to.
 *
 * The storefront's tables now live in a database shared with the admin
 * dashboard, so a test database is no longer "this app's tables" — it is a
 * copy of the shared schema with a tenant in it. Fixtures cannot be created
 * without an organization to hang them on: `customers`, `products` and the
 * rest all carry a NOT NULL organization_id with a foreign key.
 *
 *   npm run test:db:setup
 *
 * Idempotent. Refuses any database whose name does not end in _test or _ci,
 * the same guard tests/helpers/testDb.mjs applies before it truncates
 * anything.
 *
 * It does not create the schema. Rebuilding that means copying the
 * dashboard's, which is where those migrations live:
 *
 *   mysqldump --no-data <shared-db> | mysql <this-db>
 *
 * The check below names the tables whose absence means that step is due.
 */
import { query, closePool } from "../config/db.js";

const TEST_DB_NAME_PATTERN = /(_test|_ci)$/i;

/** Fixed so .env.test can name it and re-running never orphans an old one. */
export const TEST_ORGANIZATION_ID = "org_test00000000000000001";
export const TEST_BRANCH_ID = "brn_test00000000000000001";

const RENAMED_TABLES = ["customers", "customer_sessions", "store_settings", "storefront_themes"];

async function main() {
  const name = process.env.DB_NAME || "";
  if (!TEST_DB_NAME_PATTERN.test(name)) {
    console.error(
      `Refusing to touch database "${name}" — its name must end in _test or _ci.\n` +
        "Run this with .env.test loaded (npm run test:db:setup).",
    );
    process.exit(1);
  }

  const present = await query(
    `SELECT table_name AS tableName FROM information_schema.tables
      WHERE table_schema = ? AND table_name IN (?, ?, ?, ?)`,
    [name, ...RENAMED_TABLES],
  );
  const missing = RENAMED_TABLES.filter((t) => !present.some((r) => (r.tableName || r.TABLE_NAME) === t));

  if (missing.length) {
    console.error(
      `\n${name} does not have the shared schema — missing: ${missing.join(", ")}.\n\n` +
        "It is probably still on this app's old standalone schema (users, sessions,\n" +
        "settings, themes). Copy the shared one over it:\n\n" +
        `  mysqldump --no-data <shared-db> | mysql ${name}\n`,
    );
    process.exit(1);
  }

  await query(
    `INSERT INTO organizations (id, name, code, status, created_by_name)
     VALUES (?, 'Test Store', 'TESTSTORE', 'Active', 'setupTestDb.mjs')
     ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status)`,
    [TEST_ORGANIZATION_ID],
  );

  await query(
    `INSERT INTO branches (id, organization_id, name, code, status, created_by_name)
     VALUES (?, ?, 'Main', 'TESTSTORE-MAIN', 'Active', 'setupTestDb.mjs')
     ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status)`,
    [TEST_BRANCH_ID, TEST_ORGANIZATION_ID],
  );

  await query("UPDATE organizations SET primary_branch_id = ? WHERE id = ?", [
    TEST_BRANCH_ID,
    TEST_ORGANIZATION_ID,
  ]);

  console.log(`${name} is ready.`);
  console.log(`  organization ${TEST_ORGANIZATION_ID}`);
  console.log(`  branch       ${TEST_BRANCH_ID}`);
  console.log(`\nSTORE_ORGANIZATION_ID in .env.test must match that organization id.`);
}

try {
  await main();
} finally {
  await closePool();
}
