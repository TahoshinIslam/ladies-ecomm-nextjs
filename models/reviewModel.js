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

const reviewModel = mongoose.model("reviews", reviewSchema);
export default reviewModel;
