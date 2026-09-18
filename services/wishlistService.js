import Wishlist from "../models/wishlistModel.js";
import Product from "../models/productModel.js";
import { HttpError } from "../lib/http.js";
import { requireObjectIdFormat } from "../lib/validation.js";

// Wishlist is deliberately product-level, not variant-level — a saved item
// represents interest in the product, not a selected purchase variant.

async function getOrCreateWishlist(userId) {
  let wl = await Wishlist.findByUser(userId);
  if (!wl) wl = await Wishlist.create(userId);
  return wl;
}

export async function getWishlist(userId) {
  const wl = await getOrCreateWishlist(userId);
  return Wishlist.populate(wl);
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
  return { added, wishlist: await Wishlist.populate(wl) };
}

export async function clearWishlist(userId) {
  const wl = await getOrCreateWishlist(userId);
  wl.products = [];
  await wl.save();
  return wl;
}
