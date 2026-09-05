import Wishlist from "../models/wishlistModel.js";
import Product from "../models/productModel.js";
// Not referenced directly — imported so mongoose.model("brands", ...) is
// registered before the nested populate below runs. Same reasoning as
// productService.js / cartService.js.
// categoryModel.js is already registered as a side effect of productModel.js
// importing it directly (used in its own pre-validate hook), so no separate
// import is needed here for the nested category populate below.
import "../models/brandModel.js";
import { HttpError } from "../lib/http.js";
import { requireObjectIdFormat } from "../lib/validation.js";

// Wishlist is deliberately product-level, not variant-level — a saved item
// represents interest in the product, not a selected purchase variant, so
// this never touches product.variants[] for identity, only for the display
// fields ProductCard.jsx already reads off a plain product.
const PRODUCT_SELECT = "name images slug category attributes variants availability basePrice discountPrice brand";

async function getOrCreateWishlist(userId) {
  let wl = await Wishlist.findOne({ user: userId });
  if (!wl) wl = await Wishlist.create({ user: userId, products: [] });
  return wl;
}

// ProductCard.jsx renders category.name and brand.name directly, so both
// need their own nested populate, not just the raw ids the top-level
// PRODUCT_SELECT pulls in.
async function populateWishlist(wl) {
  return wl.populate({
    path: "products",
    select: PRODUCT_SELECT,
    populate: [
      { path: "category", select: "name slug" },
      { path: "brand", select: "name slug" },
    ],
  });
}

export async function getWishlist(userId) {
  const wl = await getOrCreateWishlist(userId);
  await populateWishlist(wl);
  return wl;
}

export async function toggleWishlist(userId, productId) {
  requireObjectIdFormat(productId, "productId");
  const product = await Product.findById(productId);
  if (!product) throw new HttpError(404, "Product not found");

  const wl = await getOrCreateWishlist(userId);
  const idx = wl.products.findIndex((p) => String(p) === String(productId));

  let added;
  if (idx >= 0) {
    // Already saved — toggling removes it. This is also what makes a
    // duplicate save structurally impossible: the same productId can never
    // appear twice, since adding only ever happens from the "not present"
    // branch.
    wl.products.splice(idx, 1);
    added = false;
  } else {
    wl.products.push(productId);
    added = true;
  }

  await wl.save();
  await populateWishlist(wl);
  return { added, wishlist: wl };
}

export async function clearWishlist(userId) {
  const wl = await getOrCreateWishlist(userId);
  wl.products = [];
  await wl.save();
  return wl;
}
