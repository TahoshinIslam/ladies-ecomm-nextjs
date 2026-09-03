import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "orders",
      required: [true, "Order is required"],
      unique: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: [true, "User is required"],
    },
    method: {
      type: String,
      enum: ["stripe", "sslcommerz", "bkash", "nagad", "cod"],
      required: [true, "Payment method is required"],
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
    },
    transactionId: {
      // ID returned by the payment gateway
      type: String,
      default: "",
    },
    gatewayResponse: {
      // raw response from the gateway for debugging/auditing
      type: mongoose.Schema.Types.Mixed,
      default: {},
      select: false,
    },
    amount: {
      type: Number,
      required: [true, "Payment amount is required"],
    },
    currency: {
      type: String,
      default: "BDT",
    },
    paidAt: {
      type: Date,
    },
    refundedAt: {
      type: Date,
    },
    refundReason: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

const paymentModel = mongoose.model("payments", paymentSchema);
export default paymentModel;
