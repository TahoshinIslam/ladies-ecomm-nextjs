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

const IMG = (seed) => `https://placehold.co/800x1000?text=${encodeURIComponent(seed)}`;

// Real, free-license stock photos (Unsplash) for the Cosmetics seed
// products — verified in-browser to actually depict lipstick/foundation
// before use, unlike the rest of the catalog's text placeholders. Requires
// `images.unsplash.com` in next.config.mjs's image remotePatterns.
const UNSPLASH = (id) => `https://images.unsplash.com/photo-${id}?w=800&q=80&auto=format&fit=crop`;
const COSMETICS_IMAGES = {
  lipstick: UNSPLASH("1596462502278-27bfdc403348"), // lipstick swipe/smear
  lipstickFlatlay: UNSPLASH("1512496015851-a90fb38ba796"), // cosmetics flatlay
  foundation: UNSPLASH("1557205465-f3762edea6d3"), // foundation bottles
};

// ---------------------------------------------------------------------------
// Category taxonomy
// ---------------------------------------------------------------------------

// Clothes is a real division (parent: null) whose children are themselves
// departments (Burqa, Hijab, ...), each with their own leaf styles — a
// genuine 3rd level, not just a UI grouping. Every department here keeps
// its original slug/_id (upserted by slug, same as before), so no existing
// product's `topCategory` (denormalized one hop above its leaf, i.e. still
// the department, never Clothes) needs to change — see
// services/categoryService.js/productService.js for the department-vs-
// division distinction this relies on.
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

// Flat (2-level) departments — each is itself a root category whose direct
// children are real leaf styles, same shape Cosmetics has always had.
// Unlike CLOTHES_DEPARTMENTS above, these are NOT nested under a division.
const FLAT_DEPARTMENTS = [
  // First non-clothing department — proves the variant-attribute
  // generalization (see models/productModel.js's variantSchema.attributes)
  // needs no code changes for a new vertical, only these seed documents.
  {
    slug: "cosmetics",
    name: "Cosmetics",
    children: [
      { slug: "cosmetics-lipstick", name: "Lipstick" },
      { slug: "cosmetics-foundation", name: "Foundation" },
      { slug: "cosmetics-facewash", name: "Facewash" },
    ],
  },
  {
    slug: "shoes",
    name: "Shoes",
    children: [
      { slug: "shoes-sneakers", name: "Sneakers" },
      { slug: "shoes-sandals", name: "Sandals" },
      { slug: "shoes-formal", name: "Formal Shoes" },
    ],
  },
  {
    slug: "sunglasses",
    name: "Sunglasses",
    children: [
      { slug: "sunglasses-aviator", name: "Aviator Sunglasses" },
      { slug: "sunglasses-wayfarer", name: "Wayfarer Sunglasses" },
    ],
  },
];

// Every clothing department slug — used below to scope the color/size/
// fabric AttributeDefinitions away from non-clothing departments (they'd
// otherwise stay universal and wrongly show up on the Cosmetics/Shoes/
// Sunglasses variant forms too, since their appliesToCategories was empty/
// universal before Cosmetics existed).
const CLOTHING_DEPARTMENT_SLUGS = ["burqa", "hijab", "niqab", "abaya", "khimar", "modest-sets", "t-shirt", "shirts", "jeans"];

async function seedCategories() {
  const topBySlug = new Map();
  let sortOrder = 0;

  // Clothes: one division (parent: null), its departments as children
  // (parent: Clothes._id), each department's own leaf styles as
  // grandchildren (parent: department._id) — the real 3rd level.
  const clothes = await Category.findOneAndUpdate(
    { slug: "clothes" },
    { $set: { name: "Clothes", parent: null, sortOrder: sortOrder++ } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  for (const dept of CLOTHES_DEPARTMENTS) {
    const top = await Category.findOneAndUpdate(
      { slug: dept.slug },
      { $set: { name: dept.name, parent: clothes._id, sortOrder: sortOrder++ } },
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

  // Flat departments: each is its own root (parent: null), leaves as
  // direct children — same shape as before Clothes existed.
  for (const dept of FLAT_DEPARTMENTS) {
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
  // "color" is shared across clothing, Shoes, and Sunglasses — one key/
  // option-set reused across departments, same pattern "size" already uses
  // via labelOverrides. Shoes/Sunglasses deliberately get no other
  // variant-identity attribute of their own for now (no shoe sizing, no
  // sunglasses-specific descriptive attribute) — not requested; flagged as
  // an assumption, easy to extend later.
  const colorDeptIds = [...clothingDeptIds, topId("shoes"), topId("sunglasses")];

  return [
    {
      key: "color",
      label: "Color",
      type: "swatch",
      derivedFromVariant: true,
      appliesToCategories: colorDeptIds,
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
    // --- Cosmetics — proves AttributeDefinition.derivedFromVariant works
    // for a variant dimension that isn't color/size/fabric, with no code
    // change (see models/productModel.js's pre-validate facet-sync hook
    // and views/admin/ProductsPage.jsx's dynamic Variants step). ---
    {
      key: "shade",
      label: "Shade",
      type: "swatch",
      derivedFromVariant: true,
      appliesToCategories: [topId("cosmetics")],
      options: [
        { value: "ruby-red", label: "Ruby Red", swatchHex: "#9b111e" },
        { value: "nude-blush", label: "Nude Blush", swatchHex: "#dca8a0" },
        { value: "coral-pop", label: "Coral Pop", swatchHex: "#ff6f61" },
        { value: "ivory", label: "Ivory", swatchHex: "#f2e6d8" },
        { value: "honey", label: "Honey", swatchHex: "#c68a4e" },
      ],
    },
    {
      key: "volumeMl",
      label: "Volume",
      type: "select",
      derivedFromVariant: true,
      appliesToCategories: [topId("cosmetics")],
      options: [
        { value: "15ml", label: "15ml" },
        { value: "30ml", label: "30ml" },
        { value: "50ml", label: "50ml" },
      ],
    },
    {
      key: "skinType",
      label: "Skin Type",
      type: "select",
      // Admin-set descriptive attribute, not variant-derived — every shade/
      // volume of a given foundation suits the same skin types, so this
      // isn't a purchasing axis the way shade is.
      appliesToCategories: [topId("cosmetics")],
      options: [
        { value: "oily", label: "Oily" },
        { value: "dry", label: "Dry" },
        { value: "combination", label: "Combination" },
        { value: "sensitive", label: "Sensitive" },
        { value: "all", label: "All skin types" },
      ],
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
    // --- Cosmetics test case ---
    {
      // Multi-variant: proves the shade axis (a non-color/size/fabric
      // AttributeDefinition.derivedFromVariant key) drives the storefront
      // selector, the "images by shade" admin grouping, and the cart/order
      // snapshot the same way color does for clothing.
      name: "Matte Liquid Lipstick",
      description: "Long-wearing matte liquid lipstick in five true-to-tone shades.",
      category: cat("cosmetics-lipstick"),
      basePrice: 12,
      images: [COSMETICS_IMAGES.lipstick, COSMETICS_IMAGES.lipstickFlatlay],
      variants: [
        {
          variantName: "Ruby Red",
          sku: "COS-LIP-RUBY",
          attributes: { shade: "ruby-red" },
          stock: 25,
          images: [COSMETICS_IMAGES.lipstick],
        },
        {
          variantName: "Nude Blush",
          sku: "COS-LIP-NUDE",
          attributes: { shade: "nude-blush" },
          stock: 30,
          images: [COSMETICS_IMAGES.lipstick],
        },
        {
          variantName: "Coral Pop",
          sku: "COS-LIP-CORAL",
          attributes: { shade: "coral-pop" },
          stock: 18,
          images: [COSMETICS_IMAGES.lipstick],
        },
      ],
      tags: ["cosmetics", "lipstick", "matte"],
    },
    {
      // Single-variant: proves a product needs no multi-value variant axis
      // at all — one "Default" variant still satisfies the schema's
      // "at least one variant" requirement while carrying descriptive
      // (skinType) and derived (shade/volumeMl) attributes together.
      name: "Hydrating Liquid Foundation",
      description: "Buildable, hydrating foundation with a natural satin finish.",
      category: cat("cosmetics-foundation"),
      basePrice: 22,
      images: [COSMETICS_IMAGES.foundation],
      variants: [
        {
          variantName: "Ivory / 30ml",
          sku: "COS-FND-IVORY-30",
          attributes: { shade: "ivory", volumeMl: "30ml" },
          stock: 15,
          images: [COSMETICS_IMAGES.foundation],
        },
      ],
      attributes: attrs([["skinType", ["all"]]]),
      tags: ["cosmetics", "foundation"],
    },
    // --- T-shirt (a new department under the Clothes division) ---
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
    // --- Shoes (new, flat department) ---
    {
      name: "Everyday Canvas Sneakers",
      description: "Lightweight canvas sneakers with a cushioned sole.",
      category: cat("shoes-sneakers"),
      basePrice: 35,
      images: [IMG("Sneakers")],
      variants: [
        {
          variantName: "Black",
          sku: "SHO-SNK-BLK",
          attributes: { color: "black" },
          stock: 20,
          images: [IMG("Sneakers+Black")],
        },
        {
          variantName: "Blue",
          sku: "SHO-SNK-BLU",
          attributes: { color: "blue" },
          stock: 16,
          images: [IMG("Sneakers+Blue")],
        },
      ],
      tags: ["shoes", "sneakers"],
    },
    // --- Sunglasses (new, flat department) ---
    {
      name: "Classic Aviator Sunglasses",
      description: "UV-protective aviator sunglasses with a metal frame.",
      category: cat("sunglasses-aviator"),
      basePrice: 15,
      images: [IMG("Sunglasses")],
      variants: [
        {
          variantName: "Black",
          sku: "SUN-AVI-BLK",
          attributes: { color: "black" },
          stock: 25,
          images: [IMG("Sunglasses+Black")],
        },
      ],
      tags: ["sunglasses", "aviator"],
    },
    // --- Shirts (new department, split into Formal / Casual subsections —
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
    // --- Facewash (new Cosmetics subcategory) — proves a variant's own
    // `price` overrides the product's basePrice per volumeMl, exactly the
    // "100ml vs 200ml, priced differently" case you described. No code
    // change needed for this — services/orderService.js's chargePriceUsd
    // already resolves "variant.price ?? product.basePrice" for every
    // product, this is just real data exercising it.
    {
      name: "Hydrating Gel Facewash",
      description: "Gentle, hydrating gel facewash for daily use — available in two sizes.",
      category: cat("cosmetics-facewash"),
      basePrice: 6,
      images: [IMG("Facewash")],
      variants: [
        {
          variantName: "100ml",
          sku: "COS-FCW-100",
          attributes: { volumeMl: "100ml" },
          stock: 30,
          images: [IMG("Facewash+100ml")],
        },
        {
          variantName: "200ml",
          sku: "COS-FCW-200",
          attributes: { volumeMl: "200ml" },
          price: 10,
          stock: 22,
          images: [IMG("Facewash+200ml")],
        },
      ],
      tags: ["cosmetics", "facewash"],
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
  console.log(
    `Categories: 1 division (Clothes), ${CLOTHES_DEPARTMENTS.length + FLAT_DEPARTMENTS.length} departments, ${bySlug.size} total (division + departments + styles).`,
  );

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
