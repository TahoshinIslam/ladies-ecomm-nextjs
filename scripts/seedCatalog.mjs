// Populates the real MongoDB catalog for the modest-fashion taxonomy:
// categories (2-level: department -> style), attribute definitions (drive
// the dynamic filter panel), and a handful of representative products with
// variants. Safe to re-run — every write is an upsert keyed by a stable
// natural key (category/attribute: slug/key; product: name).
//
// Usage: node --env-file=.env scripts/seedCatalog.mjs

import mongoose from "mongoose";
import Category from "../models/categoryModel.js";
import AttributeDefinition from "../models/attributeDefinitionModel.js";
import Product from "../models/productModel.js";

// Connects directly rather than via config/db.js so this script stays
// self-contained and dependency-free, independent of the app's own
// connection caching (which is only useful inside a live Next.js server
// process, not a one-shot script).
async function connectDB() {
  const uri =
    process.env.NODE_ENV === "test"
      ? process.env.MONGO_URI_TEST
      : process.env.MONGO_URI;
  if (!uri) {
    throw new Error(
      `${process.env.NODE_ENV === "test" ? "MONGO_URI_TEST" : "MONGO_URI"} is not set`,
    );
  }
  mongoose.set("strictQuery", true);
  const conn = await mongoose.connect(uri);
  console.log(`MongoDB connected: ${conn.connection.host}`);
}

// `.png` (not the bare, extension-less URL) — placehold.co's default
// response is `image/svg+xml`, which Next's image optimizer rejects
// unless dangerouslyAllowSVG is set (a security tradeoff not worth
// making for a placeholder image source); `.png` gets a real raster
// response Next can optimize normally.
const IMG = (seed) => `https://placehold.co/800x1000.png?text=${encodeURIComponent(seed)}`;

// ---------------------------------------------------------------------------
// Category taxonomy
// ---------------------------------------------------------------------------

// This is a clothing-only shop — every entry here is a real, top-level
// department (parent: null) with its own leaf styles as direct children,
// a plain 2-level tree. Every department keeps its original slug/_id
// (upserted by slug), so no existing product's `topCategory` needs to
// change.
const CLOTHES_DEPARTMENTS = [
  {
    slug: "burqa",
    name: "Burqa",
    children: [
      { slug: "burqa-closed-style", name: "Closed-style Burqa" },
      { slug: "burqa-open-front", name: "Open-front Burqa" },
      { slug: "burqa-two-piece", name: "Two-piece Burqa" },
      { slug: "burqa-saudi-style", name: "Saudi-style Burqa" },
      { slug: "burqa-niqab-integrated", name: "Niqab-integrated Burqa" },
      { slug: "burqa-kids", name: "Kids Burqa" },
    ],
  },
  {
    slug: "hijab",
    name: "Hijab",
    children: [
      { slug: "hijab-instant", name: "Instant Hijab" },
      { slug: "hijab-pull-on", name: "Pull-on / One-piece Hijab" },
      { slug: "hijab-square-shayla", name: "Square Hijab (Shayla)" },
      { slug: "hijab-rectangle-shawl", name: "Rectangle / Shawl Hijab" },
      { slug: "hijab-underscarf-cap", name: "Underscarf / Hijab Cap" },
      { slug: "hijab-chiffon", name: "Chiffon Hijab" },
      { slug: "hijab-jersey", name: "Jersey Hijab" },
      { slug: "hijab-printed", name: "Printed Hijab" },
    ],
  },
  {
    slug: "niqab",
    name: "Niqab",
    children: [
      { slug: "niqab-single-layer", name: "Single-layer Niqab" },
      { slug: "niqab-double-layer", name: "Double-layer Niqab" },
      { slug: "niqab-pull-on", name: "Pull-on Niqab" },
      { slug: "niqab-tie-back", name: "Tie-back Niqab" },
      { slug: "niqab-half", name: "Half Niqab" },
    ],
  },
  {
    slug: "abaya",
    name: "Abaya",
    children: [
      { slug: "abaya-open-front", name: "Open-front Abaya" },
      { slug: "abaya-closed-pullover", name: "Closed / Pull-over Abaya" },
      { slug: "abaya-kimono", name: "Kimono Abaya" },
      { slug: "abaya-butterfly-farasha", name: "Butterfly / Farasha Abaya" },
      { slug: "abaya-nida", name: "Nida Abaya" },
      { slug: "abaya-embroidered", name: "Embroidered / Embellished Abaya" },
      { slug: "abaya-bridal", name: "Bridal Abaya" },
      { slug: "abaya-kids", name: "Kids Abaya" },
    ],
  },
  {
    slug: "khimar",
    name: "Khimar",
    children: [
      { slug: "khimar-one-layer", name: "One-layer Khimar" },
      { slug: "khimar-two-three-layer", name: "Two/Three-layer Khimar" },
      { slug: "khimar-long-maxi", name: "Long / Maxi Khimar" },
      { slug: "khimar-short", name: "Short Khimar" },
      { slug: "khimar-prayer", name: "Prayer Khimar" },
    ],
  },
  {
    slug: "modest-sets",
    name: "Modest Sets",
    children: [
      { slug: "modest-sets-abaya-hijab", name: "Abaya + Hijab Set" },
      { slug: "modest-sets-prayer-two-piece", name: "Prayer 2-Piece Set" },
      { slug: "modest-sets-loungewear", name: "Modest Loungewear Set" },
      { slug: "modest-sets-occasion", name: "Eid / Occasion Set" },
    ],
  },
  {
    slug: "t-shirt",
    name: "T-Shirt",
    children: [
      { slug: "tshirt-crew-neck", name: "Crew Neck T-Shirt" },
      { slug: "tshirt-graphic", name: "Graphic T-Shirt" },
      { slug: "tshirt-polo", name: "Polo T-Shirt" },
    ],
  },
  // A department's leaf subcategories are just data — nothing in the shop
  // filter, admin dropdowns, or attribute scoping hardcodes "t-shirt" or
  // any other slug (see services/productService.js's listGroupings and
  // AttributeDefinition.appliesToCategories) — so Shirts/Jeans, each with
  // their own leaf subsections, need no code changes at all, only these
  // category entries.
  {
    slug: "shirts",
    name: "Shirts",
    children: [
      { slug: "shirts-formal", name: "Formal Shirt" },
      { slug: "shirts-casual", name: "Casual Shirt" },
    ],
  },
  {
    slug: "jeans",
    name: "Jeans",
    children: [
      { slug: "jeans-skinny", name: "Skinny Jeans" },
      { slug: "jeans-straight", name: "Straight Jeans" },
    ],
  },
];

// Every clothing department slug — used below to scope the color/size/
// fabric AttributeDefinitions to real departments.
const CLOTHING_DEPARTMENT_SLUGS = ["burqa", "hijab", "niqab", "abaya", "khimar", "modest-sets", "t-shirt", "shirts", "jeans"];

async function seedCategories() {
  const topBySlug = new Map();
  let sortOrder = 0;

  for (const dept of CLOTHES_DEPARTMENTS) {
    const top = await Category.findOneAndUpdate(
      { slug: dept.slug },
      { $set: { name: dept.name, parent: null, sortOrder: sortOrder++ } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
    topBySlug.set(dept.slug, top);

    let childOrder = 0;
    for (const child of dept.children) {
      await Category.findOneAndUpdate(
        { slug: child.slug },
        {
          $set: {
            name: child.name,
            parent: top._id,
            sortOrder: childOrder++,
          },
        },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
      );
    }
  }

  const all = await Category.find({}).lean();
  return { topBySlug, bySlug: new Map(all.map((c) => [c.slug, c])) };
}

// ---------------------------------------------------------------------------
// Attribute definitions
// ---------------------------------------------------------------------------

function buildAttributeDefs(topBySlug) {
  const topId = (slug) => topBySlug.get(slug)._id;
  const clothingDeptIds = CLOTHING_DEPARTMENT_SLUGS.map(topId);

  return [
    {
      key: "color",
      label: "Color",
      type: "swatch",
      derivedFromVariant: true,
      appliesToCategories: clothingDeptIds,
      options: [
        { value: "black", label: "Black", swatchHex: "#1a1a1a" },
        { value: "navy", label: "Navy", swatchHex: "#1f2a44" },
        { value: "charcoal", label: "Charcoal", swatchHex: "#36454f" },
        { value: "beige", label: "Beige", swatchHex: "#d8c3a5" },
        { value: "olive", label: "Olive", swatchHex: "#6b6f4c" },
        { value: "maroon", label: "Maroon", swatchHex: "#7b2d26" },
        { value: "dusty-rose", label: "Dusty Rose", swatchHex: "#c9a0a0" },
        { value: "white", label: "White", swatchHex: "#ffffff" },
        { value: "red", label: "Red", swatchHex: "#c0392b" },
        { value: "blue", label: "Blue", swatchHex: "#2c5faa" },
      ],
    },
    {
      key: "size",
      label: "Size",
      type: "select",
      derivedFromVariant: true,
      appliesToCategories: clothingDeptIds,
      labelOverrides: [
        { category: topId("burqa"), label: "Length" },
        { category: topId("khimar"), label: "Length" },
      ],
      options: [
        { value: "free-size", label: "Free Size" },
        { value: "s", label: "S" },
        { value: "m", label: "M" },
        { value: "l", label: "L" },
        { value: "xl", label: "XL" },
        { value: "xxl", label: "XXL" },
        { value: "3xl", label: "3XL" },
        { value: "short", label: "Short" },
        { value: "regular", label: "Regular" },
        { value: "long", label: "Long" },
        { value: "maxi", label: "Maxi" },
      ],
    },
    {
      key: "fabric",
      label: "Fabric",
      type: "select",
      derivedFromVariant: true,
      appliesToCategories: clothingDeptIds,
      options: [
        { value: "nida", label: "Nida" },
        { value: "crepe", label: "Crepe" },
        { value: "chiffon", label: "Chiffon" },
        { value: "jersey", label: "Jersey" },
        { value: "georgette", label: "Georgette" },
        { value: "khaddar", label: "Khaddar" },
        { value: "cotton", label: "Cotton" },
        { value: "silk-blend", label: "Silk Blend" },
      ],
    },
    {
      key: "coverageLevel",
      label: "Coverage Level",
      type: "select",
      appliesToCategories: [topId("burqa"), topId("abaya"), topId("khimar")],
      options: [
        { value: "full", label: "Full Coverage" },
        { value: "extended", label: "Extended Coverage" },
        { value: "standard", label: "Standard" },
      ],
    },
    {
      key: "closure",
      label: "Closure",
      type: "select",
      appliesToCategories: [topId("burqa"), topId("abaya")],
      options: [
        { value: "open-front-zip", label: "Open-front Zip" },
        { value: "open-front-snap", label: "Open-front Snap" },
        { value: "pull-over", label: "Pull-over" },
        { value: "wrap-tie", label: "Wrap-tie" },
      ],
    },
    {
      key: "opacity",
      label: "Opacity",
      type: "select",
      appliesToCategories: [topId("hijab"), topId("niqab")],
      options: [
        { value: "sheer", label: "Sheer" },
        { value: "semi-opaque", label: "Semi-opaque" },
        { value: "opaque", label: "Opaque" },
      ],
    },
    {
      key: "occasion",
      label: "Occasion",
      type: "select",
      appliesToCategories: [],
      options: [
        { value: "everyday", label: "Everyday" },
        { value: "prayer", label: "Prayer" },
        { value: "eid", label: "Eid" },
        { value: "bridal", label: "Bridal" },
        { value: "formal", label: "Formal" },
      ],
    },
    {
      key: "lining",
      label: "Lining",
      type: "select",
      appliesToCategories: [topId("burqa"), topId("abaya"), topId("hijab")],
      options: [
        { value: "full", label: "Full lining" },
        { value: "half", label: "Half lining" },
        { value: "none", label: "No lining" },
      ],
    },
    {
      key: "careInstructions",
      label: "Care Instructions",
      type: "text",
      filterable: false,
      appliesToCategories: [],
      options: [],
    },
  ];
}

async function seedAttributeDefinitions(topBySlug) {
  const defs = buildAttributeDefs(topBySlug);
  for (const def of defs) {
    await AttributeDefinition.findOneAndUpdate(
      { key: def.key },
      { $set: def },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
  }
  return defs.length;
}

// ---------------------------------------------------------------------------
// Sample products (one per department, so every phase after this has real
// data — variants, denormalized attributes, measurements — to render).
// ---------------------------------------------------------------------------

function buildProducts(categoryBySlug) {
  const cat = (slug) => categoryBySlug.get(slug)._id;
  const attrs = (pairs) => pairs.map(([key, values]) => ({ key, values }));

  return [
    {
      name: "Saudi-Style Closed Burqa",
      description:
        "A closed, pull-over burqa with full lining for opaque, structured coverage — offered in premium Nida or lightweight Crepe.",
      category: cat("burqa-saudi-style"),
      basePrice: 65,
      images: [IMG("Burqa")],
      variants: [
        {
          variantName: "Black / Free Size / Nida",
          sku: "BUR-SAU-BLK-FS-NIDA",
          attributes: { color: "black", size: "free-size", fabric: "nida" },
          stock: 20,
          images: [IMG("Burqa+Black")],
        },
        {
          // Same color, same size, different fabric — the one axis
          // combination the Phase 1-4 seed data never exercised. Priced
          // higher: Crepe drapes lighter but costs more per yard than Nida.
          variantName: "Black / Free Size / Crepe",
          sku: "BUR-SAU-BLK-FS-CREPE",
          attributes: { color: "black", size: "free-size", fabric: "crepe" },
          price: 72,
          stock: 8,
          images: [IMG("Burqa+Black+Crepe")],
        },
        {
          variantName: "Navy / Free Size / Nida",
          sku: "BUR-SAU-NVY-FS-NIDA",
          attributes: { color: "navy", size: "free-size", fabric: "nida" },
          stock: 15,
          images: [IMG("Burqa+Navy")],
        },
      ],
      attributes: attrs([
        ["coverageLevel", ["full"]],
        ["closure", ["pull-over"]],
        ["lining", ["full"]],
        ["occasion", ["everyday", "prayer"]],
        ["careInstructions", ["Hand wash cold, do not bleach, line dry."]],
      ]),
      measurements: {
        heightRange: "5'2\" – 5'8\"",
        chest: "Free Size (up to 44in)",
        sleeveLength: "Full length",
      },
      availability: "readyStock",
      tags: ["burqa", "everyday", "full-coverage"],
    },
    {
      name: "Instant Jersey Hijab",
      description:
        "A no-pin, pull-on jersey hijab with a soft matte finish and opaque coverage for daily wear.",
      category: cat("hijab-instant"),
      basePrice: 18,
      images: [IMG("Hijab")],
      variants: [
        {
          variantName: "Black / Free Size / Jersey",
          sku: "HIJ-INS-BLK-FS",
          attributes: { color: "black", size: "free-size", fabric: "jersey" },
          stock: 50,
          images: [IMG("Hijab+Black")],
        },
        {
          variantName: "Dusty Rose / Free Size / Jersey",
          sku: "HIJ-INS-ROS-FS",
          attributes: { color: "dusty-rose", size: "free-size", fabric: "jersey" },
          stock: 40,
          images: [IMG("Hijab+Rose")],
        },
        {
          variantName: "Olive / Free Size / Jersey",
          sku: "HIJ-INS-OLV-FS",
          attributes: { color: "olive", size: "free-size", fabric: "jersey" },
          stock: 30,
          images: [IMG("Hijab+Olive")],
        },
      ],
      attributes: attrs([
        ["opacity", ["opaque"]],
        ["occasion", ["everyday", "formal"]],
        ["careInstructions", ["Machine wash cold, tumble dry low."]],
      ]),
      availability: "readyStock",
      tags: ["hijab", "everyday", "instant"],
    },
    {
      name: "Double-Layer Chiffon Niqab",
      description:
        "A tie-back double-layer niqab in lightweight chiffon, semi-opaque for comfortable all-day wear.",
      category: cat("niqab-double-layer"),
      basePrice: 15,
      images: [IMG("Niqab")],
      variants: [
        {
          variantName: "Black / Free Size / Chiffon",
          sku: "NIQ-DBL-BLK-FS",
          attributes: { color: "black", size: "free-size", fabric: "chiffon" },
          stock: 25,
          images: [IMG("Niqab+Black")],
        },
        {
          variantName: "Charcoal / Free Size / Chiffon",
          sku: "NIQ-DBL-CHR-FS",
          attributes: { color: "charcoal", size: "free-size", fabric: "chiffon" },
          stock: 18,
          images: [IMG("Niqab+Charcoal")],
        },
      ],
      attributes: attrs([
        ["opacity", ["semi-opaque"]],
        ["occasion", ["everyday", "prayer"]],
        ["careInstructions", ["Hand wash cold."]],
      ]),
      availability: "readyStock",
      tags: ["niqab", "everyday"],
    },
    {
      name: "Open-Front Nida Abaya",
      description:
        "A tailored open-front abaya in structured Nida with a half lining and a discreet front zip closure.",
      category: cat("abaya-open-front"),
      basePrice: 68,
      images: [IMG("Abaya")],
      variants: [
        {
          variantName: "Black / M / Nida",
          sku: "ABY-OPF-BLK-M",
          attributes: { color: "black", size: "m", fabric: "nida" },
          stock: 10,
          images: [IMG("Abaya+Black+M")],
        },
        {
          variantName: "Black / L / Nida",
          sku: "ABY-OPF-BLK-L",
          attributes: { color: "black", size: "l", fabric: "nida" },
          stock: 8,
          images: [IMG("Abaya+Black+L")],
        },
        {
          variantName: "Black / 3XL / Nida",
          sku: "ABY-OPF-BLK-3XL",
          attributes: { color: "black", size: "3xl", fabric: "nida" },
          price: 78,
          stock: 5,
          images: [IMG("Abaya+Black+3XL")],
        },
        {
          variantName: "Navy / M / Nida",
          sku: "ABY-OPF-NVY-M",
          attributes: { color: "navy", size: "m", fabric: "nida" },
          stock: 6,
          images: [IMG("Abaya+Navy+M")],
        },
      ],
      attributes: attrs([
        ["coverageLevel", ["full"]],
        ["closure", ["open-front-zip"]],
        ["lining", ["half"]],
        ["occasion", ["everyday", "formal", "eid"]],
        ["careInstructions", ["Dry clean recommended."]],
      ]),
      measurements: {
        heightRange: "5'3\" – 5'9\"",
        chest: "M: 38in / L: 42in / 3XL: 50in",
        sleeveLength: "24in",
      },
      availability: "readyStock",
      tags: ["abaya", "everyday", "formal"],
    },
    {
      name: "Two-Layer Tiered Khimar",
      description:
        "An extended-coverage two-layer khimar in soft jersey, available in two lengths.",
      category: cat("khimar-two-three-layer"),
      basePrice: 34,
      images: [IMG("Khimar")],
      variants: [
        {
          variantName: "Black / Long / Jersey",
          sku: "KHI-2LY-BLK-LNG",
          attributes: { color: "black", size: "long", fabric: "jersey" },
          stock: 20,
          images: [IMG("Khimar+Black+Long")],
        },
        {
          variantName: "Navy / Long / Jersey",
          sku: "KHI-2LY-NVY-LNG",
          attributes: { color: "navy", size: "long", fabric: "jersey" },
          stock: 15,
          images: [IMG("Khimar+Navy+Long")],
        },
        {
          variantName: "Black / Short / Jersey",
          sku: "KHI-2LY-BLK-SHT",
          attributes: { color: "black", size: "short", fabric: "jersey" },
          stock: 10,
          images: [IMG("Khimar+Black+Short")],
        },
      ],
      attributes: attrs([
        ["coverageLevel", ["extended"]],
        ["occasion", ["everyday", "prayer"]],
        ["careInstructions", ["Machine wash cold, gentle cycle."]],
      ]),
      measurements: {
        heightRange: "5'0\" – 5'10\" (Long)",
        chest: "",
        sleeveLength: "",
      },
      availability: "readyStock",
      tags: ["khimar", "everyday", "prayer"],
    },
    {
      name: "Abaya & Hijab Matching Set",
      description:
        "A coordinated Eid-ready set: an open-front Nida abaya paired with a matching jersey hijab.",
      category: cat("modest-sets-abaya-hijab"),
      basePrice: 82,
      images: [IMG("Modest+Set")],
      variants: [
        {
          variantName: "Black Set / Free Size / Nida",
          sku: "SET-ABH-BLK-FS",
          attributes: { color: "black", size: "free-size", fabric: "nida" },
          stock: 10,
          images: [IMG("Set+Black")],
        },
        {
          variantName: "Olive Set / Free Size / Nida",
          sku: "SET-ABH-OLV-FS",
          attributes: { color: "olive", size: "free-size", fabric: "nida" },
          stock: 8,
          images: [IMG("Set+Olive")],
        },
      ],
      attributes: attrs([
        ["occasion", ["eid", "formal"]],
        ["careInstructions", ["Hand wash the abaya cold; machine wash the hijab."]],
      ]),
      includedItems: ["Abaya", "Matching Hijab"],
      availability: "preOrder",
      tags: ["modest-sets", "eid", "bundle"],
    },
    // --- T-shirt ---
    {
      name: "Classic Crew Neck T-Shirt",
      description: "Everyday cotton crew neck, true-to-size and pre-shrunk.",
      category: cat("tshirt-crew-neck"),
      basePrice: 8,
      images: [IMG("Tshirt")],
      variants: [
        {
          variantName: "Black / M",
          sku: "TSH-CREW-BLK-M",
          attributes: { color: "black", size: "m" },
          stock: 40,
          images: [IMG("Tshirt+Black")],
        },
        {
          variantName: "Red / L",
          sku: "TSH-CREW-RED-L",
          attributes: { color: "red", size: "l" },
          stock: 22,
          images: [IMG("Tshirt+Red")],
        },
      ],
      tags: ["clothes", "t-shirt"],
    },
    // --- Shirts (split into Formal / Casual subsections —
    // both come from Category documents alone, nothing hardcoded) ---
    {
      name: "Oxford Formal Shirt",
      description: "Crisp cotton Oxford shirt, tailored fit for office and formal wear.",
      category: cat("shirts-formal"),
      basePrice: 20,
      images: [IMG("Formal+Shirt")],
      variants: [
        {
          variantName: "Black / M",
          sku: "SHR-FRM-BLK-M",
          attributes: { color: "black", size: "m" },
          stock: 18,
          images: [IMG("Formal+Shirt+Black")],
        },
        {
          variantName: "Blue / L",
          sku: "SHR-FRM-BLU-L",
          attributes: { color: "blue", size: "l" },
          stock: 14,
          images: [IMG("Formal+Shirt+Blue")],
        },
      ],
      tags: ["clothes", "shirts", "formal"],
    },
    {
      name: "Relaxed Casual Shirt",
      description: "Breathable cotton-blend casual shirt for everyday wear.",
      category: cat("shirts-casual"),
      basePrice: 16,
      images: [IMG("Casual+Shirt")],
      variants: [
        {
          variantName: "Red / M",
          sku: "SHR-CAS-RED-M",
          attributes: { color: "red", size: "m" },
          stock: 20,
          images: [IMG("Casual+Shirt+Red")],
        },
      ],
      tags: ["clothes", "shirts", "casual"],
    },
    // --- Jeans (new department) ---
    {
      name: "Slim Fit Skinny Jeans",
      description: "Stretch-denim skinny jeans with a slim, tapered leg.",
      category: cat("jeans-skinny"),
      basePrice: 28,
      images: [IMG("Skinny+Jeans")],
      variants: [
        {
          variantName: "Black / M",
          sku: "JNS-SKN-BLK-M",
          attributes: { color: "black", size: "m" },
          stock: 16,
          images: [IMG("Skinny+Jeans+Black")],
        },
      ],
      tags: ["clothes", "jeans", "skinny"],
    },
    {
      name: "Relaxed Straight Jeans",
      description: "Classic straight-leg denim with a relaxed fit through the thigh.",
      category: cat("jeans-straight"),
      basePrice: 30,
      images: [IMG("Straight+Jeans")],
      variants: [
        {
          variantName: "Blue / L",
          sku: "JNS-STR-BLU-L",
          attributes: { color: "blue", size: "l" },
          stock: 12,
          images: [IMG("Straight+Jeans+Blue")],
        },
      ],
      tags: ["clothes", "jeans", "straight"],
    },
  ];
}

async function seedProducts(categoryBySlug) {
  const products = buildProducts(categoryBySlug);
  let created = 0;
  let updated = 0;

  for (const data of products) {
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
  return { created, updated, total: products.length };
}

// ---------------------------------------------------------------------------

async function main() {
  await connectDB();

  const { topBySlug, bySlug } = await seedCategories();
  console.log(`Categories: ${CLOTHES_DEPARTMENTS.length} departments, ${bySlug.size} total (departments + styles).`);

  const attrCount = await seedAttributeDefinitions(topBySlug);
  console.log(`Attribute definitions: ${attrCount} upserted.`);

  const productResult = await seedProducts(bySlug);
  console.log(
    `Products: ${productResult.created} created, ${productResult.updated} updated (${productResult.total} total).`,
  );

  // MongoDB allows only one text index per collection — Phase 3 added
  // "attributes.values" to the compound text index in productModel.js, but
  // that schema change alone doesn't touch what's already built on Atlas.
  // syncIndexes() drops the old text index and builds the new one to match.
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
