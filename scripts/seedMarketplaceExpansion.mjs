// Expands the catalog from a single-vertical modest-fashion shop into a
// multi-category general marketplace (Food, Baby Care, Diapers, Home
// Cleaning, Pet Care, Beauty & Health, Home & Kitchen, Jewelry,
// Stationeries, Toys & Sports, Gadgets) — the departments a real general
// store like Shwapno carries that this catalog was missing entirely.
//
// Every new department is a division (parent: null) per
// services/categoryService.js's own already-designed "division ->
// department -> style" 3-level rule (validateParent) — a rule that existed
// but was never actually exercised until now, since every prior category
// tree here was exactly 2 levels. The existing 9 fashion departments
// (Burqa, Hijab, Niqab, Abaya, Khimar, Modest Sets, T-Shirt, Shirts, Jeans)
// are untouched — still their own top-level divisions, same ids, same
// topCategory on every existing product — this script only ADDS alongside
// them.
//
// Products here are explicitly sample/demo data (per the user's own
// choice when asked) — one real DB record per leaf category so every new
// department renders a real, non-empty grid immediately, not a
// placeholder. Prices are illustrative Taka amounts, not sourced from any
// real supplier.
//
// Usage: node --env-file=.env.local scripts/seedMarketplaceExpansion.mjs

import mongoose from "mongoose";
import Category from "../models/categoryModel.js";
import Product from "../models/productModel.js";

// This is meant for a developer's own local `tahos_dev` database (the one
// `npm run dev` reads/writes) — never production, never the `tahos_test`
// database `npm test` truncates/reseeds. Mirrors the guard pattern already
// used by this project's other one-off dev scripts.
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

// Each division: { slug, name, icon (a lucide-react icon name — see
// components/layout/CategoryMegaMenu.jsx's ICONS map), children: [
//   { slug, name, products: [...] }               <- a 2-level division
//   { slug, name, children: [{ slug, name, products }] } <- a 3-level one
// ] }
// `products` lives on whichever node is a genuine leaf (a style/leaf
// category real products get filed under) — never on a division or
// mid-tier department, matching services/categoryService.js's own
// isLeafCategory() contract (leaf = no children).
const DIVISIONS = [
  {
    slug: "food",
    name: "Food",
    icon: "utensils-crossed",
    children: [
      {
        slug: "fruits-vegetables",
        name: "Fruits & Vegetables",
        children: [
          { slug: "fresh-fruits", name: "Fresh Fruits", products: [{ name: "Bangladeshi Sweet Mango (1kg)", price: 180 }] },
          { slug: "fresh-vegetables", name: "Fresh Vegetables", products: [{ name: "Farm Fresh Potato (1kg)", price: 35 }] },
          { slug: "dry-fruits", name: "Dry Fruits", products: [{ name: "Premium Cashew Nuts (250g)", price: 450 }] },
          { slug: "dry-vegetables", name: "Dry Vegetables", products: [{ name: "Sun-dried Red Chili (100g)", price: 90 }] },
        ],
      },
      {
        slug: "meat-fish",
        name: "Meat & Fish",
        children: [
          { slug: "fish", name: "Fish", products: [{ name: "Fresh Rohu Fish (1kg)", price: 320 }] },
          { slug: "chicken", name: "Chicken", products: [{ name: "Broiler Chicken, Whole (1kg)", price: 210 }] },
          { slug: "mutton-beef", name: "Mutton & Beef", products: [{ name: "Fresh Beef (1kg)", price: 780 }] },
        ],
      },
      {
        slug: "dairy-eggs",
        name: "Dairy & Eggs",
        children: [
          { slug: "milk", name: "Milk", products: [{ name: "Pasteurized Milk (1L)", price: 90 }] },
          { slug: "eggs", name: "Eggs", products: [{ name: "Farm Fresh Eggs (12pcs)", price: 140 }] },
          { slug: "cheese-butter", name: "Cheese & Butter", products: [{ name: "Processed Cheese Slices (200g)", price: 380 }] },
        ],
      },
      {
        slug: "snacks-beverages",
        name: "Snacks & Beverages",
        children: [
          { slug: "snacks", name: "Snacks", products: [{ name: "Potato Chips, Classic Salted (150g)", price: 60 }] },
          { slug: "beverages", name: "Beverages", products: [{ name: "Mixed Fruit Juice (1L)", price: 120 }] },
        ],
      },
    ],
  },
  {
    slug: "baby-food-care",
    name: "Baby Food & Care",
    icon: "baby",
    children: [
      { slug: "baby-food", name: "Baby Food", products: [{ name: "Infant Formula Milk Powder (400g)", price: 850 }] },
      { slug: "baby-skincare", name: "Baby Skincare", products: [{ name: "Gentle Baby Lotion (200ml)", price: 320 }] },
      { slug: "baby-gear", name: "Baby Gear", products: [{ name: "Baby Feeding Bottle Set", price: 550 }] },
    ],
  },
  {
    slug: "diapers",
    name: "Diapers",
    icon: "baby",
    children: [
      { slug: "diapers-newborn", name: "Newborn Diapers", products: [{ name: "Newborn Diapers Pack (30pcs)", price: 650 }] },
      { slug: "diapers-infant", name: "Infant Diapers", products: [{ name: "Infant Diapers Pack (28pcs)", price: 680 }] },
      { slug: "diapers-toddler", name: "Toddler Diapers", products: [{ name: "Toddler Pants Diapers (26pcs)", price: 720 }] },
    ],
  },
  {
    slug: "home-cleaning",
    name: "Home Cleaning",
    icon: "spray-can",
    children: [
      { slug: "laundry", name: "Laundry", products: [{ name: "Concentrated Liquid Detergent (1L)", price: 240 }] },
      { slug: "surface-cleaners", name: "Surface Cleaners", products: [{ name: "Multi-surface Cleaner Spray (500ml)", price: 180 }] },
      { slug: "cleaning-tools", name: "Cleaning Tools", products: [{ name: "Microfiber Cleaning Cloth Set (5pcs)", price: 150 }] },
    ],
  },
  {
    slug: "pet-care",
    name: "Pet Care",
    icon: "paw-print",
    children: [
      { slug: "dog-food", name: "Dog Food", products: [{ name: "Dry Dog Food, Chicken Flavor (1kg)", price: 480 }] },
      { slug: "cat-food", name: "Cat Food", products: [{ name: "Dry Cat Food, Tuna Flavor (1kg)", price: 420 }] },
      { slug: "pet-accessories", name: "Pet Accessories", products: [{ name: "Adjustable Pet Collar", price: 250 }] },
    ],
  },
  {
    slug: "beauty-health",
    name: "Beauty & Health",
    icon: "sparkles",
    children: [
      {
        slug: "cosmetics",
        name: "Cosmetics",
        children: [
          { slug: "skincare", name: "Skincare", products: [{ name: "Vitamin C Face Serum (30ml)", price: 650 }] },
          { slug: "makeup", name: "Makeup", products: [{ name: "Matte Liquid Lipstick", price: 380 }] },
          { slug: "haircare", name: "Haircare", products: [{ name: "Argan Oil Hair Serum (100ml)", price: 420 }] },
        ],
      },
      {
        slug: "personal-care",
        name: "Personal Care",
        children: [
          { slug: "bath-body", name: "Bath & Body", products: [{ name: "Moisturizing Body Wash (400ml)", price: 280 }] },
          { slug: "oral-care", name: "Oral Care", products: [{ name: "Fluoride Toothpaste (150g)", price: 110 }] },
        ],
      },
      {
        slug: "health-wellness",
        name: "Health & Wellness",
        children: [
          { slug: "vitamins-supplements", name: "Vitamins & Supplements", products: [{ name: "Daily Multivitamin Tablets (30ct)", price: 550 }] },
          { slug: "first-aid", name: "First Aid", products: [{ name: "First Aid Kit, Home Essentials", price: 620 }] },
        ],
      },
    ],
  },
  {
    slug: "home-kitchen",
    name: "Home & Kitchen",
    icon: "home",
    children: [
      {
        slug: "home-decor",
        name: "Home Decor",
        children: [
          { slug: "wall-decor", name: "Wall Decor", products: [{ name: "Framed Canvas Wall Art", price: 1200 }] },
          { slug: "lighting", name: "Lighting", products: [{ name: "Decorative LED String Lights", price: 450 }] },
          { slug: "rugs", name: "Rugs", products: [{ name: "Handwoven Area Rug (4x6 ft)", price: 2800 }] },
        ],
      },
      {
        slug: "kitchen-dining",
        name: "Kitchen & Dining",
        children: [
          { slug: "cookware", name: "Cookware", products: [{ name: "Non-stick Cookware Set (5pcs)", price: 3200 }] },
          { slug: "dinnerware", name: "Dinnerware", products: [{ name: "Ceramic Dinner Set (16pcs)", price: 2400 }] },
        ],
      },
      {
        slug: "furniture",
        name: "Furniture",
        children: [
          { slug: "living-room", name: "Living Room", products: [{ name: "Wooden Bookshelf (3-tier)", price: 4500 }] },
          { slug: "storage", name: "Storage", products: [{ name: "Fabric Storage Ottoman", price: 1900 }] },
        ],
      },
    ],
  },
  {
    slug: "jewelry",
    name: "Jewelry",
    icon: "gem",
    children: [
      { slug: "earrings", name: "Earrings", products: [{ name: "Gold-plated Stud Earrings", price: 850 }] },
      { slug: "necklaces", name: "Necklaces", products: [{ name: "Layered Chain Necklace", price: 1100 }] },
      { slug: "rings", name: "Rings", products: [{ name: "Silver Adjustable Ring", price: 650 }] },
      { slug: "bangles", name: "Bangles", products: [{ name: "Traditional Kansa Bangle Set", price: 950 }] },
    ],
  },
  {
    slug: "stationeries",
    name: "Stationeries",
    icon: "pen-line",
    children: [
      { slug: "office-supplies", name: "Office Supplies", products: [{ name: "Executive Ballpoint Pen Set", price: 350 }] },
      { slug: "school-supplies", name: "School Supplies", products: [{ name: "Spiral Notebook Pack (5pcs)", price: 220 }] },
      { slug: "art-supplies", name: "Art Supplies", products: [{ name: "Watercolor Paint Set (24 colors)", price: 480 }] },
    ],
  },
  {
    slug: "toys-sports",
    name: "Toys & Sports",
    icon: "puzzle",
    children: [
      { slug: "toys", name: "Toys", products: [{ name: "Building Blocks Set (100pcs)", price: 850 }] },
      { slug: "sports-equipment", name: "Sports Equipment", products: [{ name: "Football (Size 5)", price: 650 }] },
      { slug: "outdoor-games", name: "Outdoor Games", products: [{ name: "Badminton Racket Set", price: 750 }] },
    ],
  },
  {
    slug: "gadget",
    name: "Gadget",
    icon: "smartphone",
    children: [
      { slug: "mobile-accessories", name: "Mobile Accessories", products: [{ name: "Fast Charging USB-C Cable (1m)", price: 250 }] },
      { slug: "small-electronics", name: "Small Electronics", products: [{ name: "Portable Bluetooth Speaker", price: 1800 }] },
      { slug: "audio", name: "Audio", products: [{ name: "Wireless Earbuds", price: 2200 }] },
    ],
  },
];

async function upsertCategory({ slug, name, parent, icon, sortOrder }) {
  return Category.findOneAndUpdate(
    { slug },
    { $set: { name, parent, icon: icon || "", sortOrder } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
}

async function seedCategoriesAndProducts() {
  const leafCategoriesForProducts = [];
  let divisionOrder = 100; // after the existing 9 fashion departments' own sortOrders

  for (const division of DIVISIONS) {
    const divisionDoc = await upsertCategory({
      slug: division.slug,
      name: division.name,
      parent: null,
      icon: division.icon,
      sortOrder: divisionOrder++,
    });

    let deptOrder = 0;
    for (const dept of division.children) {
      const deptDoc = await upsertCategory({
        slug: dept.slug,
        name: dept.name,
        parent: divisionDoc._id,
        sortOrder: deptOrder++,
      });

      if (dept.products) {
        leafCategoriesForProducts.push({ categoryDoc: deptDoc, products: dept.products });
        continue;
      }

      let styleOrder = 0;
      for (const style of dept.children) {
        const styleDoc = await upsertCategory({
          slug: style.slug,
          name: style.name,
          parent: deptDoc._id,
          sortOrder: styleOrder++,
        });
        leafCategoriesForProducts.push({ categoryDoc: styleDoc, products: style.products });
      }
    }
  }

  let created = 0;
  let updated = 0;
  for (const { categoryDoc, products } of leafCategoriesForProducts) {
    for (const p of products) {
      const data = {
        name: p.name,
        description: `${p.name} — a real, catalog-ready sample product for the ${categoryDoc.name} category.`,
        category: categoryDoc._id,
        basePrice: p.price,
        images: [IMG(p.name)],
        variants: [
          {
            variantName: "Default",
            sku: `MKT-${categoryDoc.slug.toUpperCase()}-${created + updated + 1}`,
            stock: 25,
            images: [IMG(p.name)],
          },
        ],
        availability: "readyStock",
        tags: [categoryDoc.slug],
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
    }
  }

  return {
    divisions: DIVISIONS.length,
    leaves: leafCategoriesForProducts.length,
    productsCreated: created,
    productsUpdated: updated,
  };
}

async function main() {
  await connectDB();
  const result = await seedCategoriesAndProducts();
  console.log(
    `Marketplace expansion: ${result.divisions} new divisions, ${result.leaves} leaf categories, ` +
      `${result.productsCreated} products created, ${result.productsUpdated} updated.`,
  );
  await Product.syncIndexes();
  console.log("Product indexes synced.");
  await mongoose.disconnect();
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
