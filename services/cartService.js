import Cart from "../models/cartModel.js";
import Product from "../models/productModel.js";
import { HttpError } from "../lib/http.js";
import { requireObjectIdFormat } from "../lib/validation.js";

function findVariant(product, variantId) {
  return product.variants.find((v) => String(v._id) === String(variantId));
}

function snapshotVariant(variant) {
  return {
    sku: variant.sku || "",
    attributes: { ...variant.attributes },
    price: variant.price ?? null,
    image: variant.images?.[0] || "",
  };
}

async function getOrCreateCart(userId) {
  let cart = await Cart.findByUser(userId);
  if (!cart) cart = await Cart.create(userId);
  return cart;
}

function sameItem(item, productId, variantId) {
  return String(item.productId) === String(productId) && String(item.variantId) === String(variantId);
}

// Reshapes a raw Cart into the shape the frontend already consumes
// (hooks/useCart.js just passes this straight through to CartDrawer.jsx /
// app/(routes)/cart/page.jsx, which read item.product / item.variantId /
// item.variant — the same shape store/guestCartSlice.js produces for the
// guest cart).
async function serializeCart(cart) {
  const productIds = [...new Set(cart.items.map((i) => String(i.productId)))];
  const products = productIds.length ? await Product.findByIds(productIds) : [];
  const byId = new Map(products.map((p) => [String(p._id), p]));
  return {
    _id: cart._id,
    items: cart.items.map((item) => {
      const product = byId.get(String(item.productId));
      return {
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        product: product
          ? { _id: product._id, name: product.name, slug: product.slug, images: product.images, basePrice: product.basePrice, discountPrice: product.discountPrice, priceCurrency: product.priceCurrency, brand: product.brand, isActive: product.isActive }
          : null,
        variant: item.snapshot,
      };
    }),
  };
}

export async function getCart(userId) {
  const cart = await getOrCreateCart(userId);
  return serializeCart(cart);
}

export async function addToCart(userId, productId, variantId, quantity = 1) {
  requireObjectIdFormat(productId, "productId");
  requireObjectIdFormat(variantId, "variantId");
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
    existing.quantity = desiredQty;
    existing.snapshot = snapshotVariant(variant);
  } else {
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
  requireObjectIdFormat(productId, "productId");
  requireObjectIdFormat(variantId, "variantId");
  const qty = Number(quantity);
  const cart = await getOrCreateCart(userId);
  const idx = cart.items.findIndex((i) => sameItem(i, productId, variantId));

  if (idx < 0) {
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
  requireObjectIdFormat(productId, "productId");
  requireObjectIdFormat(variantId, "variantId");
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
