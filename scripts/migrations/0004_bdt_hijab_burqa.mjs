// BDT-only currency migration, phase 2 — migrates the two products
// deliberately excluded from 0003_bdt_price_currency.mjs, per explicit
// user decisions (see docs/CURRENCY_MIGRATION_PLAN.md and
// docs/CATALOG_REPAIR_PROPOSAL.md for the full audit trail):
//
//   - Hijab: 5000 is the correct value, but it was always meant to be BDT,
//     not USD (a unit mistake, not a wrong amount). The newer product
//     record (valid category, 3 color variants, no order history) becomes
//     the canonical, active listing at this price; the older record
//     (2 real historical orders, dangling category, currently the one
//     holding the true 5000 value) is archived — same "keep the record
//     with the currently-valid category/variant-set active, archive the
//     other, never touch order-history snapshot rows" pattern already
//     used for the Jeans and Burqa duplicate pairs.
//   - Burqa: base_price/discount_price (65/55) migrate exactly like the
//     13 rows in 0003 (a plausible, ordinary USD pair, ×120). The Navy/
//     Nida variant's price=4000 is a SEPARATE decision: treated as
//     already-BDT (a plausible real retail price), so it is NOT
//     multiplied — only the product's own price_currency flag changes,
//     which is what makes services/orderService.js's chargePrice() stop
//     treating this variant's stored number as USD.
//
// Order history is never touched — order_items store independent snapshot
// columns (name/sku/price/attributes), never a live join back to
// products/product_variants (confirmed in the original catalog audit).
const RATE = 120;

const BURQA_PRODUCT_ID = "6a98b4cc1dff0db712d98f47";
const BURQA_BASE_USD = 65;
const BURQA_DISCOUNT_USD = 55;

const HIJAB_OLDER_ID = "6a98b4cc1dff0db712d98f4a"; // to be archived
const HIJAB_OLDER_VARIANT_ID = "6aa66c651e5c837a2bd4c62f";
const HIJAB_OLDER_VARIANT_SKU = "HIJ-INS-BLK-FS";

const HIJAB_NEWER_ID = "6aabced3435ad98399f6ffb3"; // becomes canonical, active
const HIJAB_NEWER_BASE_BEFORE = 18; // sanity check only — being overridden, not converted
const HIJAB_DECIDED_BDT_PRICE = 5000;

const migration = {
  id: "0004_bdt_hijab_burqa",
  description: "Migrate Burqa (65/55 -> BDT) and merge/migrate Hijab (5000 BDT, newer record canonical) per explicit user decisions",
  async up(conn) {
    // ---------- Burqa ----------
    const [burqaRows] = await conn.query(
      "SELECT base_price, discount_price, price_currency FROM products WHERE id = ?",
      [BURQA_PRODUCT_ID],
    );
    if (!burqaRows.length) throw new Error(`Burqa product ${BURQA_PRODUCT_ID} not found`);
    const burqa = burqaRows[0];
    if (burqa.price_currency !== "BDT") {
      if (Number(burqa.base_price) !== BURQA_BASE_USD || Number(burqa.discount_price) !== BURQA_DISCOUNT_USD) {
        throw new Error(
          `Burqa's current price (base=${burqa.base_price}, discount=${burqa.discount_price}) no longer matches ` +
            `the audited value (base=${BURQA_BASE_USD}, discount=${BURQA_DISCOUNT_USD}) — refusing to convert. Re-audit before re-running.`,
        );
      }
      await conn.query(
        "UPDATE products SET base_price = ?, discount_price = ?, price_currency = 'BDT' WHERE id = ?",
        [BURQA_BASE_USD * RATE, BURQA_DISCOUNT_USD * RATE, BURQA_PRODUCT_ID],
      );
      // The Navy/Nida variant's price (4000) is deliberately NOT modified —
      // it was already decided to be a real BDT value. Flipping the
      // product's price_currency to 'BDT' above is what makes
      // chargePrice() stop treating this stored number as USD.
    }

    // ---------- Hijab ----------
    const [hijabRows] = await conn.query(
      "SELECT id, base_price, price_currency, is_active FROM products WHERE id IN (?, ?)",
      [HIJAB_OLDER_ID, HIJAB_NEWER_ID],
    );
    const older = hijabRows.find((r) => r.id === HIJAB_OLDER_ID);
    const newer = hijabRows.find((r) => r.id === HIJAB_NEWER_ID);
    if (!older || !newer) throw new Error("Hijab older/newer product not found — refusing to proceed with a partial migration");

    if (newer.price_currency !== "BDT" || Number(newer.base_price) !== HIJAB_DECIDED_BDT_PRICE) {
      if (older.price_currency !== "BDT" && Number(newer.base_price) !== HIJAB_NEWER_BASE_BEFORE) {
        throw new Error(
          `Hijab newer record's base_price (${newer.base_price}) no longer matches the audited pre-migration ` +
            `value (${HIJAB_NEWER_BASE_BEFORE}) — refusing to convert. Re-audit before re-running.`,
        );
      }
      // Newer record becomes canonical: decided price, already-correct
      // category and 3-color variant set are left untouched.
      await conn.query(
        "UPDATE products SET base_price = ?, price_currency = 'BDT' WHERE id = ?",
        [HIJAB_DECIDED_BDT_PRICE, HIJAB_NEWER_ID],
      );
    }

    if (older.is_active) {
      // Archive the older record (2 real historical orders reference it by
      // id, but only via independent snapshot columns — never live-joined,
      // see this file's header comment — so archiving it cannot alter any
      // existing order's displayed history).
      await conn.query("UPDATE products SET is_active = 0, price_currency = 'BDT' WHERE id = ?", [HIJAB_OLDER_ID]);
    }

    const [olderVariantRows] = await conn.query("SELECT sku FROM product_variants WHERE id = ?", [HIJAB_OLDER_VARIANT_ID]);
    if (!olderVariantRows.length) throw new Error(`Hijab older variant ${HIJAB_OLDER_VARIANT_ID} not found`);
    if (olderVariantRows[0].sku === HIJAB_OLDER_VARIANT_SKU) {
      // Frees the canonical "HIJ-INS-BLK-FS" SKU currently shared with the
      // newer (surviving) record's own Black variant — same archived-SKU
      // pattern used for the Jeans/Burqa duplicate pairs.
      await conn.query(
        "UPDATE product_variants SET sku = CONCAT(sku, '-ARCHIVED-', SUBSTRING(id, -6)) WHERE id = ?",
        [HIJAB_OLDER_VARIANT_ID],
      );
    }
  },
};

export default migration;
