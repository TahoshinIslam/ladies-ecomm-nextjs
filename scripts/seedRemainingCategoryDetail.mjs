// Restructures the remaining flat-2-level marketplace divisions (Baby
// Food & Care, Home Cleaning, Pet Care, Stationeries, Gadget) into the
// same 3-level shape (division -> department -> style) as Food/Beauty &
// Health/Home & Kitchen/Toys & Sports/Jewelry/Diapers, so every
// division's drill-down category landing page (views/shop/
// CategoryLanding.jsx) shows a real two-step browse instead of jumping
// straight to a flat product list. Each existing department's one
// product is reassigned to a new, more specific leaf underneath rather
// than duplicated; one brand-new sample product fills out the sibling
// leaf.
//
// Usage: node --env-file=.env.local scripts/seedRemainingCategoryDetail.mjs

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

// divisionSlug -> its departments -> each department's new leaf children.
// `reassign` (when present) is the exact existing product name currently
// filed directly under the department — its `category` is moved to this
// new leaf rather than duplicating it; every other entry is a brand-new
// sample product.
const DIVISIONS = [
  {
    slug: "baby-food-care",
    departments: [
      {
        slug: "baby-food",
        leaves: [
          { slug: "infant-formula", name: "Infant Formula", reassign: "Infant Formula Milk Powder (400g)" },
          { slug: "baby-cereal", name: "Baby Cereal", product: { name: "Instant Baby Cereal, Rice (200g)", price: 380 } },
        ],
      },
      {
        slug: "baby-skincare",
        leaves: [
          { slug: "baby-lotion", name: "Baby Lotion", reassign: "Gentle Baby Lotion (200ml)" },
          { slug: "baby-powder", name: "Baby Powder", product: { name: "Baby Talcum Powder (200g)", price: 220 } },
        ],
      },
      {
        slug: "baby-gear",
        leaves: [
          { slug: "feeding-bottles", name: "Feeding Bottles", reassign: "Baby Feeding Bottle Set" },
          { slug: "baby-carrier", name: "Baby Carrier", product: { name: "Ergonomic Baby Carrier", price: 1650 } },
        ],
      },
    ],
  },
  {
    slug: "home-cleaning",
    departments: [
      {
        slug: "laundry",
        leaves: [
          { slug: "liquid-detergent", name: "Liquid Detergent", reassign: "Concentrated Liquid Detergent (1L)" },
          { slug: "fabric-softener", name: "Fabric Softener", product: { name: "Fabric Softener, Fresh Scent (900ml)", price: 210 } },
        ],
      },
      {
        slug: "surface-cleaners",
        leaves: [
          { slug: "multi-surface-spray", name: "Multi-surface Spray", reassign: "Multi-surface Cleaner Spray (500ml)" },
          { slug: "glass-cleaner", name: "Glass Cleaner", product: { name: "Streak-Free Glass Cleaner (500ml)", price: 150 } },
        ],
      },
      {
        slug: "cleaning-tools",
        leaves: [
          { slug: "microfiber-cloths", name: "Microfiber Cloths", reassign: "Microfiber Cleaning Cloth Set (5pcs)" },
          { slug: "mop-bucket", name: "Mop & Bucket", product: { name: "Spin Mop & Bucket Set", price: 1450 } },
        ],
      },
    ],
  },
  {
    slug: "pet-care",
    departments: [
      {
        slug: "dog-food",
        leaves: [
          { slug: "dry-dog-food", name: "Dry Dog Food", reassign: "Dry Dog Food, Chicken Flavor (1kg)" },
          { slug: "wet-dog-food", name: "Wet Dog Food", product: { name: "Wet Dog Food Pouch, Beef (400g)", price: 260 } },
        ],
      },
      {
        slug: "cat-food",
        leaves: [
          { slug: "dry-cat-food", name: "Dry Cat Food", reassign: "Dry Cat Food, Tuna Flavor (1kg)" },
          { slug: "cat-litter", name: "Cat Litter", product: { name: "Clumping Cat Litter (5kg)", price: 620 } },
        ],
      },
      {
        slug: "pet-accessories",
        leaves: [
          { slug: "pet-collars", name: "Pet Collars", reassign: "Adjustable Pet Collar" },
          { slug: "pet-leashes", name: "Pet Leashes", product: { name: "Retractable Pet Leash (5m)", price: 480 } },
        ],
      },
    ],
  },
  {
    slug: "stationeries",
    departments: [
      {
        slug: "office-supplies",
        leaves: [
          { slug: "ballpoint-pens", name: "Ballpoint Pens", reassign: "Executive Ballpoint Pen Set" },
          { slug: "sticky-notes", name: "Sticky Notes", product: { name: "Sticky Notes Pad Set (6 colors)", price: 120 } },
        ],
      },
      {
        slug: "school-supplies",
        leaves: [
          { slug: "notebooks", name: "Notebooks", reassign: "Spiral Notebook Pack (5pcs)" },
          { slug: "pencil-box", name: "Pencil Box", product: { name: "Multi-compartment Pencil Box", price: 180 } },
        ],
      },
      {
        slug: "art-supplies",
        leaves: [
          { slug: "watercolor-paints", name: "Watercolor Paints", reassign: "Watercolor Paint Set (24 colors)" },
          { slug: "sketch-pad", name: "Sketch Pad", product: { name: "A4 Sketch Pad (50 sheets)", price: 160 } },
        ],
      },
    ],
  },
  {
    slug: "gadget",
    departments: [
      {
        slug: "mobile-accessories",
        leaves: [
          { slug: "charging-cables", name: "Charging Cables", reassign: "Fast Charging USB-C Cable (1m)" },
          { slug: "power-banks", name: "Power Banks", product: { name: "10000mAh Power Bank", price: 1350 } },
        ],
      },
      {
        slug: "small-electronics",
        leaves: [
          { slug: "bluetooth-speakers", name: "Bluetooth Speakers", reassign: "Portable Bluetooth Speaker" },
          { slug: "smart-watches", name: "Smart Watches", product: { name: "Fitness Smart Watch", price: 2800 } },
        ],
      },
      {
        slug: "audio",
        leaves: [
          { slug: "wireless-earbuds", name: "Wireless Earbuds", reassign: "Wireless Earbuds" },
          { slug: "headphones", name: "Headphones", product: { name: "Over-ear Wireless Headphones", price: 2400 } },
        ],
      },
    ],
  },
];

async function main() {
  await connectDB();

  let created = 0;
  let reassigned = 0;
  let skippedMissing = 0;
  let skippedDept = 0;

  for (const division of DIVISIONS) {
    const divisionDoc = await Category.findOne({ slug: division.slug }).lean();
    if (!divisionDoc) {
      console.log(`Skipping division "${division.slug}" — not found. Run scripts/seedMarketplaceExpansion.mjs first.`);
      continue;
    }

    for (const dept of division.departments) {
      const deptDoc = await Category.findOne({ slug: dept.slug, parent: divisionDoc._id });
      if (!deptDoc) {
        console.log(`Skipping "${dept.slug}" — department not found under ${divisionDoc.name}.`);
        skippedDept++;
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
          description: `${leaf.product.name} — a real, catalog-ready sample product for the ${divisionDoc.name} / ${deptDoc.name} / ${leaf.name} category.`,
          category: leafDoc._id,
          basePrice: leaf.product.price,
          images: [IMG(leaf.product.name)],
          variants: [
            {
              variantName: "Default",
              sku: `MKT-${leaf.slug.toUpperCase()}-1`,
              stock: 25,
              images: [IMG(leaf.product.name)],
            },
          ],
          availability: "readyStock",
          tags: [leaf.slug, division.slug],
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
  }

  console.log(
    `Remaining divisions detail: ${created} products created, ${reassigned} reassigned to new leaves, ` +
      `${skippedMissing} skipped (missing product), ${skippedDept} skipped (missing department).`,
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
