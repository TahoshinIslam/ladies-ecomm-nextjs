// BDT-only currency migration, phase 1 — see docs/CURRENCY_MIGRATION_PLAN.md
// for the full audit this executes. Adds the transitional `price_currency`
// column (see sql/schema.sql's comment) and converts exactly the 13
// products/variants confirmed USD-denominated and approved for conversion.
//
// Deliberately excludes Hijab (6a98b4cc1dff0db712d98f4a, base_price=5000)
// and Burqa (6a98b4cc1dff0db712d98f47, base_price=65/discount=55, and its
// variant 6aa5d102f94acdc8bb8c483c price=4000) — both remain
// price_currency='BDT'... no: remain 'USD' (unconverted, unresolved),
// per explicit instruction not to touch their prices this pass. They will
// migrate in a follow-up once their price/currency question is resolved.
//
// Every conversion below is `current_value * RATE` (120, this database's
// live settings.currency.usdToBdt at the time of this migration) applied
// exactly once, to exactly the column named — never applied twice, never
// applied to a row already marked 'BDT'.
const RATE = 120;

// [productId, baseUsd, discountUsd|null] — every product-level conversion.
const PRODUCT_CONVERSIONS = [
  ["6aabced3c68dbe26a7f6ffc6", 8, null],
  ["6aabced323e0c279daf6ffb7", 15, null],
  ["6aabced3e95bd02011f6ffcc", 16, null],
  ["6aabced392bbf77758f6ffc9", 20, null],
  ["6aabced3b5cd1a4c57f6ffce", 28, null],
  ["6aabced35f18d2df60f6ffd0", 30, null], // Straight Jeans, active (repaired listing)
  ["6aa0bd5702281c362b1784f6", 30, null], // Straight Jeans, archived
  ["6aabced33991c9bd12f6ffbf", 34, null],
  ["6aabced3ed0cb986ebf6ffba", 68, null], // Open-Front Nida Abaya
  ["6aabced34a703c58eaf6ffc3", 82, null],
  ["6aabced3da7ef41850f6ffaf", 65, null], // Saudi-Style Burqa, ARCHIVED duplicate (distinct from the active, excluded Burqa)
];

// [variantId, priceUsd] — variant-level price overrides to convert.
// Both belong to products already in PRODUCT_CONVERSIONS above.
const VARIANT_CONVERSIONS = [
  ["6aabced3def4762f4bf6ffbd", 78], // Open-Front Nida Abaya, Black/3XL/Nida
  ["6aabced3f6e476582df6ffb1", 72], // Saudi-Style Burqa (archived dup), Black/FS/Crepe
];

async function ensurePriceCurrencyColumn(conn) {
  const [cols] = await conn.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'price_currency'`,
  );
  if (cols[0].n > 0) return;
  await conn.query(
    `ALTER TABLE products ADD COLUMN price_currency ENUM('USD','BDT') NOT NULL DEFAULT 'USD'`,
  );
}

const migration = {
  id: "0003_bdt_price_currency",
  description: "Add products.price_currency and convert the 13 approved USD-denominated rows to native BDT",
  async up(conn) {
    await ensurePriceCurrencyColumn(conn);

    for (const [productId, baseUsd, discountUsd] of PRODUCT_CONVERSIONS) {
      const [rows] = await conn.query(
        "SELECT base_price, discount_price, price_currency FROM products WHERE id = ?",
        [productId],
      );
      if (!rows.length) throw new Error(`Product ${productId} not found — refusing to proceed with a partial migration`);
      const row = rows[0];
      if (row.price_currency === "BDT") continue; // already migrated, idempotent re-run
      if (Number(row.base_price) !== baseUsd || (discountUsd == null ? row.discount_price != null : Number(row.discount_price) !== discountUsd)) {
        throw new Error(
          `Product ${productId}'s current price (base=${row.base_price}, discount=${row.discount_price}) ` +
            `no longer matches the audited value (base=${baseUsd}, discount=${discountUsd}) this migration expects — ` +
            `refusing to convert stale/unexpected data. Re-audit before re-running.`,
        );
      }
      const newDiscount = discountUsd == null ? null : discountUsd * RATE;
      await conn.query(
        "UPDATE products SET base_price = ?, discount_price = ?, price_currency = 'BDT' WHERE id = ?",
        [baseUsd * RATE, newDiscount, productId],
      );
    }

    for (const [variantId, priceUsd] of VARIANT_CONVERSIONS) {
      const [rows] = await conn.query("SELECT price FROM product_variants WHERE id = ?", [variantId]);
      if (!rows.length) throw new Error(`Variant ${variantId} not found — refusing to proceed with a partial migration`);
      if (Number(rows[0].price) !== priceUsd) {
        throw new Error(
          `Variant ${variantId}'s current price (${rows[0].price}) no longer matches the audited value (${priceUsd}) — ` +
            `refusing to convert. Re-audit before re-running.`,
        );
      }
      await conn.query("UPDATE product_variants SET price = ? WHERE id = ?", [priceUsd * RATE, variantId]);
    }

    // "Remove USD conversion from the active pricing flow" also applies to
    // the INTL shipping zone (settings.shippingZones) — its tier was still
    // USD-denominated (baseCost=25, freeAbove=200) and, now that
    // services/orderService.js's chargePrice() always charges BDT
    // regardless of shipping region, would otherwise silently charge only
    // ৳25 for international shipping instead of the intended $25-equivalent.
    // Zero historical orders have ever used this zone (confirmed via a
    // live query before this migration was written), so there is no order
    // history to reconcile here — only the live settings row.
    const [settingsRows] = await conn.query("SELECT shipping_zones FROM settings WHERE id = 'main'");
    if (settingsRows.length) {
      const zones = JSON.parse(settingsRows[0].shipping_zones);
      let changed = false;
      for (const zone of zones) {
        if (zone.region !== "INTL") continue;
        if (zone.currency === "BDT") continue; // already migrated
        zone.currency = "BDT";
        for (const tier of zone.tiers) {
          tier.baseCost = tier.baseCost * RATE;
          if (tier.freeAbove) tier.freeAbove = tier.freeAbove * RATE;
        }
        changed = true;
      }
      if (changed) {
        await conn.query("UPDATE settings SET shipping_zones = ? WHERE id = 'main'", [JSON.stringify(zones)]);
      }
    }
  },
};

export default migration;
