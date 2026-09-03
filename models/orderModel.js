import mongoose from "mongoose";

// Snapshot at order-creation time — mirrors the cart item shape from
// Phase 5A (models/cartModel.js), so an order line stays correct even if
// the product/variant changes later. `variantId` (not a bare size string)
// is what makes this line uniquely identifiable, same reasoning as cart.
const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "products",
      required: [true, "Product is required"],
    },
    // Not a `ref` — variants are subdocuments inside Product.variants, not
    // a top-level collection.
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Variant is required"],
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be at least 1"],
    },
    snapshot: {
      name: { type: String, required: [true, "Product name is required"] },
      sku: { type: String, default: "" },
      color: { type: String, default: "" },
      size: { type: String, default: "" },
      fabric: { type: String, default: "" },
      price: { type: Number, required: [true, "Price is required"] },
      image: { type: String, default: "" },
    },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: [true, "User is required"],
    },
    items: {
      type: [orderItemSchema],
      required: [true, "Order must have items"],
      validate: [(arr) => arr.length > 0, "Order must have at least one item"],
    },
    shippingAddress: {
      fullName: { type: String, required: true },
      phone: { type: String, required: true },
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, default: "" },
      postalCode: { type: String, required: true },
      country: { type: String, required: true },
    },
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "coupons",
      default: null,
    },

    // --- Pricing breakdown (all in `currency` below) ---
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    taxLabel: { type: String, default: "" }, // "VAT 15%" — for receipts
    shippingCost: { type: Number, default: 0 },
    shippingTier: { type: String, default: "" }, // "Inside Dhaka"
    discount: { type: Number, default: 0 },
    total: { type: Number, required: true },

    // --- Region + currency snapshot ---
    region: { type: String, default: "BD", enum: ["BD", "INTL"] },
    currency: { type: String, default: "BDT", enum: ["BDT", "USD"] },

    // --- Status ---
    status: {
      type: String,
      enum: [
        "pending",
        "paid",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ],
      default: "pending",
    },
    paymentMethod: { type: String, default: "" },
    trackingNumber: { type: String, default: "" },
    deliveredAt: { type: Date },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

// Index for the most common admin query
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ user: 1, createdAt: -1 });

// Guards against Next.js dev's hot-reload re-executing this module and
// trying to re-register an already-compiled model.
const Order = mongoose.models.orders || mongoose.model("orders", orderSchema);
export default Order;
