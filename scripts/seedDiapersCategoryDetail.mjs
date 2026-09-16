// Restructures Diapers from a flat 2-level tree (division -> leaf
// directly) into the same 3-level shape (division -> department -> style)
// as Food/Beauty & Health/Home & Kitchen/Toys & Sports/Jewelry, so its
// drill-down category landing page (views/shop/CategoryLanding.jsx) shows
// a real two-step browse — Diapers -> Newborn/Infant/Toddler ->
// a specific brand pack — instead of jumping straight from the division
// to a single flat product list. Newborn/Infant/Toddler Diapers become
// real mid-tier departments (size groups); their one existing product
// each is reassigned to a new, brand-specific leaf underneath rather than
// duplicated.
//
// Usage: node --env-file=.env.local scripts/seedDiapersCategoryDetail.mjs

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

// deptSlug -> the department's new leaf children, one per real diaper
// brand at that size. `reassign` (when present) is the exact existing
// product name currently filed directly under the department — its
// `category` is moved to this new leaf rather than duplicating it; every
// other entry is a brand-new sample product.
const DEPARTMENTS = [
  {
    slug: "diapers-newborn",
    leaves: [
      { slug: "huggies-newborn", name: "Huggies", reassign: "Newborn Diapers Pack (30pcs)" },
      { slug: "pampers-newborn", name: "Pampers", product: { name: "Pampers Newborn Diapers Pack (32pcs)", price: 690 } },
    ],
  },
  {
    slug: "diapers-infant",
    leaves: [
      { slug: "huggies-infant", name: "Huggies", reassign: "Infant Diapers Pack (28pcs)" },
      { slug: "mamypoko-infant", name: "MamyPoko", product: { name: "MamyPoko Infant Diapers Pack (30pcs)", price: 710 } },
    ],
  },
  {
    slug: "diapers-toddler",
    leaves: [
      { slug: "pampers-toddler", name: "Pampers", reassign: "Toddler Pants Diapers (26pcs)" },
      { slug: "mamypoko-toddler", name: "MamyPoko", product: { name: "MamyPoko Toddler Pants Diapers (24pcs)", price: 740 } },
    ],
  },
];

async function main() {
  await connectDB();

  const diapers = await Category.findOne({ slug: "diapers" }).lean();
  if (!diapers) throw new Error("Diapers division not found — run scripts/seedMarketplaceExpansion.mjs first.");

  let created = 0;
  let reassigned = 0;
  let skippedMissing = 0;

  for (const dept of DEPARTMENTS) {
    const deptDoc = await Category.findOne({ slug: dept.slug, parent: diapers._id });
    if (!deptDoc) {
      console.log(`Skipping "${dept.slug}" — department not found under Diapers.`);
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
        description: `${leaf.product.name} — a real, catalog-ready sample product for the Diapers / ${deptDoc.name} / ${leaf.name} category.`,
        category: leafDoc._id,
        basePrice: leaf.product.price,
        images: [IMG(leaf.product.name)],
        variants: [
          {
            variantName: "Default",
            sku: `DPR-${leaf.slug.toUpperCase()}-1`,
            stock: 25,
            images: [IMG(leaf.product.name)],
          },
        ],
        availability: "readyStock",
        tags: [leaf.slug, "diapers"],
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
    `Diapers detail: ${created} products created, ${reassigned} reassigned to new leaves, ${skippedMissing} skipped (missing).`,
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
