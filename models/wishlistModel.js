import mongoose from "mongoose";

const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: [true, "User is required"],
      unique: true, // one wishlist per user
    },
    products: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "products",
      },
    ],
  },
  { timestamps: true },
);

// Guards against Next.js dev's hot-reload re-executing this module and
// trying to re-register an already-compiled model.
const wishlistModel = mongoose.models.wishlists || mongoose.model("wishlists", wishlistSchema);
export default wishlistModel;
