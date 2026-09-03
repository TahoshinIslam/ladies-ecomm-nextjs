import Cart from "../models/cartModel.js";
import Product from "../models/productModel.js";
// Not referenced directly — imported so mongoose.model("brands", ...) is
// registered before .populate("productId", "...brand...") runs (Mongoose
// needs the schema registered somewhere in the process, and nothing else
// in this route's module graph otherwise loads it). Same reasoning as
// productService.js.
import "../models/brandModel.js";
import { HttpError } from "../lib/http.js";

const PRODUCT_SELECT = "name slug images basePrice discountPrice brand isActive";

function findVariant(product, variantId) {
  return product.variants.find((v) => String(v._id) === String(variantId));
}

function snapshotVariant(variant) {
  return {
    sku: variant.sku || "",
    color: variant.attributes?.color || "",
    size: variant.attributes?.size || "",
    fabric: variant.attributes?.fabric || "",
    price: variant.price ?? null,
    image: variant.images?.[0] || "",
  };
}

async function getOrCreateCart(userId) {
  let cart = await Cart.findOne({ userId });
  if (!cart) cart = await Cart.create({ userId, items: [] });
  return cart;
}

function sameItem(item, productId, variantId) {
  return String(item.productId) === String(productId) && String(item.variantId) === String(variantId);
}

// Reshapes a raw Cart document into the shape the frontend already
// consumes (hooks/useCart.js just passes this straight through to
// CartDrawer.jsx / app/(routes)/cart/page.jsx, which read item.product /
// item.variantId / item.variant — the same shape store/guestCartSlice.js
// produces for the guest cart). DB field names (productId/snapshot) stay
// as specified; only the API response is aliased.
async function serializeCart(cart) {
  await cart.populate("items.productId", PRODUCT_SELECT);
  return {
    _id: cart._id,
    items: cart.items.map((item) => ({
      productId: item.productId?._id ?? item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      product: item.productId?.name ? item.productId : null,
      variant: item.snapshot,
    })),
  };
}

export async function getCart(userId) {
  const cart = await getOrCreateCart(userId);
  return serializeCart(cart);
}

export async function addToCart(userId, productId, variantId, quantity = 1) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    throw new HttpError(400, "Quantity must be a positive integer");
  }

  const product = await Product.findById(productId);
  if (!product || !product.isActive) throw new HttpError(404, "Product not found");

  const variant = findVariant(product, variantId);
  if (!variant) throw new HttpError(404, "Variant not found");

  const cart = await getOrCreateCart(userId);
  const existing = cart.items.find((i) => sameItem(i, productId, variantId));
  const desiredQty = (existing?.quantity || 0) + qty;

  if (desiredQty > variant.stock) {
    throw new HttpError(400, `Only ${variant.stock} in stock for this variant`);
  }

  if (existing) {
    // Merge into the same line — same product AND same variant.
    existing.quantity = desiredQty;
    existing.snapshot = snapshotVariant(variant);
  } else {
    // A different variant of the same product (or a different product
    // entirely) always gets its own line — never merged with an existing one.
    cart.items.push({
      productId,
      variantId,
      quantity: qty,
      snapshot: snapshotVariant(variant),
    });
  }

  await cart.save();
  return serializeCart(cart);
}

export async function updateCartItem(userId, productId, variantId, quantity) {
  const qty = Number(quantity);
  const cart = await getOrCreateCart(userId);
  const idx = cart.items.findIndex((i) => sameItem(i, productId, variantId));

  if (idx < 0) {
    // Idempotent delete: if quantity <= 0 and the item is already gone,
    // the desired end state is already achieved.
    if (qty <= 0) return serializeCart(cart);
    throw new HttpError(404, "Item not in cart");
  }

  if (qty <= 0) {
    cart.items.splice(idx, 1);
  } else {
    const product = await Product.findById(productId);
    if (!product) throw new HttpError(404, "Product not found");
    const variant = findVariant(product, variantId);
    if (!variant) throw new HttpError(404, "Variant not found");
    if (qty > variant.stock) throw new HttpError(400, `Only ${variant.stock} in stock`);
    cart.items[idx].quantity = qty;
    cart.items[idx].snapshot = snapshotVariant(variant);
  }

  await cart.save();
  return serializeCart(cart);
}

export async function removeCartItem(userId, productId, variantId) {
  const cart = await getOrCreateCart(userId);
  cart.items = cart.items.filter((i) => !sameItem(i, productId, variantId));
  await cart.save();
  return serializeCart(cart);
}

export async function clearCart(userId) {
  const cart = await getOrCreateCart(userId);
  cart.items = [];
  await cart.save();
  return serializeCart(cart);
}
