import asyncHandler from "../middleware/asyncHandler.js";
import Cart from "../models/cartModel.js";
import Product from "../models/productModel.js";

// Helper: find size-stock entry
const findSizeStock = (product, size) =>
  product?.sizes?.find((s) => s.size === size);

// @desc    Get current user's cart
// @route   GET /api/cart
// @access  Private
export const getCart = asyncHandler(async (req, res) => {
  let cart = await Cart.findOne({ user: req.user._id }).populate(
    "items.product",
    "name images basePrice discountPrice slug sizes isActive",
  );
  if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });
  res.json({ success: true, cart });
});

// @desc    Add/update item
// @route   POST /api/cart
// @access  Private
export const addToCart = asyncHandler(async (req, res) => {
  const { productId, size, quantity = 1 } = req.body;

  const product = await Product.findById(productId);
  if (!product || !product.isActive) {
    res.status(404);
    throw new Error("Product not found");
  }
  if (!Array.isArray(product.sizes)) {
    res.status(400);
    throw new Error("Product has no size information");
  }

  const sizeStock = findSizeStock(product, size);
  if (!sizeStock) {
    res.status(400);
    throw new Error(`Size ${size} not available for this product`);
  }
  if (quantity > sizeStock.stock) {
    res.status(400);
    throw new Error(`Only ${sizeStock.stock} in stock for size ${size}`);
  }

  let cart = await Cart.findOne({ user: req.user._id });
  if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });

  const idx = cart.items.findIndex(
    (i) => i.product?.toString() === productId && i.size === size,
  );

  if (idx >= 0) {
    const newQty = cart.items[idx].quantity + Number(quantity);
    if (newQty > sizeStock.stock) {
      res.status(400);
      throw new Error(`Only ${sizeStock.stock} in stock`);
    }
    cart.items[idx].quantity = newQty;
  } else {
    cart.items.push({
      product: productId,
      size,
      quantity: Number(quantity),
    });
  }

  await cart.save();
  await cart.populate(
    "items.product",
    "name images basePrice discountPrice slug",
  );
  res.json({ success: true, cart });
});

// @desc    Update item quantity
// @route   PUT /api/cart
// @access  Private
export const updateCartItem = asyncHandler(async (req, res) => {
  const { productId, size, quantity } = req.body;
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    res.status(404);
    throw new Error("Cart not found");
  }

  const idx = cart.items.findIndex(
    (i) => i.product?.toString() === productId && i.size === size,
  );
  if (idx < 0) {
    // Idempotent delete: if quantity <= 0 and item is already gone, desired state is achieved
    if (quantity <= 0) {
      await cart.populate(
        "items.product",
        "name images basePrice discountPrice slug",
      );
      return res.json({ success: true, cart });
    }
    res.status(404);
    throw new Error("Item not in cart");
  }

  if (quantity <= 0) {
    cart.items.splice(idx, 1);
  } else {
    const product = await Product.findById(productId);
    if (!product) {
      res.status(404);
      throw new Error("Product not found");
    }
    if (!Array.isArray(product.sizes)) {
      res.status(400);
      throw new Error("Product has no size information");
    }
    const sizeStock = findSizeStock(product, size);
    if (!sizeStock || quantity > sizeStock.stock) {
      res.status(400);
      throw new Error("Not enough stock");
    }
    cart.items[idx].quantity = Number(quantity);
  }

  await cart.save();
  await cart.populate(
    "items.product",
    "name images basePrice discountPrice slug",
  );
  res.json({ success: true, cart });
});

// @desc    Remove item
// @route   DELETE /api/cart/:productId/:size
// @access  Private
export const removeFromCart = asyncHandler(async (req, res) => {
  const { productId, size } = req.params;
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) {
    res.status(404);
    throw new Error("Cart not found");
  }
  cart.items = cart.items.filter(
    (i) => !(i.product?.toString() === productId && i.size === size),
  );
  await cart.save();
  res.json({ success: true, cart });
});

// @desc    Clear cart
// @route   DELETE /api/cart
// @access  Private
export const clearCart = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (cart) {
    cart.items = [];
    await cart.save();
  }
  res.json({ success: true, message: "Cart cleared" });
});
