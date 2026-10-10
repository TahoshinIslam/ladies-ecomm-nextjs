import Cart from "../models/cartModel.js";
import Product from "../models/productModel.js";
import * as Inventory from "../models/inventoryModel.js";
import { HttpError } from "../lib/http.js";
import { groupSegmentsByPrice } from "../lib/batchPricing.js";
import { requireObjectIdFormat } from "../lib/validation.js";
import { formatQuantity, isOrderableQuantity, orderStep, roundQuantity } from "../lib/measure.js";

// What an amount must look like for this variant, in words a shopper can act on.
function stepMessage(variant) {
  const step = orderStep(variant);
  return step === 1 && (!variant.unit || variant.unit === "pc")
    ? "Quantity must be a whole number"
    : `Order in steps of ${formatQuantity(step, variant.unit)}`;
}

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

function variantMeasure(product, variantId) {
  const variant = product ? findVariant(product, variantId) : null;
  return variant ? { unit: variant.unit || "pc", step: orderStep(variant), packs: variant.packs || [] } : null;
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
        // How this item is counted and stepped (items sold by measure), from the live catalog; absent when it is gone.
        measure: variantMeasure(product, item.variantId),
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
  if (!(qty > 0)) {
    throw new HttpError(400, "Quantity must be a positive number");
  }

  const product = await Product.findById(productId);
  if (!product || !product.isActive) throw new HttpError(404, "Product not found");

  const variant = findVariant(product, variantId);
  if (!variant) throw new HttpError(404, "Variant not found");
  if (!isOrderableQuantity(variant, qty)) throw new HttpError(400, stepMessage(variant));

  const cart = await getOrCreateCart(userId);
  const existing = cart.items.find((i) => sameItem(i, productId, variantId));
  const desiredQty = roundQuantity((existing?.quantity || 0) + qty);

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
    if (!isOrderableQuantity(variant, qty)) throw new HttpError(400, stepMessage(variant));
    if (qty > variant.stock) throw new HttpError(400, `Only ${variant.stock} in stock`);
    cart.items[idx].quantity = roundQuantity(qty);
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

/**
 * Is each item in a bag still for sale, in the quantity asked for?
 *
 * The website shows the products the dashboard's Product Source Store offers,
 * with that store's availability, so a bag that was filled before the store was
 * switched (or before stock moved) can hold things that are no longer offered or
 * no longer there. This answers per item, with a sentence a shopper can act on:
 *
 *   ok            nothing to say
 *   limited       fewer available than the bag holds — says how many
 *   out_of_stock  offered, but none available right now
 *   unavailable   not offered online any more
 *
 * It reads the same catalog the shop pages do (variants the source store does
 * not offer are not loaded at all), so what a shopper is told here and what
 * checkout enforces cannot disagree. Prices are the products' own and do not
 * depend on the source store, so a switch never changes a price.
 */
export async function checkItems(items) {
  const productIds = [...new Set(items.map((i) => String(i.productId)))];
  const products = await Product.findByIds(productIds);
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const out = [];
  for (const item of items) {
    const base = { productId: item.productId, variantId: item.variantId, quantity: item.quantity };
    const product = byId.get(String(item.productId));
    if (!product || !product.isActive) { out.push({ ...base, status: "unavailable", available: 0, message: "This item is no longer available." }); continue; }
    const variant = findVariant(product, item.variantId);
    if (!variant) { out.push({ ...base, status: "unavailable", available: 0, message: "This item is no longer available from our online store." }); continue; }
    const available = Math.max(0, Number(variant.stock) || 0);
    if (available <= 0) { out.push({ ...base, status: "out_of_stock", available, message: "Out of stock right now." }); continue; }
    if (available < item.quantity) { out.push({ ...base, status: "limited", available, message: `Only ${available} available — lower the quantity to continue.` }); continue; }
    out.push({ ...base, status: "ok", available, ...(await priceBreakdown(product, variant, item.quantity)) });
  }
  return out;
}

/**
 * What this quantity would cost, by price: the units checkout would take, batch by batch, grouped by the price
 * they sell at — [{ quantity, unitPrice }] and the line total. A shopper whose quantity spans two prices sees
 * "5 × ৳500 + 3 × ৳550" here, before they confirm anything. A plain read: nothing is reserved, and no batch,
 * lot or cost is returned. Absent when the quantity cannot be priced from stock right now (checkout will say so).
 */
async function priceBreakdown(product, variant, quantity) {
  // A product still priced in USD is converted at checkout, not shown in taka here.
  if (product.priceCurrency !== "BDT") return {};
  try {
    const plan = await Inventory.planOrder(null, [{ variantId: variant._id, productId: product._id, quantity, tracking: variant.tracking, sku: variant.sku || "" }]);
    const promotional = (variant.discountPrice ?? product.discountPrice) != null;
    const batchPriced = product.priceCurrency === "BDT" && !promotional;
    const flat = Math.round((variant.discountPrice ?? product.discountPrice ?? variant.listPrice ?? variant.price ?? product.basePrice) + Number.EPSILON);
    const groups = groupSegmentsByPrice(plan.lines[0].segments, (seg) => (batchPriced ? Math.round(seg.sellingPrice + Number.EPSILON) : flat));
    const segments = groups.map((g) => ({ quantity: g.quantity, unitPrice: g.unitPrice }));
    return { segments, lineTotal: segments.reduce((sum, g) => sum + Math.round(g.unitPrice * g.quantity + Number.EPSILON), 0) };
  } catch (err) {
    if (err instanceof Inventory.InsufficientStockError) return {};
    throw err;
  }
}
