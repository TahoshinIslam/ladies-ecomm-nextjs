import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "products",
      required: [true, "Product is required"],
    },
    name: { type: String, required: true },
    image: { type: String, required: true },
    size: { type: String, required: [true, "Size is required"] },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be at least 1"],
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
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

const Order = mongoose.model("orders", orderSchema);
export default Order;
