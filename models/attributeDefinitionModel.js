import mongoose from "mongoose";

const optionSchema = new mongoose.Schema(
  {
    value: { type: String, required: true },
    label: { type: String, required: true },
    swatchHex: { type: String, default: "" },
  },
  { _id: false },
);

const labelOverrideSchema = new mongoose.Schema(
  {
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "categories",
      required: true,
    },
    label: { type: String, required: true },
  },
  { _id: false },
);

// Drives both the admin product form and the dynamic filter panel: which
// attributes render for a given top-level category, in what shape, and
// under what label. Nothing about the filter UI is hardcoded per-category —
// it all reads from this collection.
const attributeDefinitionSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, "Attribute key is required"],
      unique: true,
      // No `lowercase: true` here deliberately: this key must match
      // Product.attributes[].key byte-for-byte (e.g. "coverageLevel"), and
      // that field isn't case-normalized either.
      trim: true,
    },
    label: {
      type: String,
      required: [true, "Attribute label is required"],
    },
    // Per-top-level-category display label override, e.g. "size" reads as
    // "Length" for Burqa/Khimar but stays "Size" everywhere else.
    labelOverrides: {
      type: [labelOverrideSchema],
      default: [],
    },
    type: {
      type: String,
      enum: ["select", "swatch", "boolean", "text"],
      required: true,
    },
    // Unused for type "text" / "boolean".
    options: {
      type: [optionSchema],
      default: [],
    },
    // Top-level category ids this attribute applies to. Empty = universal
    // (shown regardless of selected category, e.g. color/size/occasion).
    appliesToCategories: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "categories" }],
      default: [],
    },
    // true for color/size/fabric: their values are synced from
    // product.variants rather than hand-entered on the product form.
    derivedFromVariant: {
      type: Boolean,
      default: false,
    },
    filterable: {
      type: Boolean,
      default: true,
    },
    required: {
      type: Boolean,
      default: false,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

attributeDefinitionSchema.index({ appliesToCategories: 1 });

// Guards against Next.js dev's hot-reload re-executing this module and
// trying to re-register an already-compiled model.
const attributeDefinitionModel =
  mongoose.models.attributedefinitions ||
  mongoose.model("attributedefinitions", attributeDefinitionSchema);
export default attributeDefinitionModel;
