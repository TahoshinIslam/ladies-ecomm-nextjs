import mongoose from "mongoose";
import slugify from "slugify";

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
    },
    // Optional Bangla mirror of `name` — see categoryService.js's
    // localizeCategory(). Absent/empty falls back to the English `name`,
    // never a blank label. Slugs/ids stay English-only and stable — see
    // section 7 of the localization audit for why filter values never
    // translate.
    nameBn: {
      type: String,
      trim: true,
      default: "",
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    // null = one of the top-level departments (Burqa, Hijab, Niqab, Abaya,
    // Khimar, Modest Sets); set = a subcategory/style under that department.
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "categories",
      default: null,
    },
    image: {
      type: String,
      default: "",
    },
    // A lucide-react icon name (e.g. "utensils-crossed"), used only for a
    // top-level department's row in the mega-menu category flyout
    // (components/layout/CategoryMegaMenu.jsx maps this string to the
    // actual icon component — never rendered as raw HTML). Empty for every
    // non-top-level category; the flyout falls back to a generic icon when
    // a department has none set.
    icon: {
      type: String,
      default: "",
    },
    description: {
      type: String,
      default: "",
    },
    // Optional Bangla mirror of `description` — same fallback rule as nameBn.
    descriptionBn: {
      type: String,
      default: "",
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

categorySchema.index({ parent: 1, sortOrder: 1 });

// Auto-generate slug from name if one wasn't explicitly provided (the seed
// script sets stable slugs directly via findOneAndUpdate, which bypasses
// this hook entirely — this only matters for Category.create()/.save(),
// i.e. the admin API). Mirrors productModel.js's pattern.
categorySchema.pre("validate", function () {
  if (this.isModified("name") || !this.slug) {
    const base = slugify(this.name, { lower: true, strict: true });
    this.slug = `${base}-${this._id.toString().slice(-6)}`;
  }
});

// mongoose.models.categories || ... guards against Next.js dev's hot-reload
// re-executing this module and trying to re-register an already-compiled
// model (throws OverwriteModelError otherwise).
const categoryModel = mongoose.models.categories || mongoose.model("categories", categorySchema);
export default categoryModel;
