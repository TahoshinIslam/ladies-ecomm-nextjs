import mongoose from "mongoose";
import asyncHandler from "../middleware/asyncHandler.js";
import Order from "../models/orderModel.js";
import Product from "../models/productModel.js";
import Coupon from "../models/couponModel.js";
import Cart from "../models/cartModel.js";
import Payment from "../models/paymentModel.js";
import Settings from "../models/settingsModel.js";
import User from "../models/userModel.js";
import { createAdminNotification } from "../controllers/notificationController.js";

const regionFromCountry = (country) => {
  const c = String(country || "").toUpperCase();
  if (c === "BD" || c === "BANGLADESH") return "BD";
  return "INTL";
};

const toRegionCurrency = (usdPrice, region, settings) => {
  if (region === "BD") return Math.round(usdPrice * settings.currency.usdToBdt);
  return usdPrice;
};

const calcShipping = (region, subtotal, settings, tierName) => {
  const zone = settings.shippingZones.find((z) => z.region === region);
  if (!zone || zone.tiers.length === 0) return { cost: 0, tier: "" };

  const tier =
    (tierName && zone.tiers.find((t) => t.name === tierName)) || zone.tiers[0];

  if (tier.freeAbove > 0 && subtotal >= tier.freeAbove) {
    return { cost: 0, tier: tier.name };
  }
  return { cost: tier.baseCost, tier: tier.name };
};

const calcTax = (region, subtotal, settings) => {
  const rule = settings.taxRules.find((r) => r.region === region);
  if (!rule || rule.rate === 0)
    return { amount: 0, label: "", inclusive: false };

  if (rule.inclusive) {
    const taxAmount = Math.round((subtotal * rule.rate) / (1 + rule.rate));
    return {
      amount: taxAmount,
      label: `${rule.label} ${(rule.rate * 100).toFixed(0)}% (incl.)`,
      inclusive: true,
    };
  }
  return {
    amount: Math.round(subtotal * rule.rate),
    label: `${rule.label} ${(rule.rate * 100).toFixed(0)}%`,
    inclusive: false,
  };
};

/**
 * First-order free-shipping promo eligibility.
 *
 * `commit=false` (preview): just read the user's flag. Don't change anything.
 * `commit=true` (real order): atomically flip the flag from false→true.
 *   If the update returns a doc, this caller "won" and gets the promo.
 *   If null, someone else (or an earlier order) already claimed it.
 *
 * The atomic findOneAndUpdate is critical — without it, two concurrent
 * orders submitted in the same millisecond would both see "no prior order"
 * and both get free shipping. With it, exactly one wins.
 *
 * Once consumed, the flag is sticky: cancelling the first order does NOT
 * restore eligibility. This prevents the cancel-to-reset abuse pattern.
 */
const claimFirstOrderPromo = async (userId, session, commit) => {
  if (!userId) return false;
  if (!commit) {
    const u = await User.findById(userId)
      .select("firstOrderPromoUsed")
      .session(session || null);
    return !u?.firstOrderPromoUsed;
  }
  const updated = await User.findOneAndUpdate(
    { _id: userId, firstOrderPromoUsed: { $ne: true } },
    { $set: { firstOrderPromoUsed: true } },
    { session, new: true, projection: { _id: 1 } },
  );
  return !!updated;
};

const calcTotals = async (
  items,
  couponCode,
  shippingAddress,
  shippingTier,
  userId,
  session,
  { commitPromo = false } = {},
) => {
  const settings = await Settings.getSingleton();
  const region = regionFromCountry(shippingAddress?.country);
  const currency = region === "BD" ? "BDT" : "USD";

  let subtotal = 0;
  const lineItems = [];

  for (const it of items) {
    const product = await Product.findById(it.product).session(session);
    if (!product || !product.isActive) {
      throw Object.assign(new Error(`Product ${it.product} unavailable`), {
        status: 400,
      });
    }
    const sizeStock = product.sizes.find((s) => s.size === it.size);
    if (!sizeStock || sizeStock.stock < it.quantity) {
      throw Object.assign(
        new Error(`Insufficient stock for ${product.name} size ${it.size}`),
        { status: 400 },
      );
    }
    const baseUsd = product.discountPrice ?? product.basePrice;
    const price = toRegionCurrency(baseUsd, region, settings);
    subtotal += price * it.quantity;
    lineItems.push({
      product: product._id,
      name: product.name,
      image: product.images[0] || "",
      size: it.size,
      quantity: it.quantity,
      price,
    });
  }

  let discount = 0;
  let couponDoc = null;
  if (couponCode) {
    couponDoc = await Coupon.findOne({
      code: couponCode.toUpperCase(),
      isActive: true,
    }).session(session);
    if (!couponDoc)
      throw Object.assign(new Error("Invalid coupon"), { status: 400 });
    if (couponDoc.expiresAt && couponDoc.expiresAt < new Date()) {
      throw Object.assign(new Error("Coupon expired"), { status: 400 });
    }
    if (couponDoc.minOrderAmount && subtotal < couponDoc.minOrderAmount) {
      throw Object.assign(
        new Error(`Minimum order ${couponDoc.minOrderAmount} required`),
        { status: 400 },
      );
    }
    discount =
      couponDoc.discountType === "percentage"
        ? Math.round((subtotal * couponDoc.discountValue) / 100)
        : couponDoc.discountValue;
    if (couponDoc.maxDiscount)
      discount = Math.min(discount, couponDoc.maxDiscount);
  }

  const tax = calcTax(region, subtotal, settings);
  const ship = calcShipping(region, subtotal, settings, shippingTier);

  // First-order free shipping promo. Only attempts the claim when the promo
  // is admin-enabled, the user is logged in, and shipping isn't already free
  // (no point claiming a one-time benefit on an already-free order).
  let appliedFirstOrderPromo = false;
  if (settings.promotions?.firstOrderFreeShipping && userId && ship.cost > 0) {
    const eligible = await claimFirstOrderPromo(userId, session, commitPromo);
    if (eligible) {
      ship.cost = 0;
      ship.tier = `${ship.tier} (First order free)`.trim();
      appliedFirstOrderPromo = true;
    }
  }

  const taxToAdd = tax.inclusive ? 0 : tax.amount;
  const total = Math.max(0, subtotal + taxToAdd + ship.cost - discount);

  return {
    lineItems,
    subtotal,
    tax: tax.amount,
    taxLabel: tax.label,
    taxInclusive: tax.inclusive,
    shippingCost: ship.cost,
    shippingTier: ship.tier,
    discount,
    total,
    currency,
    region,
    couponDoc,
    appliedFirstOrderPromo,
  };
};

export const createOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress, shippingTier, couponCode, notes } = req.body;
  if (!items?.length) {
    res.status(400);
    throw new Error("Order must contain items");
  }
  if (!shippingAddress) {
    res.status(400);
    throw new Error("Shipping address required");
  }

  const session = await mongoose.startSession();
  let createdOrder;
  try {
    await session.withTransaction(async () => {
      const t = await calcTotals(
        items,
        couponCode,
        shippingAddress,
        shippingTier,
        req.user._id,
        session,
        { commitPromo: true },
      );

      for (const it of t.lineItems) {
        const result = await Product.updateOne(
          {
            _id: it.product,
            sizes: {
              $elemMatch: { size: it.size, stock: { $gte: it.quantity } },
            },
          },
          { $inc: { "sizes.$.stock": -it.quantity } },
          { session },
        );
        if (result.modifiedCount !== 1) {
          throw Object.assign(
            new Error(`Insufficient stock for ${it.name} size ${it.size}`),
            { status: 409 },
          );
        }
      }

      if (t.couponDoc) {
        await Coupon.updateOne(
          { _id: t.couponDoc._id },
          { $inc: { usedCount: 1 } },
          { session },
        );
      }

      const [order] = await Order.create(
        [
          {
            user: req.user._id,
            items: t.lineItems,
            shippingAddress,
            coupon: t.couponDoc?._id || null,
            subtotal: t.subtotal,
            tax: t.tax,
            taxLabel: t.taxLabel,
            shippingCost: t.shippingCost,
            shippingTier: t.shippingTier,
            discount: t.discount,
            total: t.total,
            currency: t.currency,
            region: t.region,
            notes: notes || "",
            status: "pending",
          },
        ],
        { session },
      );

      await Cart.updateOne(
        { user: req.user._id },
        { $set: { items: [] } },
        { session },
      );

      createdOrder = order;
    });
  } catch (err) {
    res.status(err.status || 400);
    throw err;
  } finally {
    await session.endSession();
  }

  res.status(201).json({ success: true, order: createdOrder });

  // Fire-and-forget admin notification (don't block response)
  createAdminNotification({
    message: `New order #${createdOrder._id.toString().slice(-6)} received`,
    url: `/admin/orders`,
  }).catch(() => {});
});

export const previewOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress, shippingTier, couponCode } = req.body;
  if (!items?.length) {
    res.status(400);
    throw new Error("Items required");
  }
  if (!shippingAddress?.country) {
    res.status(400);
    throw new Error("Shipping address required (at least country)");
  }
  const t = await calcTotals(
    items,
    couponCode,
    shippingAddress,
    shippingTier,
    req.user?._id,
    null,
  );
  res.json({
    success: true,
    preview: {
      subtotal: t.subtotal,
      tax: t.tax,
      taxLabel: t.taxLabel,
      taxInclusive: t.taxInclusive,
      shippingCost: t.shippingCost,
      shippingTier: t.shippingTier,
      discount: t.discount,
      total: t.total,
      currency: t.currency,
      region: t.region,
      appliedFirstOrderPromo: t.appliedFirstOrderPromo,
    },
  });
});

export const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort("-createdAt");
  res.json({ success: true, count: orders.length, orders });
});

export const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate(
    "user",
    "name email",
  );
  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }
  const isOwner = order.user._id.toString() === req.user._id.toString();
  if (!isOwner && req.user.role !== "admin") {
    res.status(403);
    throw new Error("Not authorized");
  }
  res.json({ success: true, order });
});

export const cancelOrder = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  let updatedOrder;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(req.params.id).session(session);
      if (!order)
        throw Object.assign(new Error("Order not found"), { status: 404 });
      if (
        order.user.toString() !== req.user._id.toString() &&
        req.user.role !== "admin"
      ) {
        throw Object.assign(new Error("Not authorized"), { status: 403 });
      }
      if (!["pending", "paid", "processing"].includes(order.status)) {
        throw Object.assign(
          new Error(`Cannot cancel an order in status "${order.status}"`),
          { status: 400 },
        );
      }
      for (const it of order.items) {
        await Product.updateOne(
          { _id: it.product, "sizes.size": it.size },
          { $inc: { "sizes.$.stock": it.quantity } },
          { session },
        );
      }
      if (order.coupon) {
        await Coupon.updateOne(
          { _id: order.coupon, usedCount: { $gt: 0 } },
          { $inc: { usedCount: -1 } },
          { session },
        );
      }
      order.status = "cancelled";
      await order.save({ session });
      updatedOrder = order;
    });
  } catch (err) {
    res.status(err.status || 400);
    throw err;
  } finally {
    await session.endSession();
  }
  res.json({ success: true, order: updatedOrder });
});

// ========== ADMIN ==========

export const getAllOrders = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = status ? { status } : {};
  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate("user", "name email")
      .sort("-createdAt")
      .skip(skip)
      .limit(Number(limit)),
    Order.countDocuments(filter),
  ]);
  res.json({
    success: true,
    total,
    page: Number(page),
    pages: Math.ceil(total / Number(limit)),
    count: orders.length,
    orders,
  });
});

export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, trackingNumber } = req.body;
  const valid = [
    "pending",
    "paid",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
    "refunded",
  ];
  if (!valid.includes(status)) {
    res.status(400);
    throw new Error("Invalid status");
  }
  const order = await Order.findById(req.params.id);
  if (!order) {
    res.status(404);
    throw new Error("Order not found");
  }
  order.status = status;
  if (trackingNumber) order.trackingNumber = trackingNumber;
  if (status === "delivered") order.deliveredAt = new Date();
  await order.save();

  // COD: when delivered, mark Payment as completed.
  if (status === "delivered") {
    await Payment.updateOne(
      { order: order._id, method: "cod", status: "pending" },
      { $set: { status: "completed", paidAt: new Date() } },
    );
  }

  res.json({ success: true, order });
});
