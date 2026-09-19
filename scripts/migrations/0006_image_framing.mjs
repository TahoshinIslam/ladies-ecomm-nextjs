// Image-framing storage (see lib/imageFraming.js). Purely ADDITIVE and
// nullable: adds a per-placement crop/fit record next to images that already
// exist, and never touches an existing image URL or any existing value — so
// every image keeps rendering exactly as before until an admin frames it.
//   promotions.desktop_framing / mobile_framing  — hero + popup crops
//   products.image_framing — { "<image url>": framing } for product photos
// (Homepage tile/banner framing lives inside settings.homepage JSON, which
// needs no schema change.) Idempotent: skips columns that already exist.
const COLUMNS = [
  ["promotions", "desktop_framing"],
  ["promotions", "mobile_framing"],
  ["products", "image_framing"],
];

const migration = {
  id: "0006_image_framing",
  description: "Add nullable JSON framing columns for promotion and product images",
  async up(conn) {
    for (const [table, column] of COLUMNS) {
      const [rows] = await conn.query(
        `SELECT COUNT(*) AS n FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [table, column],
      );
      if (rows[0].n > 0) continue;
      await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} JSON NULL`);
    }
  },
};

export default migration;
