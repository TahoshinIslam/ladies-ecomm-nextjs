// BDT-only currency migration, cleanup — confirmed live gap: every
// existing product was migrated to price_currency='BDT'
// (0003_bdt_price_currency.mjs / 0004_bdt_hijab_burqa.mjs), but the
// column's own DEFAULT was left at 'USD' (the pre-migration default,
// deliberately preserved during the transition so un-migrated rows kept
// their old behavior). Left unfixed, any product created from now on
// would silently default to 'USD' and get wrongly multiplied by the
// exchange rate at checkout/display, despite the store being BDT-only
// and the admin form having no currency field to override it. This
// flips the column's default only — never touches any existing row's
// value.
const migration = {
  id: "0005_bdt_default_currency",
  description: "Flip products.price_currency's DEFAULT from 'USD' to 'BDT' now that the catalog is fully migrated",
  async up(conn) {
    const [cols] = await conn.query(`
      SELECT column_default FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'price_currency'
    `);
    if (!cols.length) throw new Error("products.price_currency column not found — run 0003 first");
    if (cols[0].column_default === "BDT") return; // already migrated
    await conn.query("ALTER TABLE products ALTER COLUMN price_currency SET DEFAULT 'BDT'");
  },
};

export default migration;
