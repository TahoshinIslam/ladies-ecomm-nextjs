// =============================================================================
// DEPRECATED — Mongo -> MySQL migration (see docs/PRODUCTION_READINESS.md
// and README.md's setup section for the current MariaDB architecture).
// One-time Mongo-era catalog-restructuring script (Jewelry category
// detail), already applied to the source MongoDB database. Imports
// Mongoose models directly, incompatible with the current SQL model
// shape (models/*.js). See scripts/seedCosmeticsCategoryDetail.mjs's own
// deprecation note for the full reasoning — identical situation.
// Not wired into any package.json script and not imported by any
// remaining live code path. Left in place for historical reference only —
// do not run this against the current MySQL/MariaDB database.
// =============================================================================

// Restructures Jewelry from a flat 2-level tree (division -> leaf
// directly) into the same 3-level shape (division -> department -> style)
// as Food/Beauty & Health/Home & Kitchen/Toys & Sports, so its drill-down
// category landing page (views/shop/CategoryLanding.jsx) shows a real
// two-step browse — Jewelry -> Earrings/Necklaces/Rings/Bangles -> a
// specific style — instead of jumping straight from the division to a
// single flat product list. Earrings/Necklaces/Rings/Bangles become real
// mid-tier departments; their one existing product each is reassigned to
// a new, more specific leaf underneath rather than duplicated.
//
// Usage: node --env-file=.env.local scripts/seedJewelryCategoryDetail.mjs

import mongoose from "mongoose";
import Category from "../models/categoryModel.js";
import Product from "../models/productModel.js";

async function connectDB() {
  const uri = process.env.MONGO_URI_DEV;
  if (!uri) throw new Error("MONGO_URI_DEV is not set — refusing to run against anything else.");
  if (!/127\.0\.0\.1|localhost/i.test(uri)) {
    throw new Error("MONGO_URI_DEV does not look like a local database — refusing to run.");
  }
  mongoose.set("strictQuery", true);
  const conn = await mongoose.connect(uri);
  console.log(`MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
}

const IMG = (seed) => `https://placehold.co/800x1000.png?text=${encodeURIComponent(seed)}`;

// deptSlug -> the department's new leaf children. `reassign` (when
// present) is the exact existing product name currently filed directly
// under the department — its `category` is moved to this new leaf rather
// than duplicating it; every other entry is a brand-new sample product.
const DEPARTMENTS = [
  {
    slug: "earrings",
    leaves: [
      { slug: "stud-earrings", name: "Stud Earrings", reassign: "Gold-plated Stud Earrings" },
      { slug: "hoop-earrings", name: "Hoop Earrings", product: { name: "Classic Gold Hoop Earrings", price: 780 } },
      { slug: "drop-earrings", name: "Drop Earrings", product: { name: "Pearl Drop Earrings", price: 920 } },
    ],
  },
  {
    slug: "necklaces",
    leaves: [
      { slug: "chain-necklace", name: "Chain Necklace", reassign: "Layered Chain Necklace" },
      { slug: "pendant-necklace", name: "Pendant Necklace", product: { name: "Heart Pendant Necklace", price: 1250 } },
    ],
  },
  {
    slug: "rings",
    leaves: [
      { slug: "adjustable-ring", name: "Adjustable Ring", reassign: "Silver Adjustable Ring" },
      { slug: "engagement-ring", name: "Engagement Ring", product: { name: "Solitaire Engagement Ring", price: 4200 } },
    ],
  },
  {
    slug: "bangles",
    leaves: [
      { slug: "kansa-bangle", name: "Kansa Bangle", reassign: "Traditional Kansa Bangle Set" },
      { slug: "glass-bangle", name: "Glass Bangle", product: { name: "Colorful Glass Bangle Set (12pcs)", price: 380 } },
    ],
  },
];

async function main() {
  await connectDB();

  const jewelry = await Category.findOne({ slug: "jewelry" }).lean();
  if (!jewelry) throw new Error("Jewelry division not found — run scripts/seedMarketplaceExpansion.mjs first.");

  let created = 0;
  let reassigned = 0;
  let skippedMissing = 0;

  for (const dept of DEPARTMENTS) {
    const deptDoc = await Category.findOne({ slug: dept.slug, parent: jewelry._id });
    if (!deptDoc) {
      console.log(`Skipping "${dept.slug}" — department not found under Jewelry.`);
      continue;
    }

    let leafOrder = 0;
    for (const leaf of dept.leaves) {
      const leafDoc = await Category.findOneAndUpdate(
        { slug: leaf.slug },
        { $set: { name: leaf.name, parent: deptDoc._id, sortOrder: leafOrder++ } },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
      );

      if (leaf.reassign) {
        const existing = await Product.findOne({ name: leaf.reassign });
        if (!existing) {
          console.log(`Skipping reassign of "${leaf.reassign}" — product not found.`);
          skippedMissing++;
          continue;
        }
        existing.category = leafDoc._id;
        await existing.save();
        reassigned++;
        continue;
      }

      const data = {
        name: leaf.product.name,
        description: `${leaf.product.name} — a real, catalog-ready sample product for the Jewelry / ${leaf.name} category.`,
        category: leafDoc._id,
        basePrice: leaf.product.price,
        images: [IMG(leaf.product.name)],
        variants: [
          {
            variantName: "Default",
            sku: `JWL-${leaf.slug.toUpperCase()}-1`,
            stock: 25,
            images: [IMG(leaf.product.name)],
          },
        ],
        availability: "readyStock",
        tags: [leaf.slug, "jewelry"],
      };
      const alreadyExists = await Product.findOne({ name: data.name });
      if (alreadyExists) {
        Object.assign(alreadyExists, data);
        await alreadyExists.save();
      } else {
        await new Product(data).save();
        created++;
      }
    }
  }

  console.log(
    `Jewelry detail: ${created} products created, ${reassigned} reassigned to new leaves, ${skippedMissing} skipped (missing).`,
  );
  await Product.syncIndexes();
  await mongoose.disconnect();
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
