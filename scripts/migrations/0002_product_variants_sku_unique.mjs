// Confirmed audit finding (independently reproduced against the real dev
// database, not hypothetical): product_variants.sku has only a plain KEY,
// never UNIQUE — services/productService.js's assertSkusUnique() is a
// check-then-insert with no shared transaction/lock, a real TOCTOU gap.
// A read-only scan of the actual dev database (ladies_multi_ecomm) found
// 3 EXISTING duplicate-SKU pairs today:
//   BUR-SAU-NVY-FS-NIDA — products 6a98b4cc1dff0db712d98f47 (active, has
//     order/review history, category_id now dangling) and
//     6aabced3da7ef41850f6ffaf (active, no orders, valid category)
//   HIJ-INS-BLK-FS       — products 6a98b4cc1dff0db712d98f4a (active, has
//     order history, category_id now dangling) and
//     6aabced3435ad98399f6ffb3 (active, no orders, valid category)
//   JNS-STR-BLU-L        — products 6aa0bd5702281c362b1784f6 (INACTIVE,
//     no orders, category_id now dangling) and
//     6aabced35f18d2df60f6ffd0 (active, no orders, valid category)
// All 6 products also share exact duplicate NAMES pairwise with their SKU
// duplicate. Root cause (from timestamps): the older row of each pair was
// created 2026-09-02/09-08 and its category was later deleted/restructured
// (leaving it with a dangling category_id); the newer row of each pair was
// created 2026-09-17, almost certainly from a reseed script re-run that
// has no dedupe-by-name/SKU check (scripts/seedCatalog.mjs).
//
// Per this audit's explicit instructions: do NOT delete, rename, or merge
// these live conflicting records automatically, and do NOT assume which
// one is "correct" — that requires a business decision (see
// docs/CATALOG_REPAIR_PROPOSAL.md for the full read-only proposal with
// exact IDs and a recommended resolution). This migration therefore
// REFUSES to apply — loudly, with the exact conflicting IDs — for as long
// as any duplicate SKU exists, rather than either (a) silently skipping
// (which would leave the real concurrency bug open with no visibility) or
// (b) picking a "winner" itself. Once the conflicts above are resolved by
// a human decision (see the repair proposal), re-running this same
// migration will succeed and add the missing UNIQUE constraint.
const migration = {
  id: "0002_product_variants_sku_unique",
  description: "Add UNIQUE constraint on product_variants.sku (blocked while duplicates exist)",
  async up(conn) {
    const [dupes] = await conn.query(`
      SELECT sku, COUNT(*) AS n, GROUP_CONCAT(id) AS variant_ids, GROUP_CONCAT(product_id) AS product_ids
      FROM product_variants
      GROUP BY sku
      HAVING COUNT(*) > 1
    `);

    if (dupes.length > 0) {
      const report = dupes.map((d) => `  - SKU "${d.sku}": variants [${d.variant_ids}] on products [${d.product_ids}]`).join("\n");
      throw new Error(
        `Cannot add UNIQUE constraint on product_variants.sku — ${dupes.length} duplicate SKU(s) currently exist:\n${report}\n` +
          `Resolve these first (see docs/CATALOG_REPAIR_PROPOSAL.md for the recommended, reviewed resolution for each), ` +
          `then re-run this migration. No data was changed.`,
      );
    }

    // Idempotent even outside the schema_migrations ledger: skip if a
    // unique index on this column already exists under any name.
    const [existing] = await conn.query(`
      SELECT COUNT(*) AS n FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'product_variants' AND column_name = 'sku' AND non_unique = 0
    `);
    if (existing[0].n > 0) return;

    await conn.query("ALTER TABLE product_variants ADD UNIQUE KEY uq_product_variants_sku (sku)");
  },
};

export default migration;
