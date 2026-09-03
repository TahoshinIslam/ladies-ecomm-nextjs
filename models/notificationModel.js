import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      default: "",
      trim: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// Fast queries for unread counts and paginated lists
notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });

// Guards against Next.js dev's hot-reload re-executing this module and
// trying to re-register an already-compiled model.
const notificationModel = mongoose.models.notifications || mongoose.model("notifications", notificationSchema);
export default notificationModel;
