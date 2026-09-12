import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: [true, "User is required"],
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "products",
      required: [true, "Product is required"],
    },
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: [1, "Rating must be at least 1"],
      max: [5, "Rating cannot exceed 5"],
    },
    title: {
      type: String,
      trim: true,
      maxlength: [100, "Title cannot exceed 100 characters"],
    },
    comment: {
      type: String,
      required: [true, "Review comment is required"],
      trim: true,
    },
    isVerifiedPurchase: {
      type: Boolean,
      default: false,
    },
    images: {
      type: [String],
      default: [],
      validate: [(arr) => arr.length <= 5, "Max 5 images per review"],
    },
    helpfulCount: {
      type: Number,
      default: 0,
    },
    adminReply: {
      text: { type: String, trim: true, default: "" },
      repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
      repliedAt: { type: Date },
    },
  },
  { timestamps: true },
);

// One review per user per product
reviewSchema.index({ user: 1, product: 1 }, { unique: true });

// services/reviewService.js's getProductReviews() — the PDP reviews tab,
// read on every product page view — filters {product} and sorts
// -createdAt. The unique index above has `product` as its SECOND key, so
// it can't serve as a prefix for a product-only filter; without this,
// that query collection-scans and sorts in memory as the reviews
// collection grows.
reviewSchema.index({ product: 1, createdAt: -1 });

// Performance audit Closure Pass 2 — explain("executionStats") evidence
// (scripts/perfSeedAndExplain.mjs, ~400 synthetic reviews) showed the
// unfiltered admin reviews list (services/reviewService.js's
// listAllReviews() with no rating/product filter — the default view)
// examining every document and sorting in memory: 409 examined for 20
// returned, in-memory SORT stage present. This index serves that exact
// shape directly.
reviewSchema.index({ createdAt: -1 });

// Update product's average rating after save
reviewSchema.statics.calcAverageRating = async function (productId) {
  const stats = await this.aggregate([
    { $match: { product: productId } },
    {
      $group: {
        _id: "$product",
        avgRating: { $avg: "$rating" },
        numReviews: { $sum: 1 },
      },
    },
  ]);

  if (stats.length > 0) {
    await mongoose.model("products").findByIdAndUpdate(productId, {
      rating: Math.round(stats[0].avgRating * 10) / 10,
      numReviews: stats[0].numReviews,
    });
  } else {
    await mongoose.model("products").findByIdAndUpdate(productId, {
      rating: 0,
      numReviews: 0,
    });
  }
};

reviewSchema.post("save", function () {
  this.constructor.calcAverageRating(this.product);
});

reviewSchema.post("deleteOne", { document: true }, function () {
  this.constructor.calcAverageRating(this.product);
});

// Guards against Next.js dev's hot-reload (and, as of Phase 7, the build's
// own parallel static-generation workers re-evaluating this module) trying
// to re-register an already-compiled model — same guard every other model
// in this codebase already has.
const reviewModel = mongoose.models.reviews || mongoose.model("reviews", reviewSchema);
export default reviewModel;
