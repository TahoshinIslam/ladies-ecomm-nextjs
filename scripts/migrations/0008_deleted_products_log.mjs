// Log table for deleted products. Deleting a product now removes it from
// `products` (so it leaves every admin and storefront list) after saving a
// full JSON snapshot (product, variants, facets) here. Additive and
// idempotent; touches no existing data.
const migration = {
  id: "0008_deleted_products_log",
  description: "Create deleted_products log table (snapshot of each hard-deleted product)",
  async up(conn) {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS deleted_products (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        product_id CHAR(24) NOT NULL,
        name VARCHAR(500) NOT NULL,
        slug VARCHAR(600) NOT NULL,
        deleted_by CHAR(24) NULL,
        deleted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        snapshot LONGTEXT NOT NULL,
        PRIMARY KEY (id),
        KEY idx_deleted_products_product (product_id),
        KEY idx_deleted_products_deleted_at (deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  },
};

export default migration;
