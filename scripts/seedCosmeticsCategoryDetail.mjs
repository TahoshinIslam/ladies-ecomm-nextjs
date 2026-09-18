// =============================================================================
// DEPRECATED — Mongo -> MySQL migration (see docs/PRODUCTION_READINESS.md
// and README.md's setup section for the current MariaDB architecture).
// One-time Mongo-era catalog-restructuring script (Cosmetics category
// detail), already applied to the source MongoDB database. Imports
// Mongoose models directly, incompatible with the current SQL model
// shape (models/*.js). scripts/seedCatalog.mjs (the current MySQL seed
// script) only seeds the original 9-department fashion catalog — this
// script's marketplace-expansion category shape was never carried into
// MySQL. Converting it is a product/content decision (expanding the
// live catalog), not a migration-correctness one — out of scope here.
// Not wired into any package.json script and not imported by any
// remaining live code path. Left in place for historical reference only —
// do not run this against the current MySQL/MariaDB database.
// =============================================================================

// Restructures Cosmetics (under Beauty & Health) into the granular
// product-type leaves a shopper actually browses by (Face Wash, Toner,
// Moisturizer, Serum, Lipstick, Foundation, Shampoo, Hair Serum) instead of
// the coarser Skincare/Makeup/Haircare grouping — each a real, direct
// child of Cosmetics so the new category-landing page (views/shop/
// CategoryLanding.jsx) shows one tile per product type. Also seeds real
// Brand records (CeraVe, COSRX, Maybelline, Sunsilk, L'Oréal) and a real
// "Country of Origin" AttributeDefinition scoped to Cosmetics, so the
// filter sidebar has genuine brand/country facets to show once a shopper
// drills into a specific leaf (e.g. Face Wash) — both are fully
// admin-manageable going forward via the generic attribute/brand system,
// not hardcoded to this seed.
//
// Usage: node --env-file=.env.local scripts/seedCosmeticsCategoryDetail.mjs

import mongoose from "mongoose";
import Category from "../models/categoryModel.js";
import Product from "../models/productModel.js";
import Brand from "../models/brandModel.js";
import AttributeDefinition from "../models/attributeDefinitionModel.js";

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

const BRANDS = [
  { slug: "cerave", name: "CeraVe" },
  { slug: "cosrx", name: "COSRX" },
  { slug: "maybelline", name: "Maybelline" },
  { slug: "sunsilk", name: "Sunsilk" },
  { slug: "loreal", name: "L'Oréal" },
];

const COUNTRY_OPTIONS = [
  { value: "usa", label: "USA" },
  { value: "korea", label: "Korea" },
  { value: "bangladesh", label: "Bangladesh" },
  { value: "france", label: "France" },
];

// slug -> the leaf this seed data reassigns/creates it under, plus the
// real product filed there. `oldSlug` (when present) is the coarser
// category this leaf replaces — its existing product is reassigned here
// rather than duplicated, and the old category is deleted once empty.
const LEAVES = [
  {
    slug: "face-wash",
    name: "Face Wash",
    product: { name: "CeraVe Foaming Facial Cleanser (236ml)", price: 1450, brand: "cerave", country: "usa" },
  },
  {
    slug: "toner",
    name: "Toner",
    product: { name: "COSRX AHA/BHA Clarifying Toner (150ml)", price: 1650, brand: "cosrx", country: "korea" },
  },
  {
    slug: "moisturizer",
    name: "Moisturizer",
    product: { name: "CeraVe Moisturizing Cream (340g)", price: 1950, brand: "cerave", country: "usa" },
  },
  {
    slug: "serum",
    oldSlug: "skincare",
    name: "Serum",
    product: { name: "Vitamin C Face Serum (30ml)", price: 650, brand: "cosrx", country: "korea" },
  },
  {
    slug: "lipstick",
    oldSlug: "makeup",
    name: "Lipstick",
    product: { name: "Matte Liquid Lipstick", price: 380, brand: "maybelline", country: "usa" },
  },
  {
    slug: "foundation",
    name: "Foundation",
    product: { name: "Liquid Foundation SPF 15", price: 890, brand: "maybelline", country: "usa" },
  },
  {
    slug: "shampoo",
    name: "Shampoo",
    product: { name: "Anti-Hairfall Shampoo (400ml)", price: 320, brand: "sunsilk", country: "bangladesh" },
  },
  {
    slug: "hair-serum",
    oldSlug: "haircare",
    name: "Hair Serum",
    product: { name: "Argan Oil Hair Serum (100ml)", price: 420, brand: "loreal", country: "france" },
  },
];

async function seedBrands() {
  const bySlug = new Map();
  for (const b of BRANDS) {
    const doc = await Brand.findOneAndUpdate(
      { slug: b.slug },
      { $set: { name: b.name } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
    bySlug.set(b.slug, doc);
  }
  return bySlug;
}

async function main() {
  await connectDB();

  const cosmetics = await Category.findOne({ slug: "cosmetics" }).lean();
  if (!cosmetics) throw new Error("Cosmetics category not found — run scripts/seedMarketplaceExpansion.mjs first.");

  const brandsBySlug = await seedBrands();

  await AttributeDefinition.findOneAndUpdate(
    { key: "countryOfOrigin" },
    {
      $set: {
        label: "Country of Origin",
        type: "select",
        derivedFromVariant: false,
        appliesToCategories: [cosmetics._id],
        options: COUNTRY_OPTIONS,
        filterable: true,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  let leafOrder = 0;
  let created = 0;
  let updated = 0;
  const oldSlugsToCheck = new Set();

  for (const leaf of LEAVES) {
    const leafDoc = await Category.findOneAndUpdate(
      { slug: leaf.slug },
      { $set: { name: leaf.name, parent: cosmetics._id, sortOrder: leafOrder++ } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );

    const brand = brandsBySlug.get(leaf.product.brand);
    const data = {
      name: leaf.product.name,
      description: `${leaf.product.name} — a real, catalog-ready sample product for the Cosmetics / ${leaf.name} category.`,
      category: leafDoc._id,
      basePrice: leaf.product.price,
      brand: brand?._id ?? null,
      images: [IMG(leaf.product.name)],
      variants: [
        {
          variantName: "Default",
          sku: `COS-${leaf.slug.toUpperCase()}-1`,
          stock: 25,
          images: [IMG(leaf.product.name)],
        },
      ],
      attributes: [{ key: "countryOfOrigin", values: [leaf.product.country] }],
      availability: "readyStock",
      tags: [leaf.slug, "cosmetics"],
    };

    const existing = await Product.findOne({ name: data.name });
    if (existing) {
      Object.assign(existing, data);
      await existing.save();
      updated++;
    } else {
      await new Product(data).save();
      created++;
    }

    if (leaf.oldSlug) oldSlugsToCheck.add(leaf.oldSlug);
  }

  // The coarser Skincare/Makeup/Haircare categories are now empty (their
  // one product each was reassigned above) — delete them so the Cosmetics
  // landing page shows only the new, granular leaves. Deliberately
  // conditional on actually having zero products left, never a blind
  // delete, in case a real admin filed something else under one of these
  // between seed runs.
  let removedOldCategories = 0;
  for (const slug of oldSlugsToCheck) {
    const oldCat = await Category.findOne({ slug });
    if (!oldCat) continue;
    const stillHasProducts = await Product.exists({ category: oldCat._id });
    if (stillHasProducts) {
      console.log(`Skipping delete of "${slug}" — still has products filed under it.`);
      continue;
    }
    await Category.deleteOne({ _id: oldCat._id });
    removedOldCategories++;
  }

  console.log(
    `Cosmetics detail: ${created} products created, ${updated} updated, ` +
      `${removedOldCategories} superseded categories removed, ${BRANDS.length} brands upserted.`,
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
