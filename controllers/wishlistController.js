import asyncHandler from "../middleware/asyncHandler.js";
import Wishlist from "../models/wishlistModel.js";
import Product from "../models/productModel.js";

// @desc    Get my wishlist
// @route   GET /api/wishlist
// @access  Private
export const getWishlist = asyncHandler(async (req, res) => {
  let wl = await Wishlist.findOne({ user: req.user._id }).populate(
    "products",
    "name images basePrice discountPrice slug rating",
  );
  if (!wl) wl = await Wishlist.create({ user: req.user._id, products: [] });
  res.json({ success: true, wishlist: wl });
});

// @desc    Toggle product in wishlist
// @route   POST /api/wishlist/:productId
// @access  Private
export const toggleWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const product = await Product.findById(productId);
  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  let wl = await Wishlist.findOne({ user: req.user._id });
  if (!wl) wl = await Wishlist.create({ user: req.user._id, products: [] });

  const idx = wl.products.findIndex((p) => p.toString() === productId);
  if (idx >= 0) {
    wl.products.splice(idx, 1);
  } else {
    wl.products.push(productId);
  }
  await wl.save();
  res.json({ success: true, added: idx < 0, wishlist: wl });
});

// @desc    Clear wishlist
// @route   DELETE /api/wishlist
// @access  Private
export const clearWishlist = asyncHandler(async (req, res) => {
  const wl = await Wishlist.findOne({ user: req.user._id });
  if (wl) {
    wl.products = [];
    await wl.save();
  }
  res.json({ success: true, message: "Wishlist cleared" });
});
