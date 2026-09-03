import mongoose from "mongoose";

// Snapshot at add-time — mirrors store/guestCartSlice.js's snapshotVariant
// on the client, so a cart line still prices and displays correctly even
// if the product's variant changes later (price update, restock, etc).
const cartItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "products",
      required: [true, "Product is required"],
    },
    // Not a `ref` — variants are subdocuments inside Product.variants, not
    // a top-level collection, so there's nothing to .populate() here. This
    // is matched by exact ObjectId equality against product.variants[]._id.
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Variant is required"],
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be at least 1"],
      default: 1,
    },
    snapshot: {
      sku: { type: String, default: "" },
      color: { type: String, default: "" },
      size: { type: String, default: "" },
      fabric: { type: String, default: "" },
      price: { type: Number, default: null },
      image: { type: String, default: "" },
    },
  },
  { timestamps: true },
);

const cartSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: [true, "User is required"],
      unique: true, // one cart per user
    },
    items: {
      type: [cartItemSchema],
      default: [],
    },
  },
  { timestamps: true },
);

// Virtual: total number of items in cart
cartSchema.virtual("totalItems").get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

// Guards against Next.js dev's hot-reload re-executing this module and
// trying to re-register an already-compiled model.
const cartModel = mongoose.models.carts || mongoose.model("carts", cartSchema);
export default cartModel;
