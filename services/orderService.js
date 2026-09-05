import mongoose from "mongoose";

import Order from "../models/orderModel.js";
import Product from "../models/productModel.js";
import Coupon from "../models/couponModel.js";
import CouponUsage from "../models/couponUsageModel.js";
import Cart from "../models/cartModel.js";
import Settings from "../models/settingsModel.js";
import User from "../models/userModel.js";
import Payment from "../models/paymentModel.js";
import { createAdminNotification } from "./notificationService.js";
import { HttpError } from "../lib/http.js";
import { emitOrderEvent, emitAdminEvent } from "../lib/events.js";
import { hashToken, fingerprintOrderRequest, isDuplicateKeyError } from "../lib/idempotency.js";
import { requireObjectIdFormat } from "../lib/validation.js";

// Matches the "danger" row-highlight threshold ProductsPage.jsx already
// uses for total stock — reusing the same number so "low stock" means the
// same thing in the admin table and in the alert, not two drifting rules.
const LOW_STOCK_THRESHOLD = 4;

// Ported from controllers/orderController.js, retargeted from the old
// product.sizes/size-string schema to product.variants/variantId — the
// same migration cart went through in Phase 5A. The calculation logic
// itself (region, tax, shipping tiers, coupon, first-order promo) is
// unchanged, not redesigned.

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
  if (!rule || rule.rate === 0) return { amount: 0, label: "", inclusive: false };

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
    const u = await User.findById(userId).select("firstOrderPromoUsed").session(session || null);
    return !u?.firstOrderPromoUsed;
  }
  const updated = await User.findOneAndUpdate(
    { _id: userId, firstOrderPromoUsed: { $ne: true } },
    { $set: { firstOrderPromoUsed: true } },
    { session, new: true, projection: { _id: 1 } },
  );
  return !!updated;
};

function findVariant(product, variantId) {
  return product.variants.find((v) => String(v._id) === String(variantId));
}

// Mirrors the resolution rule established in services/productService.js /
// lib/utils.js's resolveVariantPricing: effective price = variant.price ??
// product.basePrice, effective discount = variant.discountPrice ??
// product.discountPrice, charged price = discount ?? price.
function chargePriceUsd(product, variant) {
  const effectivePrice = variant.price ?? product.basePrice;
  const effectiveDiscount = variant.discountPrice ?? product.discountPrice;
  return effectiveDiscount ?? effectivePrice;
}

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
    const product = await Product.findById(it.productId).session(session);
    if (!product || !product.isActive) {
      throw new HttpError(400, `Product ${it.productId} unavailable`);
    }
    const variant = findVariant(product, it.variantId);
    if (!variant || variant.stock < it.quantity) {
      throw new HttpError(
        400,
        `Insufficient stock for ${product.name}${variant ? ` (${variant.variantName})` : ""}`,
      );
    }
    const baseUsd = chargePriceUsd(product, variant);
    const price = toRegionCurrency(baseUsd, region, settings);
    subtotal += price * it.quantity;
    lineItems.push({
      product: product._id,
      variantId: variant._id,
      quantity: it.quantity,
      snapshot: {
        name: product.name,
        sku: variant.sku || "",
        color: variant.attributes?.color || "",
        size: variant.attributes?.size || "",
        fabric: variant.attributes?.fabric || "",
        price,
        image: variant.images?.[0] || product.images?.[0] || "",
      },
    });
  }

  let discount = 0;
  let couponDoc = null;
  if (couponCode) {
    couponDoc = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true }).session(session);
    if (!couponDoc) throw new HttpError(400, "Invalid coupon");
    if (couponDoc.expiresAt && couponDoc.expiresAt < new Date()) {
      throw new HttpError(400, "Coupon expired");
    }
    if (couponDoc.minOrderAmount && subtotal < couponDoc.minOrderAmount) {
      throw new HttpError(400, `Minimum order ${couponDoc.minOrderAmount} required`);
    }
    // Phase 5: read-only checks for a clear, early error message. These
    // are NOT the atomic guarantee (a concurrent request could still race
    // past a plain read) — the real enforcement is the guarded conditional
    // update at claim time below, inside createOrder()'s transaction.
    if (couponDoc.usageLimit !== null && couponDoc.usedCount >= couponDoc.usageLimit) {
      throw new HttpError(400, "Coupon usage limit reached");
    }
    if (userId && couponDoc.perUserLimit !== null && couponDoc.perUserLimit !== undefined) {
      const existingUsage = await CouponUsage.findOne({ coupon: couponDoc._id, user: userId }).session(session);
      if (existingUsage && existingUsage.count >= couponDoc.perUserLimit) {
        throw new HttpError(400, "You have already used this coupon the maximum number of times");
      }
    }
    discount =
      couponDoc.discountType === "percentage"
        ? Math.round((subtotal * couponDoc.discountValue) / 100)
        : couponDoc.discountValue;
    if (couponDoc.maxDiscount) discount = Math.min(discount, couponDoc.maxDiscount);
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

export async function previewOrder(userId, { items, shippingAddress, shippingTier, couponCode }) {
  if (!items?.length) throw new HttpError(400, "Items required");
  if (!shippingAddress?.country) throw new HttpError(400, "Shipping address required (at least country)");

  const t = await calcTotals(items, couponCode, shippingAddress, shippingTier, userId, null);
  return {
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
  };
}

// Strips the two internal idempotency fields from an in-memory order doc
// before it's ever handed back to a route/response. Setting a path to
// `undefined` (rather than deleting it) is enough — JSON.stringify/
// NextResponse.json omit undefined-valued keys, and this doesn't fight
// Mongoose's own change-tracking the way `delete doc.field` can.
function redactIdempotencyFields(order) {
  order.idempotencyKeyHash = undefined;
  order.idempotencyRequestHash = undefined;
  return order;
}

// Looks up a previous order for this (user, key) pair. Needs
// `+idempotencyRequestHash` explicitly since that field is select:false by
// default — the caller must redact it again before this doc is ever
// serialized back to a client (see redactIdempotencyFields above).
async function findByIdempotencyKey(userId, keyHash) {
  return Order.findOne({ user: userId, idempotencyKeyHash: keyHash }).select("+idempotencyRequestHash");
}

export async function createOrder(
  userId,
  { items, shippingAddress, shippingTier, couponCode, notes },
  idempotencyKey,
) {
  if (!items?.length) throw new HttpError(400, "Order must contain items");
  if (!shippingAddress) throw new HttpError(400, "Shipping address required");
  if (!idempotencyKey) throw new HttpError(400, "Idempotency-Key header is required");

  const keyHash = hashToken(idempotencyKey);
  const requestHash = fingerprintOrderRequest({ items, shippingAddress, shippingTier, couponCode, notes });

  // Sequential-replay fast path: if a prior request already used this exact
  // key for this user, resolve from it directly — no transaction, no total
  // recalculation (which would otherwise run against an already-emptied
  // cart), no stock/promo/cart mutation, no new notification/SSE event.
  const priorOrder = await findByIdempotencyKey(userId, keyHash);
  if (priorOrder) {
    if (priorOrder.idempotencyRequestHash !== requestHash) {
      throw new HttpError(422, "Idempotency-Key was already used with a different request");
    }
    return { order: redactIdempotencyFields(priorOrder), replayed: true };
  }

  const session = await mongoose.startSession();
  try {
    let createdOrder;
    try {
      await session.withTransaction(async () => {
        const t = await calcTotals(items, couponCode, shippingAddress, shippingTier, userId, session, {
          commitPromo: true,
        });

        for (const it of t.lineItems) {
          const result = await Product.updateOne(
            {
              _id: it.product,
              variants: { $elemMatch: { _id: it.variantId, stock: { $gte: it.quantity } } },
            },
            { $inc: { "variants.$.stock": -it.quantity } },
            { session },
          );
          if (result.modifiedCount !== 1) {
            throw new HttpError(409, `Insufficient stock for ${it.snapshot.sku || "an item"}`);
          }
        }

        if (t.couponDoc) {
          // Atomic, guarded global-usage claim — mirrors the stock-decrement
          // pattern above exactly: the filter itself re-checks
          // `usedCount < usageLimit` (or is skipped entirely for a null/
          // unlimited usageLimit) at the moment of the write, and
          // `modifiedCount` is checked to detect a lost race. Previously
          // this was an unconditional `$inc` with no upper bound, letting
          // concurrent checkouts push `usedCount` past `usageLimit`.
          const couponClaim = await Coupon.updateOne(
            {
              _id: t.couponDoc._id,
              $or: [{ usageLimit: null }, { $expr: { $lt: ["$usedCount", "$usageLimit"] } }],
            },
            { $inc: { usedCount: 1 } },
            { session },
          );
          if (couponClaim.modifiedCount !== 1) {
            throw new HttpError(409, "Coupon usage limit reached");
          }

          // Atomic, guarded PER-USER claim — perUserLimit is defined on
          // the Coupon schema but was never enforced anywhere before
          // Phase 5. A null/undefined perUserLimit means unlimited for
          // this user; otherwise the upsert's filter requires the
          // existing usage row (if any) to still be under the limit. When
          // it isn't, Mongo's upsert tries to insert a second row for the
          // same (coupon, user) pair, which models/couponUsageModel.js's
          // unique compound index rejects — caught below and translated
          // into the same 409 conflict shape the stock/global-usage guards
          // use, not a raw duplicate-key 500.
          const perUserLimit = t.couponDoc.perUserLimit;
          const usageFilter = { coupon: t.couponDoc._id, user: userId };
          if (perUserLimit !== null && perUserLimit !== undefined) {
            usageFilter.count = { $lt: perUserLimit };
          }
          try {
            await CouponUsage.findOneAndUpdate(
              usageFilter,
              { $inc: { count: 1 }, $setOnInsert: { coupon: t.couponDoc._id, user: userId } },
              { session, upsert: true },
            );
          } catch (err) {
            if (err?.code === 11000) {
              throw new HttpError(409, "You have already used this coupon the maximum number of times");
            }
            throw err;
          }
        }

        const [order] = await Order.create(
          [
            {
              user: userId,
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
              idempotencyKeyHash: keyHash,
              idempotencyRequestHash: requestHash,
            },
          ],
          { session },
        );

        await Cart.updateOne({ userId }, { $set: { items: [] } }, { session });

        createdOrder = order;
      });
    } catch (err) {
      // Concurrent replay: another request with the same key committed
      // first (the transaction above aborted on the unique-index conflict,
      // so nothing from THIS attempt — stock, promo, cart, order — was
      // persisted). Resolve to the winner instead of surfacing a raw
      // duplicate-key 500.
      if (isDuplicateKeyError(err, "idempotencyKeyHash")) {
        const winner = await findByIdempotencyKey(userId, keyHash);
        if (winner) {
          if (winner.idempotencyRequestHash !== requestHash) {
            throw new HttpError(422, "Idempotency-Key was already used with a different request");
          }
          return { order: redactIdempotencyFields(winner), replayed: true };
        }
      }
      throw err;
    }

    // Fire-and-forget admin notification (don't block the response). Only
    // reached when THIS request is the one that actually created the
    // order — a replay returns above and never runs any of this again.
    const orderNumber = createdOrder._id.toString().slice(-6);
    createAdminNotification({
      message: `New order #${orderNumber} received`,
      url: `/admin/orders`,
    }).catch(() => {});
    emitAdminEvent({ type: "NEW_ORDER", orderId: createdOrder._id.toString(), orderNumber });

    // Low-stock check happens after the transaction commits — this reads the
    // post-decrement stock, it doesn't need to be part of the atomic write.
    checkLowStock(createdOrder.items).catch(() => {});

    return { order: redactIdempotencyFields(createdOrder), replayed: false };
  } finally {
    await session.endSession();
  }
}

async function checkLowStock(items) {
  for (const it of items) {
    const product = await Product.findOne(
      { _id: it.product, "variants._id": it.variantId },
      { "variants.$": 1, name: 1 },
    ).lean();
    const variant = product?.variants?.[0];
    if (!variant || variant.stock > LOW_STOCK_THRESHOLD) continue;

    const label = [product.name, variant.variantName].filter(Boolean).join(" — ");
    await createAdminNotification({
      message:
        variant.stock <= 0
          ? `Out of stock: ${label}`
          : `Low stock: ${label} — only ${variant.stock} remaining`,
      url: "/admin/products",
    }).catch(() => {});
    emitAdminEvent({
      type: "LOW_STOCK_ALERT",
      productId: it.product.toString(),
      variantId: it.variantId.toString(),
      productName: label,
      stock: variant.stock,
    });
  }
}

export async function getMyOrders(userId) {
  return Order.find({ user: userId }).sort("-createdAt");
}

export async function getOrder(userId, role, orderId) {
  requireObjectIdFormat(orderId, "orderId");
  const order = await Order.findById(orderId).populate("user", "name email");
  if (!order) throw new HttpError(404, "Order not found");
  const isOwner = order.user._id.toString() === String(userId);
  if (!isOwner && role !== "admin") throw new HttpError(403, "Not authorized");
  return order;
}

export async function cancelOrder(userId, role, orderId) {
  requireObjectIdFormat(orderId, "orderId");
  const session = await mongoose.startSession();
  let updatedOrder;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new HttpError(404, "Order not found");
      if (order.user.toString() !== String(userId) && role !== "admin") {
        throw new HttpError(403, "Not authorized");
      }
      if (!["pending", "paid", "processing"].includes(order.status)) {
        throw new HttpError(400, `Cannot cancel an order in status "${order.status}"`);
      }
      for (const it of order.items) {
        await Product.updateOne(
          { _id: it.product, "variants._id": it.variantId },
          { $inc: { "variants.$.stock": it.quantity } },
          { session },
        );
      }
      if (order.coupon) {
        // Symmetric with the existing (pre-Phase-5) global-usage rollback
        // below: cancelling an order restores both the global usedCount
        // AND this Phase 5 per-user usage count — the same choice already
        // made for usedCount, now extended consistently to the new
        // per-user tracking rather than left half-applied. (This mirrors
        // the FIRST-order promo's deliberately opposite choice —
        // claimFirstOrderPromo's flag is sticky and never restored on
        // cancel — but that is a distinct, separately-reasoned guarantee;
        // this coupon rollback simply keeps doing what it already did.)
        await Coupon.updateOne(
          { _id: order.coupon, usedCount: { $gt: 0 } },
          { $inc: { usedCount: -1 } },
          { session },
        );
        await CouponUsage.updateOne(
          { coupon: order.coupon, user: order.user, count: { $gt: 0 } },
          { $inc: { count: -1 } },
          { session },
        );
      }
      order.status = "cancelled";
      await order.save({ session });
      updatedOrder = order;
    });
  } finally {
    await session.endSession();
  }

  // Customer-facing channel (their own tracking page/timeline) — already
  // existed. What was missing is everything below: this cancellation never
  // told the admin team it happened at all, regardless of whether a
  // customer or an admin did the cancelling.
  emitOrderEvent(orderId, { orderId, status: "cancelled" });

  const orderNumber = orderId.toString().slice(-6);
  createAdminNotification({
    message: `Order #${orderNumber} was cancelled`,
    url: "/admin/orders",
  }).catch(() => {});
  emitAdminEvent({ type: "ORDER_CANCELLED", orderId: orderId.toString(), orderNumber });

  return updatedOrder;
}

// ========== ADMIN ==========

const ORDER_SORT_FIELDS = { createdAt: "createdAt", total: "total", status: "status" };

export async function getAllOrders({ status, search, sortBy, sortOrder, page = 1, limit = 20 }) {
  const filter = status ? { status } : {};

  // An order has no name/email of its own — "search" here means "find the
  // order whose id suffix matches, or whose customer's name/email matches."
  // The id half needs $expr/$toString since Mongo can't substring-match an
  // ObjectId directly; the customer half is a real two-step lookup (name/
  // email live on User, not denormalized onto Order), not a fake filter.
  if (search && String(search).trim()) {
    const term = String(search).trim();
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matchingUsers = await User.find({
      $or: [{ name: new RegExp(escaped, "i") }, { email: new RegExp(escaped, "i") }],
    })
      .select("_id")
      .lean();
    filter.$or = [
      { $expr: { $regexMatch: { input: { $toString: "$_id" }, regex: escaped, options: "i" } } },
      ...(matchingUsers.length ? [{ user: { $in: matchingUsers.map((u) => u._id) } }] : []),
    ];
  }

  const sortField = ORDER_SORT_FIELDS[sortBy] || "createdAt";
  const sortDir = sortOrder === "asc" ? 1 : -1;

  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate("user", "name email")
      .sort({ [sortField]: sortDir })
      .skip(skip)
      .limit(Number(limit)),
    Order.countDocuments(filter),
  ]);
  return {
    total,
    page: Number(page),
    pages: Math.max(1, Math.ceil(total / Number(limit))),
    count: orders.length,
    orders,
  };
}

// Forward-progression workflow graph for the admin PUT /api/orders/[id]/status
// endpoint. `delivered`, `cancelled`, `refunded` are terminal — nothing
// transitions OUT of them here. Cancellation from an earlier status has
// its own dedicated cancelOrder() flow (stock/coupon rollback); this
// endpoint only ever moves an order forward or into cancelled/refunded,
// never backward — the exact guarantee Phase 4's COD atomicity work
// already relies on (a delivered/shipped/cancelled order must never
// regress).
const ORDER_STATUS_TRANSITIONS = {
  pending: ["paid", "processing", "shipped", "cancelled"],
  paid: ["processing", "shipped", "cancelled", "refunded"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered", "cancelled"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

function isOrderStatusTransitionAllowed(from, to) {
  if (from === to) return true; // idempotent no-op re-submission
  return (ORDER_STATUS_TRANSITIONS[from] || []).includes(to);
}

export async function updateOrderStatus(orderId, { status, trackingNumber }) {
  requireObjectIdFormat(orderId, "orderId");
  const order = await Order.findById(orderId);
  if (!order) throw new HttpError(404, "Order not found");

  if (!isOrderStatusTransitionAllowed(order.status, status)) {
    throw new HttpError(409, `Cannot change order status from "${order.status}" to "${status}"`);
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

  // Customer-facing channel — unchanged, already worked.
  emitOrderEvent(orderId, { orderId, status, trackingNumber: order.trackingNumber });

  // Admin-facing: always refresh any open admin order list live (no
  // notification noise for a routine processing → shipped click — the
  // person who just clicked it doesn't need to be told they clicked it).
  // Only status changes another admin/employee genuinely needs surfaced —
  // refunded reaching here (cancelled is routed through cancelOrder() by
  // the admin UI, but this stays defensive in case anything else calls
  // this directly) — also write a real notification.
  const orderNumber = orderId.toString().slice(-6);
  emitAdminEvent({ type: "ORDER_STATUS_CHANGED", orderId: orderId.toString(), orderNumber, status });
  if (["cancelled", "refunded"].includes(status)) {
    createAdminNotification({
      message: `Order #${orderNumber} marked as ${status}`,
      url: "/admin/orders",
    }).catch(() => {});
  }

  return order;
}
