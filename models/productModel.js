import mongoose from "mongoose";
import slugify from "slugify";

import Category from "./categoryModel.js";

const variantSchema = new mongoose.Schema({
  // Admin-facing label, e.g. "Black / XL / Nida". Kept as its own field
  // (rather than composed on the fly) so it can be edited independently of
  // the underlying attribute values.
  variantName: {
    type: String,
    required: [true, "Variant name is required"],
    trim: true,
  },
  sku: {
    type: String,
    required: [true, "Variant SKU is required"],
    trim: true,
  },
  attributes: {
    color: { type: String, default: "" },
    // Also carries "length" values for categories where size and length are
    // the same dimension (Khimar, Burqa) — see AttributeDefinition.labelOverrides.
    size: { type: String, default: "" },
    fabric: { type: String, default: "" },
  },
  // Overrides — effective price = price ?? product.basePrice, and the same
  // for discountPrice. Absent (null) means "use the product's price."
  price: {
    type: Number,
    default: null,
    min: [0, "Price cannot be negative"],
  },
  discountPrice: {
    type: Number,
    default: null,
    min: [0, "Discount price cannot be negative"],
  },
  stock: {
    type: Number,
    required: true,
    min: [0, "Stock cannot be negative"],
    default: 0,
  },
  images: {
    type: [String],
    default: [],
  },
});

const attributeValueSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    values: { type: [String], default: [] },
  },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    // Optional Bangla mirror of `name` — see productService.js's
    // localizeProduct(). Never required, never auto-populated from `name`;
    // admins fill it in via the product form. Absent/empty means the
    // storefront falls back to the English `name` rather than showing a
    // blank title, even with Bangla active.
    nameBn: {
      type: String,
      trim: true,
      default: "",
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      index: true,
    },
    description: {
      type: String,
      required: [true, "Product description is required"],
    },
    // Optional Bangla mirror of `description` — same fallback rule as
    // nameBn.
    descriptionBn: {
      type: String,
      default: "",
    },
    // The specific leaf/subcategory (e.g. "Open-front Abaya").
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "categories",
      required: [true, "Category is required"],
    },
    // Denormalized top-level ancestor (e.g. "Abaya"), auto-set from
    // category.parent so "/shop?category=abaya" can query every subcategory
    // under it with one indexed lookup instead of a join at request time.
    topCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "categories",
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "brands",
      default: null,
    },
    // Burqa/Hijab-appropriate age classification — not a sneaker-style
    // "gender" field. "girls" was added alongside the existing "adult"/
    // "kids" values (kept as-is so existing product data stays valid).
    ageGroup: {
      type: String,
      enum: ["adult", "kids", "girls"],
      default: "adult",
    },
    basePrice: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
    },
    discountPrice: {
      type: Number,
      default: null,
    },
    images: {
      type: [String],
      required: [true, "At least one image is required"],
      validate: [(arr) => arr.length > 0, "At least one image is required"],
    },
    variants: {
      type: [variantSchema],
      required: [true, "At least one variant is required"],
      validate: [(arr) => arr.length > 0, "At least one variant is required"],
    },
    // Denormalized filter facets: color/size/fabric synced automatically
    // from `variants` (see pre-save hook below), plus category-specific
    // descriptive attributes set directly by the admin (coverageLevel,
    // closure, opacity, lining, occasion, careInstructions).
    attributes: {
      type: [attributeValueSchema],
      default: [],
    },
    measurements: {
      heightRange: { type: String, default: "" },
      chest: { type: String, default: "" },
      sleeveLength: { type: String, default: "" },
    },
    // Bundle contents, e.g. a Modest Set: ["Abaya", "Matching Hijab", "Belt"].
    includedItems: {
      type: [String],
      default: [],
    },
    availability: {
      type: String,
      enum: ["readyStock", "preOrder", "madeToOrder"],
      default: "readyStock",
    },
    tags: {
      type: [String],
      default: [],
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    numReviews: {
      type: Number,
      default: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// Virtual: total stock across all variants
productSchema.virtual("totalStock").get(function () {
  return this.variants.reduce((sum, v) => sum + v.stock, 0);
});

// Index for search and filtering
// "attributes.values" lets a free-text search for "nida" or "eid" surface
// fabric/occasion matches, not just name/description/tags. Note: MongoDB
// allows only one text index per collection — changing which fields it
// covers requires dropping and recreating the index on the live database,
// not just editing this schema (see scripts/seedCatalog.mjs's syncIndexes
// call, which handles this).
productSchema.index({ name: "text", description: "text", tags: "text", "attributes.values": "text" });
productSchema.index({ category: 1, topCategory: 1, ageGroup: 1 });
productSchema.index({ basePrice: 1 });
// Default list view sorts by -createdAt and filters by isActive
productSchema.index({ isActive: 1, createdAt: -1 });
// Featured carousel: { isFeatured, isActive } + sort by -rating
productSchema.index({ isFeatured: 1, isActive: 1, rating: -1 });
// Facet filter queries: { attributes: { $elemMatch: { key, values } } }
productSchema.index({ "attributes.key": 1, "attributes.values": 1 });
// Prefix search on name (uses index when anchored with ^)
productSchema.index({ name: 1 });

const dedupe = (arr) => [...new Set(arr.filter((v) => v != null && v !== ""))];

productSchema.pre("validate", async function () {
  // Auto-generate slug from name
  if (this.isModified("name") || !this.slug) {
    const base = slugify(this.name, { lower: true, strict: true });
    // Append short id tail to guarantee uniqueness
    this.slug = `${base}-${this._id.toString().slice(-6)}`;
  }

  // Walk category.parent to denormalize the top-level ancestor.
  if (this.isModified("category") || !this.topCategory) {
    const category = await Category.findById(this.category).lean();
    this.topCategory = category?.parent ?? category?._id ?? this.category;
  }

  // Sync color/size/fabric facets from the variant list; merge with (never
  // overwrite) the admin-set descriptive attributes.
  const derived = {
    color: dedupe(this.variants.map((v) => v.attributes?.color)),
    size: dedupe(this.variants.map((v) => v.attributes?.size)),
    fabric: dedupe(this.variants.map((v) => v.attributes?.fabric)),
  };
  const byKey = new Map(this.attributes.map((a) => [a.key, a.values]));
  for (const [key, values] of Object.entries(derived)) {
    if (values.length) byKey.set(key, values);
  }
  this.attributes = [...byKey.entries()].map(([key, values]) => ({ key, values }));
});

// Guards against Next.js dev's hot-reload re-executing this module and
// trying to re-register an already-compiled model.
const productModel = mongoose.models.products || mongoose.model("products", productSchema);
export default productModel;
