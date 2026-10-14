import Product from "../../models/productModel.js";
import Coupon from "../../models/couponModel.js";
import Category from "../../models/categoryModel.js";
import CouponUsage from "../../models/couponUsageModel.js";
import Settings from "../../models/settingsModel.js";
import User from "../../models/userModel.js";
import * as Inventory from "../../models/inventoryModel.js";
import { HttpError } from "../../lib/http.js";
import { groupSegmentsByPrice, publicQuoteLines, quoteHash } from "../../lib/batchPricing.js";
import { isOrderableQuantity, orderStep, formatQuantity } from "../../lib/measure.js";

/** What an order costs: line prices, coupons, shipping and tax, and the quote a shopper agrees to. */
// BDT-only currency migration (see docs/CURRENCY_MIGRATION_PLAN.md):
// `region` now selects a shipping/tax ZONE only — it is no longer tied to
// currency. Every charge in this app is BDT, full stop; there is no more
// "raw USD for an INTL address" branch. `region` stays a plain
// country-derived zone key ("BD" vs "INTL") purely to pick which shipping
// tier / tax rule applies (see settings.shippingZones/taxRules), same as
// before this migration.
const regionFromCountry = (country) => {
  const c = String(country || "").toUpperCase();
  if (c === "BD" || c === "BANGLADESH") return "BD";
  return "INTL";
};


// BDT has no minor unit in how this store prices/displays it (always a
// whole-taka integer). Every function in this file that produces a money
// AMOUNT must run its result through roundMoney() before it is summed
// with anything else — summing un-rounded floats (e.g. a rate multiply)
// can reintroduce float noise before it's added into a running total.
function roundMoney(amount) {
  return Math.round(amount + Number.EPSILON);
}


const calcShipping = (region, subtotal, settings, tierName) => {
  const zone = settings.shippingZones.find((z) => z.region === region);
  if (!zone || zone.tiers.length === 0) return { cost: 0, tier: "" };

  const tier = (tierName && zone.tiers.find((t) => t.name === tierName)) || zone.tiers[0];

  if (tier.freeAbove > 0 && subtotal >= tier.freeAbove) {
    return { cost: 0, tier: tier.name };
  }
  return { cost: roundMoney(tier.baseCost), tier: tier.name };
};


const calcTax = (region, subtotal, settings) => {
  const rule = settings.taxRules.find((r) => r.region === region);
  if (!rule || rule.rate === 0) return { amount: 0, label: "", inclusive: false };

  if (rule.inclusive) {
    const taxAmount = roundMoney((subtotal * rule.rate) / (1 + rule.rate));
    return { amount: taxAmount, label: `${rule.label} ${(rule.rate * 100).toFixed(0)}% (incl.)`, inclusive: true };
  }
  return { amount: roundMoney(subtotal * rule.rate), label: `${rule.label} ${(rule.rate * 100).toFixed(0)}%`, inclusive: false };
};


function findVariant(product, variantId) {
  return product.variants.find((v) => String(v._id) === String(variantId));
}


// Resolves a line item's charge, ALWAYS in BDT. `product.priceCurrency`
// (see models/productModel.js / sql/schema.sql) is the transitional flag
// from the BDT-only currency migration: 'BDT' products' stored
// base_price/discount_price/variant price are already true Taka values —
// used as-is, never multiplied. 'USD' products (not yet migrated — see
// docs/CURRENCY_MIGRATION_PLAN.md for exactly which ones and why) still
// use the live exchange rate to produce a BDT charge — but unlike before
// this migration, this conversion now happens unconditionally (no more
// raw-USD-for-INTL-addresses branch): every order this app creates is
// BDT-denominated, regardless of shipping region.
function chargePrice(product, variant, settings) {
  const effectivePrice = variant.price ?? product.basePrice;
  const effectiveDiscount = variant.discountPrice ?? product.discountPrice;
  const chargeInProductCurrency = effectiveDiscount ?? effectivePrice;
  if (product.priceCurrency === "BDT") return roundMoney(chargeInProductCurrency);
  return roundMoney(chargeInProductCurrency * settings.currency.usdToBdt);
}



// ── Coupon eligibility and the discount it produces ────────────────────────
//
// A coupon limited to categories discounts only the lines whose product sits
// in one of those categories OR BELOW one (the dashboard lets a coupon name a
// parent such as "Women", and products live in leaf categories, so a parent
// with no descendants would match nothing). No categories = every line.
//
// The discount is computed on the ELIGIBLE goods and can never exceed them:
// a coupon is a price reduction on goods, so it can never eat into shipping
// or tax, whatever its flat value or percentage. `maxDiscount` still caps it.
async function couponCategoryScope(couponDoc) {
  const roots = (couponDoc.applicableCategories || []).map(String);
  if (!roots.length) return null;
  const scope = new Set(roots);
  let frontier = roots;
  while (frontier.length) {
    const children = await Category.findChildIdsByParents(frontier);
    frontier = children.map((c) => String(c.id)).filter((id) => !scope.has(id));
    for (const id of frontier) scope.add(id);
  }
  return scope;
}


export function couponDiscount(coupon, eligibleSubtotal) {
  const base = Math.max(0, eligibleSubtotal);
  let discount =
    coupon.discountType === "percentage"
      ? roundMoney((base * coupon.discountValue) / 100)
      : roundMoney(coupon.discountValue);
  if (coupon.maxDiscount) discount = Math.min(discount, roundMoney(coupon.maxDiscount));
  return Math.max(0, Math.min(discount, base));
}


const productCategoryId = (product) => String(product.category?._id ?? product.category ?? "");


export const calcTotals = async (
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
  // BDT-only currency migration: every order is BDT now, regardless of
  // shipping region — `region` still selects a shipping/tax zone above,
  // it no longer selects a currency.
  const currency = "BDT";

  let subtotal = 0;
  const lineItems = [];
  const lineCategories = [];

  const productIds = [...new Set(items.map((it) => String(it.productId)))];
  const products = await Product.findByIds(productIds);
  const productById = new Map(products.map((p) => [String(p._id), p]));

  // Resolve every line first (product, variant, the listing's quick stock check), then let the
  // inventory model say which batches would fill them — in one call, so the prices below are the
  // prices of stock that exists, taken in the order the till would take it.
  const resolved = [];
  for (const it of items) {
    const product = productById.get(String(it.productId));
    if (!product || !product.isActive) {
      throw new HttpError(400, `Product ${it.productId} unavailable`);
    }
    const variant = findVariant(product, it.variantId);
    // Variants not offered online are not loaded at all (models/productModel.js),
    // so one the shopper names that is missing here is simply not for sale.
    if (!variant) throw new HttpError(400, `${product.name} is not available online`);
    if (!isOrderableQuantity(variant, it.quantity)) {
      const step = orderStep(variant);
      throw new HttpError(400, `${product.name}: order ${step === 1 && (!variant.unit || variant.unit === "pc") ? "a whole number" : `in steps of ${formatQuantity(step, variant.unit)}`}`);
    }
    if (variant.stock < it.quantity) {
      throw new HttpError(
        400,
        `Insufficient stock for ${product.name}${variant ? ` (${variant.variantName})` : ""}`,
      );
    }
    resolved.push({ product, variant, quantity: it.quantity });
  }

  let plan;
  try {
    plan = await Inventory.planOrder(
      conn,
      resolved.map((r) => ({ variantId: r.variant._id, productId: r.product._id, quantity: r.quantity, tracking: r.variant.tracking, sku: r.variant.sku || "" })),
    );
  } catch (err) {
    if (err instanceof Inventory.InsufficientStockError) throw new HttpError(409, err.message);
    throw err;
  }

  const quoteLines = [];
  resolved.forEach((r, index) => {
    const { product, variant } = r;
    // A batch's own selling price applies when the item is on its normal price; a promotional price is one
    // price for every batch (and so is a not-yet-migrated USD product's, which has no batch price in taka).
    const promotional = (variant.discountPrice ?? product.discountPrice) != null;
    const batchPriced = product.priceCurrency === "BDT" && !promotional;
    const flat = chargePrice(product, variant, settings);
    // The segments of this line, grouped by the price they sell at: one order line per price.
    const groups = groupSegmentsByPrice(plan.lines[index].segments, (seg) => (batchPriced ? roundMoney(seg.sellingPrice) : flat));
    for (const group of groups) {
      const price = group.unitPrice;
      // roundMoney() again after the multiply: `price` is already rounded,
      // but `price * quantity` can reintroduce float noise before it's
      // added into the running subtotal.
      const lineTotal = roundMoney(price * group.quantity);
      subtotal = roundMoney(subtotal + lineTotal);
      lineCategories.push({ categoryId: productCategoryId(product), lineTotal });
      quoteLines.push({ productId: String(product._id), variantId: String(variant._id), quantity: group.quantity, unitPrice: price, lineTotal });
      lineItems.push({
        product: product._id,
        variantId: variant._id,
        quantity: group.quantity,
        // The batches behind this line, for the reservation (never returned to a client).
        segments: group.segments,
        snapshot: {
          name: product.name,
          sku: variant.sku || "",
          unit: variant.unit || "pc",
          attributes: { ...variant.attributes },
          price,
          image: variant.images?.[0] || product.images?.[0] || "",
        },
      });
    }
  });

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
    // Coupon discountValue/maxDiscount are BDT-denominated, full stop —
    // no currency ambiguity to resolve here (0 coupons existed at the
    // time of the BDT-only currency migration; any coupon created from
    // now on is entered directly in Taka).
    const scope = await couponCategoryScope(couponDoc);
    const eligibleSubtotal = scope
      ? lineCategories.reduce((sum, l) => (scope.has(l.categoryId) ? roundMoney(sum + l.lineTotal) : sum), 0)
      : subtotal;
    if (eligibleSubtotal <= 0) {
      throw new HttpError(400, "This coupon does not apply to any item in your cart");
    }
    discount = couponDiscount(couponDoc, eligibleSubtotal);
  }

  // Tax is on what the goods actually sell for: the subtotal after the
  // coupon. For inclusive VAT this is the VAT portion of the amount charged
  // (the total itself is unchanged); for exclusive tax it is the tax added.
  // Shipping is not in the tax base, and the free-shipping threshold is
  // measured on the goods subtotal BEFORE any coupon (see docs/pricing.md).
  const goodsAfterDiscount = roundMoney(subtotal - discount);
  const tax = calcTax(region, goodsAfterDiscount, settings);
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
  const total = roundMoney(goodsAfterDiscount + taxToAdd + ship.cost);

  return {
    lineItems,
    plan,
    // What the shopper is agreeing to: the goods by price, and the total. A hash of it travels with the order
    // request, so a price or a batch that changed under them is reported, never silently charged.
    quote: { lines: quoteLines, hash: quoteHash(quoteLines, total) },
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


/**
 * What a coupon is worth for this cart — the coupon box's answer, computed by
 * the same calcTotals() the preview and the saved order use, so the figure a
 * shopper is told can never differ from what they are charged. The discount
 * does not depend on the delivery zone, so any valid country will do here.
 */
export async function quoteCoupon(userId, { code, items }) {
  if (!items?.length) throw new HttpError(400, "Items required");
  const t = await calcTotals(items, code, { country: "BD" }, undefined, userId, null);
  return { coupon: t.couponDoc, discount: t.discount, subtotal: t.subtotal };
}


// What a preview (and a "the quote changed" answer) tells the browser: every figure, the goods line by line
// at the prices checkout would charge, and the quote token to send back with the order.
export function previewShape(t) {
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
    lines: publicQuoteLines(t.quote.lines),
    quote: t.quote.hash,
  };
}


export async function previewOrder(userId, { items, shippingAddress, shippingTier, couponCode }) {
  if (!items?.length) throw new HttpError(400, "Items required");
  if (!shippingAddress?.country) throw new HttpError(400, "Shipping address required (at least country)");

  const t = await calcTotals(items, couponCode, shippingAddress, shippingTier, userId, null);
  return previewShape(t);
}
