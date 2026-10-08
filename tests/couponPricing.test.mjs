// Coupon pricing: category limits, the discount cap, and the tax base —
// through the real Route Handlers a shopper's browser calls:
//
//   POST /api/coupons/validate   the coupon box
//   POST /api/orders/preview     the order summary
//   POST /api/orders             the order that is actually charged
//
// All three must agree, line for line. What must hold:
//
//   - a coupon limited to categories discounts only the lines in those
//     categories or below them (a parent category covers its children);
//   - the discount never exceeds the eligible goods, so a coupon can never
//     eat into shipping or tax, whatever its flat value;
//   - maxDiscount still caps it;
//   - a coupon that covers nothing in the cart is refused, not applied as 0;
//   - tax is computed on the goods after the discount (inclusive VAT: the
//     VAT inside what was charged; exclusive tax: added on top of it);
//   - the free-shipping threshold is measured on the goods before any coupon.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  dbReady,
  skipReason,
  connectTestDb,
  disconnectTestDb,
  truncateAll,
  createTestSession,
  requestAs,
  createTestUser,
  rawQuery,
} from "./helpers/testDb.mjs";

describe("Coupon pricing: category limits, cap and tax base", { skip: !dbReady && skipReason }, () => {
  let validatePOST, previewPOST, createOrderPOST;
  let Coupon, Category, Product, orgId;

  before(async () => {
    await connectTestDb();
    await truncateAll();
    ({ POST: validatePOST } = await import("../app/api/coupons/validate/route.js"));
    ({ POST: previewPOST } = await import("../app/api/orders/preview/route.js"));
    ({ POST: createOrderPOST } = await import("../app/api/orders/route.js"));
    ({ default: Coupon } = await import("../models/couponModel.js"));
    ({ default: Category } = await import("../models/categoryModel.js"));
    ({ default: Product } = await import("../models/productModel.js"));
    ({ getOrganizationId: orgId } = await import("../lib/tenant.js"));
  });

  after(async () => {
    await disconnectTestDb();
  });

  const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const address = { fullName: "Pricing Buyer", phone: "0100000000", street: "1 Test Street", city: "Dhaka", postalCode: "1200", country: "Bangladesh" };

  async function category(parent = null) {
    const s = unique();
    return Category.create({ name: `Pricing ${s}`, slug: `pricing-${s}`, parent });
  }

  async function product(categoryId, basePrice, stock = 20) {
    const s = unique();
    return Product.create({
      name: `Pricing Product ${s}`,
      description: "Created by the test suite — safe to delete.",
      category: categoryId,
      basePrice,
      images: ["https://placehold.co/400x400.png?text=test"],
      variants: [{ variantName: "Default", sku: `PRC-${s}`, stock }],
    });
  }

  async function coupon(overrides) {
    return Coupon.create({
      code: `PRC${unique()}`.toUpperCase(),
      discountType: "flat",
      discountValue: 100,
      expiresAt: new Date(Date.now() + 30 * 86400000),
      isActive: true,
      ...overrides,
    });
  }

  const line = (p, quantity = 1) => ({ productId: p._id.toString(), variantId: p.variants[0]._id.toString(), quantity });

  async function call(handler, url, user, body) {
    const res = await handler(requestAs({ method: "POST", url, session: await createTestSession(user._id), body }));
    return { status: res.status, json: await res.json() };
  }

  const validate = (user, code, items) => call(validatePOST, "http://test/api/coupons/validate", user, { code, items });
  const preview = (user, code, items) =>
    call(previewPOST, "http://test/api/orders/preview", user, { items, shippingAddress: address, couponCode: code });
  const order = (user, code, items) =>
    call(createOrderPOST, "http://test/api/orders", user, { items, shippingAddress: address, couponCode: code });

  /** All three answers for one cart, asserting they agree on the discount. */
  async function priceEverywhere(user, code, items) {
    const v = await validate(user, code, items);
    const p = await preview(user, code, items);
    assert.equal(v.status, 200, JSON.stringify(v.json));
    assert.equal(p.status, 200, JSON.stringify(p.json));
    assert.equal(v.json.discount, p.json.preview.discount, "the coupon box and the order summary agree");
    const o = await order(user, code, items);
    assert.equal(o.status, 201, JSON.stringify(o.json));
    const [saved] = await rawQuery("SELECT subtotal, tax, shipping_cost AS shipping, discount, total FROM orders WHERE id = ?", [
      o.json.order._id,
    ]);
    const stored = Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, Number(v)]));
    const shown = p.json.preview;
    assert.deepEqual(
      stored,
      { subtotal: shown.subtotal, tax: shown.tax, shipping: shown.shippingCost, discount: shown.discount, total: shown.total },
      "the saved order carries exactly the previewed figures",
    );
    return shown;
  }

  const vatInside = (amount) => Math.round((amount * 0.15) / 1.15 + Number.EPSILON);

  test("a category-limited percentage coupon discounts only the lines in that category (mixed cart)", async () => {
    const user = await createTestUser();
    const [eligibleCat, otherCat] = [await category(), await category()];
    const eligible = await product(eligibleCat._id, 1000);
    const other = await product(otherCat._id, 3000);
    const c = await coupon({ discountType: "percentage", discountValue: 10, applicableCategories: [eligibleCat._id] });

    const shown = await priceEverywhere(user, c.code, [line(eligible), line(other)]);
    assert.equal(shown.subtotal, 4000);
    assert.equal(shown.discount, 100, "10% of the eligible 1000, not of the whole 4000");
    assert.equal(shown.shippingCost, 0, "4000 of goods is above the 2000 free-shipping threshold");
    assert.equal(shown.tax, vatInside(3900), "inclusive VAT is the VAT inside what was charged for goods");
    assert.equal(shown.total, 3900);
  });

  test("a coupon limited to a parent category covers products in its subcategories", async () => {
    const user = await createTestUser();
    const parent = await category();
    const child = await category(parent._id);
    const inChild = await product(child._id, 1500);
    const outside = await product((await category())._id, 1500);
    const c = await coupon({ discountType: "percentage", discountValue: 20, applicableCategories: [parent._id] });

    const shown = await priceEverywhere(user, c.code, [line(inChild), line(outside)]);
    assert.equal(shown.discount, 300, "20% of the 1500 under the parent category");
  });

  test("a flat coupon larger than the eligible goods is capped at them — shipping is still charged", async () => {
    const user = await createTestUser();
    const cat = await category();
    const small = await product(cat._id, 500);
    const c = await coupon({ discountType: "flat", discountValue: 5000, applicableCategories: [cat._id] });

    const shown = await priceEverywhere(user, c.code, [line(small)]);
    assert.equal(shown.discount, 500, "no more than the 500 of goods it covers");
    assert.equal(shown.shippingCost, 60, "500 is below the free-shipping threshold, so delivery is charged");
    assert.equal(shown.total, 60, "the shopper still pays for delivery");
    assert.equal(shown.tax, 0, "nothing was charged for goods, so no VAT on goods");
  });

  test("a flat unrestricted coupon larger than the cart is capped at the goods, not the order total", async () => {
    const user = await createTestUser();
    const p = await product((await category())._id, 800);
    const c = await coupon({ discountType: "flat", discountValue: 2000 });

    const shown = await priceEverywhere(user, c.code, [line(p)]);
    assert.equal(shown.discount, 800);
    assert.equal(shown.total, 60);
  });

  test("maxDiscount caps a category coupon's percentage on the eligible lines", async () => {
    const user = await createTestUser();
    const cat = await category();
    const p = await product(cat._id, 3000);
    const other = await product((await category())._id, 3000);
    const c = await coupon({ discountType: "percentage", discountValue: 50, maxDiscount: 400, applicableCategories: [cat._id] });

    const shown = await priceEverywhere(user, c.code, [line(p), line(other)]);
    assert.equal(shown.discount, 400, "50% of 3000 would be 1500; the cap is 400");
  });

  test("a coupon that covers nothing in the cart is refused everywhere, not applied as zero", async () => {
    const user = await createTestUser();
    const p = await product((await category())._id, 1000);
    const c = await coupon({ discountType: "percentage", discountValue: 10, applicableCategories: [(await category())._id] });
    const items = [line(p)];

    for (const r of [await validate(user, c.code, items), await preview(user, c.code, items), await order(user, c.code, items)]) {
      assert.equal(r.status, 400, JSON.stringify(r.json));
      assert.match(r.json.message, /does not apply to any item/);
    }
    const [{ used }] = await rawQuery("SELECT used_count AS used FROM coupons WHERE id = ?", [c._id]);
    assert.equal(Number(used), 0, "a refused coupon is not claimed");
  });

  test("the cart-less (subtotal-only) check refuses to price a category-limited coupon", async () => {
    const user = await createTestUser();
    const c = await coupon({ applicableCategories: [(await category())._id] });
    const r = await call(validatePOST, "http://test/api/coupons/validate", user, { code: c.code, subtotal: 5000 });
    assert.equal(r.status, 400);
    assert.match(r.json.message, /send the cart items/);
  });

  test("the free-shipping threshold is measured on the goods BEFORE the coupon", async () => {
    const user = await createTestUser();
    const p = await product((await category())._id, 2100);
    const c = await coupon({ discountType: "flat", discountValue: 300 });

    const shown = await priceEverywhere(user, c.code, [line(p)]);
    assert.equal(shown.discount, 300);
    assert.equal(shown.shippingCost, 0, "2100 of goods qualifies even though 1800 is paid for them");
  });

  test("with an EXCLUSIVE tax rule, tax is added on the goods after the discount", async () => {
    const user = await createTestUser();
    const [row] = await rawQuery("SELECT tax_rules FROM store_settings WHERE organization_id = ?", [orgId()]);
    const original = row?.tax_rules ?? null;
    await rawQuery("UPDATE store_settings SET tax_rules = ? WHERE organization_id = ?", [
      JSON.stringify([{ region: "BD", label: "VAT", rate: 0.1, inclusive: false }]),
      orgId(),
    ]);
    try {
      const p = await product((await category())._id, 3000);
      const c = await coupon({ discountType: "flat", discountValue: 1000 });
      const shown = await priceEverywhere(user, c.code, [line(p)]);
      assert.equal(shown.tax, 200, "10% of the 2000 actually charged, not of the 3000 list price");
      assert.equal(shown.total, 2200);
    } finally {
      await rawQuery("UPDATE store_settings SET tax_rules = ? WHERE organization_id = ?", [
        typeof original === "string" ? original : JSON.stringify(original),
        orgId(),
      ]);
    }
  });
});
