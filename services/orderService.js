import Order from "../models/orderModel.js";
import Product from "../models/productModel.js";
import Coupon from "../models/couponModel.js";
import CouponUsage from "../models/couponUsageModel.js";
import Cart from "../models/cartModel.js";
import Settings from "../models/settingsModel.js";
import User from "../models/userModel.js";
import Payment from "../models/paymentModel.js";
import { withTransaction } from "../lib/db/tx.js";
import { createAdminNotification, createUserNotification } from "./notificationService.js";
import { HttpError } from "../lib/http.js";
import { emitOrderEvent, emitAdminEvent, emitBestEffort } from "../lib/events.js";
import { hashToken, fingerprintOrderRequest, isDuplicateKeyError } from "../lib/idempotency.js";
import { requireObjectIdFormat } from "../lib/validation.js";

// Matches the "danger" row-highlight threshold ProductsPage.jsx already
// uses for total stock — reusing the same number so "low stock" means the
// same thing in the admin table and in the alert, not two drifting rules.
const LOW_STOCK_THRESHOLD = 4;

const CUSTOMER_STATUS_MESSAGE = {
  paid: (n) => `Payment confirmed for order #${n}`,
  processing: (n) => `Order #${n} is being processed`,
  shipped: (n) => `Order #${n} has shipped`,
  delivered: (n) => `Order #${n} was delivered`,
  cancelled: (n) => `Order #${n} was cancelled`,
  refunded: (n) => `Order #${n} was refunded`,
};

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

  const tier = (tierName && zone.tiers.find((t) => t.name === tierName)) || zone.tiers[0];

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
    return { amount: taxAmount, label: `${rule.label} ${(rule.rate * 100).toFixed(0)}% (incl.)`, inclusive: true };
  }
  return { amount: Math.round(subtotal * rule.rate), label: `${rule.label} ${(rule.rate * 100).toFixed(0)}%`, inclusive: false };
};

function findVariant(product, variantId) {
  return product.variants.find((v) => String(v._id) === String(variantId));
}

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
  conn,
  { commitPromo = false } = {},
) => {
  const settings = await Settings.getSingleton();
  const region = regionFromCountry(shippingAddress?.country);
  const currency = region === "BD" ? "BDT" : "USD";

  let subtotal = 0;
  const lineItems = [];

  const productIds = [...new Set(items.map((it) => String(it.productId)))];
  const products = await Product.findByIds(productIds);
  const productById = new Map(products.map((p) => [String(p._id), p]));

  for (const it of items) {
    const product = productById.get(String(it.productId));
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
        attributes: { ...variant.attributes },
        price,
        image: variant.images?.[0] || product.images?.[0] || "",
      },
    });
  }

  let discount = 0;
  let couponDoc = null;
  if (couponCode) {
    couponDoc = conn ? await Coupon.findByCodeActive(couponCode, conn) : await Coupon.findByCode(couponCode);
    if (!couponDoc || !couponDoc.isActive) throw new HttpError(400, "Invalid coupon");
    if (couponDoc.expiresAt && couponDoc.expiresAt < new Date()) {
      throw new HttpError(400, "Coupon expired");
    }
    if (couponDoc.minOrderAmount && subtotal < couponDoc.minOrderAmount) {
      throw new HttpError(400, `Minimum order ${couponDoc.minOrderAmount} required`);
    }
    // Phase 5: read-only checks for a clear, early error message. These are
    // NOT the atomic guarantee (a concurrent request could still race past
    // a plain read) — the real enforcement is the guarded conditional
    // update at claim time below, inside createOrder()'s transaction.
    if (couponDoc.usageLimit !== null && couponDoc.usedCount >= couponDoc.usageLimit) {
      throw new HttpError(400, "Coupon usage limit reached");
    }
    if (userId && couponDoc.perUserLimit !== null && couponDoc.perUserLimit !== undefined) {
      const existingUsage = await CouponUsage.findByCouponUser(couponDoc._id, userId, conn);
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

  let appliedFirstOrderPromo = false;
  if (settings.promotions?.firstOrderFreeShipping && userId && ship.cost > 0) {
    const eligible = commitPromo
      ? await User.claimFirstOrderPromo(userId, conn)
      : await User.hasUnusedFirstOrderPromo(userId, conn);
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

function redactIdempotencyFields(order) {
  order.idempotencyKeyHash = undefined;
  order.idempotencyRequestHash = undefined;
  return order;
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
  // recalculation, no stock/promo/cart mutation, no new notification/event.
  const priorOrder = await Order.findByIdempotencyKey(userId, keyHash);
  if (priorOrder) {
    if (priorOrder.idempotencyRequestHash !== requestHash) {
      throw new HttpError(422, "Idempotency-Key was already used with a different request");
    }
    return { order: redactIdempotencyFields(priorOrder), replayed: true };
  }

  let createdOrder;
  try {
    createdOrder = await withTransaction(async (conn) => {
      const t = await calcTotals(items, couponCode, shippingAddress, shippingTier, userId, conn, {
        commitPromo: true,
      });

      for (const it of t.lineItems) {
        const decremented = await Product.decrementVariantStock(conn, it.product, it.variantId, it.quantity);
        if (!decremented) {
          throw new HttpError(409, `Insufficient stock for ${it.snapshot.sku || "an item"}`);
        }
      }

      if (t.couponDoc) {
        const claimedGlobal = await Coupon.claimGlobalUsage(conn, t.couponDoc._id);
        if (!claimedGlobal) {
          throw new HttpError(409, "Coupon usage limit reached");
        }
        const claimedPerUser = await CouponUsage.claimPerUserUsage(conn, t.couponDoc._id, userId, t.couponDoc.perUserLimit);
        if (!claimedPerUser) {
          throw new HttpError(409, "You have already used this coupon the maximum number of times");
        }
      }

      const order = await Order.create(
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
        conn,
      );

      await Cart.clearByUser(userId, conn);

      // Phase 11 realtime-durability correction (kept from the original):
      // the admin NEW_ORDER event is written INSIDE this transaction — a
      // genuine transactional outbox. If this insert fails, the whole
      // transaction (order/stock/coupon/cart writes included) rolls back
      // with it; if the transaction commits, the event is atomically
      // visible in the same instant.
      const orderNumber = order._id.toString().slice(-6);
      await emitAdminEvent({ type: "NEW_ORDER", orderId: order._id.toString(), orderNumber }, { session: conn });

      return order;
    });
  } catch (err) {
    // Concurrent replay: another request with the same key committed first
    // (this transaction aborted on the unique-index conflict, so nothing
    // from THIS attempt — stock, promo, cart, order — was persisted).
    // Resolve to the winner instead of surfacing a raw duplicate-key 500.
    if (isDuplicateKeyError(err, "uq_orders_user_idempotency")) {
      const winner = await Order.findByIdempotencyKey(userId, keyHash);
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
  // reached when THIS request is the one that actually created the order.
  const orderNumber = createdOrder._id.toString().slice(-6);
  createAdminNotification({
    message: `New order #${orderNumber} received`,
    url: `/admin/orders`,
  }).catch(() => {});

  // Low-stock check happens after the transaction commits — this reads the
  // post-decrement stock. Awaited via emitBestEffort so a failure here is
  // guaranteed to be observed and logged, without ever failing the order.
  await emitBestEffort(checkLowStock(createdOrder.items));

  return { order: redactIdempotencyFields(createdOrder), replayed: false };
}

async function checkLowStock(items) {
  for (const it of items) {
    const row = await Product.findVariantForLowStockCheck(it.product, it.variantId);
    if (!row || row.stock > LOW_STOCK_THRESHOLD) continue;

    const label = [row.product_name, row.variant_name].filter(Boolean).join(" — ");
    await createAdminNotification({
      message: row.stock <= 0 ? `Out of stock: ${label}` : `Low stock: ${label} — only ${row.stock} remaining`,
      url: "/admin/products",
    }).catch(() => {});
    await emitBestEffort(
      emitAdminEvent({
        type: "LOW_STOCK_ALERT",
        productId: it.product.toString(),
        variantId: it.variantId.toString(),
        productName: label,
        stock: row.stock,
      }),
    );
  }
}

export async function getMyOrders(userId) {
  const orders = await Order.findMyOrders(userId);
  // See redactIdempotencyFields()'s own comment: models/orderModel.js's
  // rowToOrder() has no equivalent of the old Mongoose schema's
  // `select: false` on these two columns (a plain `SELECT *` has no
  // concept of a field that's hidden by default), so every SQL-backed
  // order-model read includes them unless a caller strips them again here
  // — every externally-facing read (this list, getOrder() below, and
  // createOrder()'s own response) must, since these are for internal
  // replay-detection use only and were never meant to reach a client.
  return orders.map(redactIdempotencyFields);
}

export async function getOrder(userId, role, orderId) {
  requireObjectIdFormat(orderId, "orderId");
  const order = await Order.findById(orderId, { populateUser: true });
  if (!order) throw new HttpError(404, "Order not found");
  const isOwner = order.user._id.toString() === String(userId);
  if (!isOwner && role !== "admin") throw new HttpError(403, "Not authorized");
  return redactIdempotencyFields(order);
}

export async function cancelOrder(userId, role, orderId) {
  requireObjectIdFormat(orderId, "orderId");
  const updatedOrder = await withTransaction(async (conn) => {
    const order = await Order.findByIdForUpdate(conn, orderId);
    if (!order) throw new HttpError(404, "Order not found");
    if (order.user.toString() !== String(userId) && role !== "admin") {
      throw new HttpError(403, "Not authorized");
    }
    if (!["pending", "paid", "processing"].includes(order.status)) {
      throw new HttpError(400, `Cannot cancel an order in status "${order.status}"`);
    }
    for (const it of order.items) {
      await Product.incrementVariantStock(conn, it.product, it.variantId, it.quantity);
    }
    if (order.coupon) {
      // Symmetric with the global-usage rollback: cancelling an order
      // restores both the global usedCount AND the per-user usage count.
      // (This mirrors the FIRST-order promo's deliberately opposite
      // choice — claimFirstOrderPromo's flag is sticky and never restored
      // on cancel — but that is a distinct, separately-reasoned guarantee.)
      await Coupon.restoreGlobalUsage(conn, order.coupon);
      await CouponUsage.restorePerUserUsage(conn, order.coupon, order.user);
    }
    order.status = "cancelled";
    await Order.saveOrderOnConnection(conn, order);

    const orderNumber = orderId.toString().slice(-6);
    await emitOrderEvent(orderId, { orderId, status: "cancelled" }, { session: conn });
    await emitAdminEvent(
      { type: "ORDER_CANCELLED", orderId: orderId.toString(), orderNumber, actorId: userId?.toString() },
      { session: conn },
    );

    return order;
  });

  const orderNumber = orderId.toString().slice(-6);
  createAdminNotification({
    message: `Order #${orderNumber} was cancelled`,
    url: "/admin/orders",
  }).catch(() => {});

  return updatedOrder;
}

// ========== ADMIN ==========

export async function getAllOrders({ status, search, sortBy, sortOrder, page = 1, limit = 20 }) {
  const pageNum = Number(page);
  const limitNum = Number(limit);
  const skip = (pageNum - 1) * limitNum;
  const { orders, total } = await Order.findAdminList({ status, search, sortBy, sortOrder, skip, limit: limitNum });
  return {
    total,
    page: pageNum,
    pages: Math.max(1, Math.ceil(total / limitNum)),
    count: orders.length,
    // See getMyOrders()'s own comment — same redaction, same reason.
    orders: orders.map(redactIdempotencyFields),
  };
}

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
  if (from === to) return true;
  return (ORDER_STATUS_TRANSITIONS[from] || []).includes(to);
}

export async function updateOrderStatus(orderId, { status, trackingNumber }) {
  requireObjectIdFormat(orderId, "orderId");
  const order = await Order.findById(orderId);
  if (!order) throw new HttpError(404, "Order not found");

  if (!isOrderStatusTransitionAllowed(order.status, status)) {
    throw new HttpError(409, `Cannot change order status from "${order.status}" to "${status}"`);
  }

  const isSameStatus = order.status === status;
  const trackingChanged = !!trackingNumber && trackingNumber !== order.trackingNumber;

  if (isSameStatus && !trackingChanged) {
    return { order, changed: false };
  }

  if (!isSameStatus) order.status = status;
  if (trackingChanged) order.trackingNumber = trackingNumber;
  if (!isSameStatus && status === "delivered") order.deliveredAt = new Date();
  await order.save();

  if (!isSameStatus && status === "delivered") {
    await Payment.markCompletedForCod(order._id);
  }

  await emitBestEffort(emitOrderEvent(orderId, { orderId, status, trackingNumber: order.trackingNumber }));

  if (!isSameStatus) {
    const orderNumber = orderId.toString().slice(-6);
    await emitBestEffort(emitAdminEvent({ type: "ORDER_STATUS_CHANGED", orderId: orderId.toString(), orderNumber, status }));
    if (["cancelled", "refunded"].includes(status)) {
      createAdminNotification({
        message: `Order #${orderNumber} marked as ${status}`,
        url: "/admin/orders",
      }).catch(() => {});
    }

    const customerMessage = CUSTOMER_STATUS_MESSAGE[status];
    if (customerMessage) {
      createUserNotification({
        recipient: order.user,
        message: customerMessage(orderNumber),
        url: `/orders/${orderId}`,
      }).catch(() => {});
    }
  }

  return { order, changed: true };
}
