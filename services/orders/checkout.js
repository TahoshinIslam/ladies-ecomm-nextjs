import Order from "../../models/orderModel.js";
import Product from "../../models/productModel.js";
import Coupon from "../../models/couponModel.js";
import CouponUsage from "../../models/couponUsageModel.js";
import Cart from "../../models/cartModel.js";
import * as Inventory from "../../models/inventoryModel.js";
import { isModuleEntitled, STOREFRONT_MODULE } from "../../models/entitlementModel.js";
import { getOrganizationId } from "../../lib/tenant.js";
import { withTransaction } from "../../lib/db/tx.js";
import { createAdminNotification } from "../notificationService.js";
import { HttpError } from "../../lib/http.js";
import { emitAdminEvent, emitBestEffort } from "../../lib/events.js";
import { hashToken, fingerprintOrderRequest, isDuplicateKeyError } from "../../lib/idempotency.js";
import { enforceRateLimit } from "../../lib/rateLimit.js";
import { ORDER_CREATE_IP_LIMIT, ORDER_CREATE_IP_WINDOW_MS, ORDER_CREATE_USER_LIMIT, ORDER_CREATE_USER_WINDOW_MS, ORDER_MAX_PENDING_PER_CUSTOMER } from "../../lib/rateLimitConfig.js";
import { calcTotals, previewShape } from "./pricing.js";

/** Placing an order: idempotency, limits, stock and the order row itself. */
// Matches the "danger" row-highlight threshold ProductsPage.jsx already
// uses for total stock — reusing the same number so "low stock" means the
// same thing in the admin table and in the alert, not two drifting rules.
const LOW_STOCK_THRESHOLD = 4;


export function redactIdempotencyFields(order) {
  order.idempotencyKeyHash = undefined;
  order.idempotencyRequestHash = undefined;
  return order;
}


export async function createOrder(
  userId,
  { items, shippingAddress, shippingTier, couponCode, notes, quote },
  idempotencyKey,
  { clientIp = null } = {},
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

  // The merchant's plan, before anything is counted or written. A store whose plan does not include online sales cannot take an
  // order whatever its stock and configuration say. Placed AFTER the replay path above: an order already made still answers its own
  // retry. The shopper's own standing is irrelevant here — this is the selling organization's entitlement, read fresh every time.
  if (!(await isModuleEntitled(STOREFRONT_MODULE))) {
    throw new HttpError(403, "Online sales are not available for this store.", { code: "not-in-plan" });
  }

  // Order-creation rate limit. Checked ONLY here — after the sequential-replay fast path above
  // has already returned for any request reusing an existing Idempotency-
  // Key — so retrying/resubmitting the SAME checkout never consumes a
  // slot or can be blocked by this limiter; only genuinely NEW order
  // attempts count against it. See lib/rateLimitConfig.js's
  // ORDER_CREATE_USER_LIMIT for the full reasoning.
  await enforceRateLimit([
    { identity: String(userId), action: "order-create:user", limit: ORDER_CREATE_USER_LIMIT, windowMs: ORDER_CREATE_USER_WINDOW_MS },
    // Only when the address is trustworthy (lib/clientIp.js); without one the per-account limits still apply.
    ...(clientIp ? [{ identity: clientIp, action: "order-create:ip", limit: ORDER_CREATE_IP_LIMIT, windowMs: ORDER_CREATE_IP_WINDOW_MS }] : []),
  ]);

  // A ceiling on open (unshipped) orders — see
  // ORDER_MAX_PENDING_PER_CUSTOMER. Counted outside the transaction, so two
  // simultaneous checkouts can each pass at the limit; that overshoot is one
  // order, not the unbounded hoarding this exists to stop.
  if ((await Order.countOpenByUser(userId)) >= ORDER_MAX_PENDING_PER_CUSTOMER) {
    throw new HttpError(
      429,
      "You already have orders waiting for the store to confirm. Please wait until one is confirmed or cancel one before placing another.",
      { code: "too-many-pending-orders" },
    );
  }

  let createdOrder;
  try {
    createdOrder = await withTransaction(async (conn) => {
      const t = await calcTotals(items, couponCode, shippingAddress, shippingTier, userId, conn, {
        commitPromo: true,
      });

      // The shopper agreed to a quote (the preview's `quote`). Priced again here, inside the transaction and with
      // the batch rows locked: if what checkout would charge is not what they were shown — a price moved, a
      // batch ran out, another store was chosen — nothing is created, and the new quote comes back for them
      // to review. Never a silent difference.
      if (quote && quote !== t.quote.hash) {
        throw new HttpError(
          409,
          "The price or availability of something in your order changed while you were checking out. Review the updated total, then place the order again.",
          { code: "QUOTE_CHANGED", preview: previewShape(t) },
        );
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

      // Stock is reserved, not removed: the goods stay on the shelf until
      // the dashboard dispatches the order (see models/inventoryModel.js).
      // Each reservation is a guarded single-row UPDATE, so a line that
      // cannot be covered rolls the whole order back with a 409 — the same
      // contract the old guarded decrement had.
      const [orderLines] = await conn.query(
        `SELECT id, product_id, variant_id, quantity, snapshot_sku
           FROM order_items WHERE organization_id = ? AND order_id = ? ORDER BY position`,
        [getOrganizationId(), order._id],
      );
      try {
        // Exactly the batches the quote was made from, line by line (order lines are in the order they were priced).
        await Inventory.reserveOrder(conn, order._id, {
          locationId: t.plan.locationId,
          lines: orderLines.map((l, i) => ({
            orderItemId: l.id,
            productId: l.product_id,
            variantId: l.variant_id,
            quantity: l.quantity,
            sku: l.snapshot_sku,
            segments: t.lineItems[i].segments,
          })),
        });
      } catch (err) {
        if (err instanceof Inventory.InsufficientStockError) throw new HttpError(409, err.message);
        throw err;
      }

      await Cart.clearByUser(userId, conn);

      // The admin NEW_ORDER event is written INSIDE this transaction — a
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
    // The index is named for the column it covers, which became customer_id
    // when shoppers moved to their own table. Matching the old name meant
    // this branch never fired: two simultaneous requests carrying the same
    // Idempotency-Key raised a raw duplicate-key 500 instead of both
    // resolving to the one order that was actually created.
    if (isDuplicateKeyError(err, "uq_orders_customer_idempotency")) {
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
  const orderNumber = createdOrder._id.toString().slice(-6).toUpperCase();
  createAdminNotification({
    message: `New order #${orderNumber} received`,
    // The dashboard's own page for this order, so the bell opens the order to handle rather than the list.
    url: `/dashboard/orders/${createdOrder._id}`,
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
    if (!row) continue;
    // A reorder point set in the dashboard (Inventory → Low-stock Alerts)
    // wins over the fixed default threshold.
    const level = await Inventory.findOnlineLevel(it.variantId);
    const threshold = level?.reorderPoint ?? LOW_STOCK_THRESHOLD;
    if (row.stock > threshold) continue;

    const label = [row.product_name, row.variant_name].filter(Boolean).join(" — ");
    await createAdminNotification({
      message: row.stock <= 0 ? `Out of stock: ${label}` : `Low stock: ${label} — only ${row.stock} remaining`,
      url: "/dashboard/inventory/alerts",
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
