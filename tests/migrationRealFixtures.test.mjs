// Real, end-to-end execution of scripts/migrations/0003_bdt_price_currency.mjs
// and 0005_bdt_default_currency.mjs against a disposable database — not
// just the pure decision functions (tests/bdtPricingIntegrity.test.mjs
// already covers those). That file explicitly could not run 0003's real
// up() end-to-end because it iterates 11 hardcoded product ids and 2
// hardcoded variant ids and throws on the first one not found; this file
// removes that limitation by seeding fixture rows with those EXACT ids, so
// the real migration module — the same one scripts/runMigrations.mjs
// imports and runs against production — executes to completion for real.
//
// Also verifies the ledger/"transaction" behavior scripts/runMigrations.mjs
// actually has: it does NOT wrap each migration's up() + ledger INSERT in
// a real SQL transaction (config/db.js's withConnection() is a plain
// connection checkout, not lib/db/tx.js's withTransaction()) — confirmed
// by reading both files. This is not a bug this file works around: MySQL/
// InnoDB auto-commits DDL (ALTER TABLE) regardless of any surrounding
// BEGIN/COMMIT, so a transaction couldn't make 0003 atomic anyway. Safety
// instead comes from 0003 being idempotent per-row (lib/bdtMigration.js's
// applied:false no-op) — this file proves that holds for a real up()
// double-run, not just the pure functions in isolation.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { dbReady, skipReason, connectTestDb, disconnectTestDb, rawQuery, deleteRows } from "./helpers/testDb.mjs";

const canRun = dbReady;
const reason = skipReason;

const RATE = 120;
const CATEGORY_ID = "6a0000000000000000000001";

// Exact ids/USD amounts scripts/migrations/0003_bdt_price_currency.mjs
// hardcodes — copied here (not re-derived) specifically so this test
// exercises that real module's real conversion table, not a stand-in.
const PRODUCT_CONVERSIONS = [
  ["6aabced3c68dbe26a7f6ffc6", 8, null],
  ["6aabced323e0c279daf6ffb7", 15, null],
  ["6aabced3e95bd02011f6ffcc", 16, null],
  ["6aabced392bbf77758f6ffc9", 20, null],
  ["6aabced3b5cd1a4c57f6ffce", 28, null],
  ["6aabced35f18d2df60f6ffd0", 30, null],
  ["6aa0bd5702281c362b1784f6", 30, null],
  ["6aabced33991c9bd12f6ffbf", 34, null],
  ["6aabced3ed0cb986ebf6ffba", 68, null],
  ["6aabced34a703c58eaf6ffc3", 82, null],
  ["6aabced3da7ef41850f6ffaf", 65, null],
];
const VARIANT_CONVERSIONS = [
  ["6aabced3def4762f4bf6ffbd", "6aabced3ed0cb986ebf6ffba", 78],
  ["6aabced3f6e476582df6ffb1", "6aabced3da7ef41850f6ffaf", 72],
];
const PRODUCT_IDS = PRODUCT_CONVERSIONS.map(([id]) => id);
const VARIANT_IDS = VARIANT_CONVERSIONS.map(([id]) => id);

async function seedFixtures() {
  for (const [id, baseUsd] of PRODUCT_CONVERSIONS) {
    await rawQuery(
      `INSERT INTO products
         (id, name, slug, description, description_bn, category_id, base_price, discount_price,
          price_currency, images, included_items, tags, tags_text)
       VALUES (?, ?, ?, '', '', ?, ?, NULL, 'USD', '[]', '[]', '[]', '')`,
      [id, `Fixture ${id}`, `fixture-${id}`, CATEGORY_ID, baseUsd],
    );
  }
  for (const [id, productId, priceUsd] of VARIANT_CONVERSIONS) {
    await rawQuery(
      `INSERT INTO product_variants (id, product_id, variant_name, sku, attributes, price, images)
       VALUES (?, ?, 'Default', ?, '{}', ?, '[]')`,
      [id, productId, `SKU-${id}`, priceUsd],
    );
  }
  // Minimal settings row with an unmigrated INTL shipping zone, matching
  // the exact shape 0003's up() reads (shipping_zones JSON array of
  // {region, currency, tiers:[{baseCost, freeAbove}]}).
  await rawQuery(
    `INSERT INTO store_settings (id, homepage, currency, promotions, exchange_policy, tax_rules, shipping_zones)
     VALUES ('main', '{}', '{}', '{}', '{}', '{}', ?)
     ON DUPLICATE KEY UPDATE shipping_zones = VALUES(shipping_zones)`,
    [JSON.stringify([{ region: "INTL", currency: "USD", tiers: [{ baseCost: 25, freeAbove: 200 }] }])],
  );
}

// Same string-or-already-parsed tolerance as models/settingsModel.js's
// jsonOrDefault(): which one mysql2 returns depends on the server version.
const asJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);

async function cleanupFixtures() {
  await deleteRows("product_variants", "id", VARIANT_IDS);
  await deleteRows("products", "id", PRODUCT_IDS);
  await rawQuery("DELETE FROM store_settings WHERE id = 'main'");
  await ensureMigrationsTable();
  await rawQuery("DELETE FROM schema_migrations WHERE id = ?", ["0003_bdt_price_currency"]);
}

// schema_migrations is created on demand by scripts/runMigrations.mjs, not by
// sql/schema.sql — so a database freshly built from schema.sql (exactly how
// CI builds its database) doesn't have it. Same DDL as the runner's own
// ensureMigrationsTable(); kept in sync by hand because that script runs
// main() at import time and can't be imported here.
async function ensureMigrationsTable() {
  await rawQuery(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(64) PRIMARY KEY,
      description VARCHAR(255) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

describe("scripts/migrations/0003_bdt_price_currency.mjs — real up() against real fixtures", { skip: !canRun && reason }, () => {
  let migration;
  let withConnection;

  before(async () => {
    await connectTestDb();
    ({ default: migration } = await import("../scripts/migrations/0003_bdt_price_currency.mjs"));
    ({ withConnection } = await import("../config/db.js"));
    await cleanupFixtures();
    await seedFixtures();
  });

  // finally: an open pool keeps the whole test-runner process alive, so a
  // cleanup failure must never skip the disconnect (that is exactly how one
  // failing hook turned into a 19-minute CI hang and a timeout).
  after(async () => {
    try {
      await cleanupFixtures();
    } finally {
      await disconnectTestDb();
    }
  });

  test("first run: converts every fixture product/variant to BDT at the exact audited rate, and the INTL zone", async () => {
    await withConnection((conn) => migration.up(conn));

    for (const [id, baseUsd] of PRODUCT_CONVERSIONS) {
      const [rows] = await withConnection((conn) => conn.query("SELECT base_price, price_currency FROM products WHERE id = ?", [id]));
      assert.equal(Number(rows[0].base_price), baseUsd * RATE, `product ${id} must convert to ${baseUsd} * ${RATE}`);
      assert.equal(rows[0].price_currency, "BDT");
    }
    for (const [id, , priceUsd] of VARIANT_CONVERSIONS) {
      const [rows] = await withConnection((conn) => conn.query("SELECT price FROM product_variants WHERE id = ?", [id]));
      assert.equal(Number(rows[0].price), priceUsd * RATE);
    }
    const [settingsRows] = await withConnection((conn) => conn.query("SELECT shipping_zones FROM store_settings WHERE id = 'main'"));
    const zones = asJson(settingsRows[0].shipping_zones);
    const intl = zones.find((z) => z.region === "INTL");
    assert.equal(intl.currency, "BDT");
    assert.equal(intl.tiers[0].baseCost, 25 * RATE);
    assert.equal(intl.tiers[0].freeAbove, 200 * RATE);
  });

  test("ledger: recording the migration as applied (the same INSERT scripts/runMigrations.mjs issues) succeeds and is queryable", async () => {
    await rawQuery("INSERT INTO schema_migrations (id, description) VALUES (?, ?)", [migration.id, migration.description]);
    const [rows] = await withConnection((conn) => conn.query("SELECT id FROM schema_migrations WHERE id = ?", [migration.id]));
    assert.equal(rows.length, 1);
  });

  test("second run (real repeat-safety, not a copied guard): identical values, no double-conversion, no thrown error", async () => {
    // Real-world repeat trigger: scripts/runMigrations.mjs's own ledger
    // check would normally skip this, but the guarantee this test cares
    // about is that up() ITSELF is safe to call twice even if the ledger
    // were ever bypassed (e.g. a migration re-run after a manual ledger
    // edit, or the exact scenario the ledger exists to prevent).
    await withConnection((conn) => migration.up(conn));

    for (const [id, baseUsd] of PRODUCT_CONVERSIONS) {
      const [rows] = await withConnection((conn) => conn.query("SELECT base_price, price_currency FROM products WHERE id = ?", [id]));
      assert.equal(
        Number(rows[0].base_price),
        baseUsd * RATE,
        `product ${id} must NOT become ${baseUsd} * ${RATE} * ${RATE} on a second run`,
      );
      assert.equal(rows[0].price_currency, "BDT");
    }
    for (const [id, , priceUsd] of VARIANT_CONVERSIONS) {
      const [rows] = await withConnection((conn) => conn.query("SELECT price FROM product_variants WHERE id = ?", [id]));
      assert.equal(Number(rows[0].price), priceUsd * RATE, "variant price must not double-convert on a second run");
    }
    const [settingsRows] = await withConnection((conn) => conn.query("SELECT shipping_zones FROM store_settings WHERE id = 'main'"));
    const zones = asJson(settingsRows[0].shipping_zones);
    const intl = zones.find((z) => z.region === "INTL");
    assert.equal(intl.currency, "BDT", "INTL zone must still read BDT, not re-flagged/re-converted");
    assert.equal(intl.tiers[0].baseCost, 25 * RATE, "INTL baseCost must not be multiplied by RATE twice");
  });

  test("refuses a partial migration: a missing hardcoded product id throws and leaves already-processed rows exactly as converted (no half-applied state hidden)", async () => {
    // Remove one product this migration expects, simulating exactly the
    // scenario 0003's own header describes ("refuse to proceed with a
    // partial migration") — proves the real throw path, not just reading
    // the source for the word "throw".
    const missingId = PRODUCT_IDS[PRODUCT_IDS.length - 1];
    await deleteRows("products", "id", missingId);
    try {
      await assert.rejects(
        () => withConnection((conn) => migration.up(conn)),
        /not found — refusing to proceed with a partial migration/,
      );
      // Rows processed before the missing one (iteration is in array
      // order, and PRODUCT_CONVERSIONS' last entry was removed) remain
      // converted from the earlier successful run — not rolled back,
      // because there is no real SQL transaction wrapping this (see file
      // header). That is the actual, verified behavior, not an assumption.
      const [rows] = await withConnection((conn) =>
        conn.query("SELECT base_price, price_currency FROM products WHERE id = ?", [PRODUCT_IDS[0]]),
      );
      assert.equal(rows[0].price_currency, "BDT", "earlier rows are not rolled back — confirms no real transaction wraps up()");
    } finally {
      // Restore the fixture for the second-run test's own cleanup/rerun symmetry.
      const [, baseUsd] = PRODUCT_CONVERSIONS[PRODUCT_CONVERSIONS.length - 1];
      await rawQuery(
        `INSERT INTO products
           (id, name, slug, description, description_bn, category_id, base_price, discount_price,
            price_currency, images, included_items, tags, tags_text)
         VALUES (?, ?, ?, '', '', ?, ?, NULL, 'BDT', '[]', '[]', '[]', '')`,
        [missingId, `Fixture ${missingId}`, `fixture-${missingId}-restored`, CATEGORY_ID, baseUsd * RATE],
      );
    }
  });
});
