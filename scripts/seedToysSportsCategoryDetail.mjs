// Restructures Toys & Sports from a flat 2-level tree (division -> leaf
// directly) into the same 3-level shape (division -> department -> style)
// as Food/Beauty & Health/Home & Kitchen, so its drill-down category
// landing page (views/shop/CategoryLanding.jsx) shows a real two-step
// browse — Toys & Sports -> Toys/Sports Equipment/Outdoor Games -> a
// specific style — instead of jumping straight from the division to a
// single flat product list. Toys/Sports Equipment/Outdoor Games become
// real mid-tier departments; their one existing product each is
// reassigned to a new, more specific leaf underneath rather than
// duplicated.
//
// Usage: node --env-file=.env.local scripts/seedToysSportsCategoryDetail.mjs

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
    slug: "toys",
    leaves: [
      { slug: "building-blocks", name: "Building Blocks", reassign: "Building Blocks Set (100pcs)" },
      { slug: "action-figures", name: "Action Figures", product: { name: "Superhero Action Figure Set (6pcs)", price: 690 } },
      { slug: "puzzles", name: "Puzzles", product: { name: "1000-Piece Jigsaw Puzzle", price: 420 } },
    ],
  },
  {
    slug: "sports-equipment",
    leaves: [
      { slug: "football", name: "Football", reassign: "Football (Size 5)" },
      { slug: "cricket", name: "Cricket", product: { name: "Cricket Bat & Ball Set", price: 1450 } },
      { slug: "basketball", name: "Basketball", product: { name: "Basketball (Size 7)", price: 890 } },
    ],
  },
  {
    slug: "outdoor-games",
    leaves: [
      { slug: "badminton", name: "Badminton", reassign: "Badminton Racket Set" },
      { slug: "kite-flying", name: "Kite Flying", product: { name: "Large Fighter Kite (2pcs)", price: 180 } },
    ],
  },
];

async function main() {
  await connectDB();

  const toysSports = await Category.findOne({ slug: "toys-sports" }).lean();
  if (!toysSports) throw new Error("Toys & Sports division not found — run scripts/seedMarketplaceExpansion.mjs first.");

  let created = 0;
  let reassigned = 0;
  let skippedMissing = 0;

  for (const dept of DEPARTMENTS) {
    const deptDoc = await Category.findOne({ slug: dept.slug, parent: toysSports._id });
    if (!deptDoc) {
      console.log(`Skipping "${dept.slug}" — department not found under Toys & Sports.`);
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
        description: `${leaf.product.name} — a real, catalog-ready sample product for the Toys & Sports / ${leaf.name} category.`,
        category: leafDoc._id,
        basePrice: leaf.product.price,
        images: [IMG(leaf.product.name)],
        variants: [
          {
            variantName: "Default",
            sku: `TOY-${leaf.slug.toUpperCase()}-1`,
            stock: 25,
            images: [IMG(leaf.product.name)],
          },
        ],
        availability: "readyStock",
        tags: [leaf.slug, "toys-sports"],
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
    `Toys & Sports detail: ${created} products created, ${reassigned} reassigned to new leaves, ${skippedMissing} skipped (missing).`,
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
