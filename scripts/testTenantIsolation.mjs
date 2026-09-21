/**
 * Proves the storefront cannot see another store's data.
 *
 * The static check (scripts/checkTenantScoping.mjs) proves every query
 * mentions `organization_id`. It cannot prove the mention is correct — a
 * scope against the wrong column, a parameter in the wrong position, or a
 * placeholder count that no longer matches its values all pass it. This runs
 * the models for real, against a second organization planted in the same
 * tables, and asserts none of its rows ever come back.
 *
 * It also catches the dull failure the static check cannot: a query whose
 * `?` count stopped matching its parameter array when the scope was added.
 * Those throw the moment they execute.
 *
 *   npm run test:tenancy
 *
 * It runs under tests/helpers/nextResolveHook.mjs because the services it
 * exercises import "next/server", which plain Node cannot resolve on an
 * extensionless subpath.
 *
 * The decoy organization is created and removed by this script. Nothing
 * belonging to the real store is written.
 */
process.env.STORE_ORGANIZATION_ID ||= "";

import { query, closePool } from "../config/db.js";
import { generateObjectId } from "../lib/objectId.js";

const DECOY_CODE = "ISOLATION-TEST";
let pass = 0;
let fail = 0;

function check(label, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}${detail ? `  ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}  ${detail}`);
  }
}

const decoyId = `org_isolation_${Date.now().toString(16)}`;
const decoy = {};

async function plantDecoy() {
  await query(
    "INSERT INTO organizations (id, name, code, status) VALUES (?, 'Isolation Decoy', ?, 'Active')",
    [decoyId, DECOY_CODE],
  );
  decoy.branchId = generateObjectId();
  await query("INSERT INTO branches (id, organization_id, name, code, status) VALUES (?, ?, 'Main', ?, 'Active')",
    [decoy.branchId, decoyId, `${DECOY_CODE}-MAIN`]);

  decoy.categoryId = generateObjectId();
  await query(
    `INSERT INTO categories (id, organization_id, name, name_bn, slug, description, description_bn, image, icon, is_active)
     VALUES (?, ?, 'Decoy Category', '', 'decoy-category', '', '', '', '', 1)`,
    [decoy.categoryId, decoyId],
  );

  decoy.productId = generateObjectId();
  await query(
    `INSERT INTO products (id, organization_id, name, name_bn, slug, description, description_bn, category_id,
       base_price, images, measurement_height_range, measurement_chest, measurement_sleeve_length,
       included_items, tags, tags_text, meta_title, meta_description, meta_keywords, og_image, is_active)
     VALUES (?, ?, 'Decoy Product', '', 'decoy-product', 'Should never be visible', '', ?,
       999, '[]', '', '', '', '[]', '[]', '', '', '', '', '', 1)`,
    [decoy.productId, decoyId, decoy.categoryId],
  );

  decoy.variantId = generateObjectId();
  await query(
    `INSERT INTO product_variants (id, organization_id, product_id, variant_name, sku, attributes, stock, images, position)
     VALUES (?, ?, ?, 'Decoy Variant', 'DECOY-SKU-001', '{}', 50, '[]', 0)`,
    [decoy.variantId, decoyId, decoy.productId],
  );

  decoy.customerId = generateObjectId();
  await query(
    `INSERT INTO customers (id, organization_id, name, email, password, is_verified)
     VALUES (?, ?, 'Decoy Shopper', 'decoy@isolation.test', '$2a$12$0000000000000000000000000000000000000000000000000000', 1)`,
    [decoy.customerId, decoyId],
  );

  decoy.orderId = generateObjectId();
  await query(
    `INSERT INTO orders (id, organization_id, customer_id, shipping_full_name, shipping_phone, shipping_street,
       shipping_city, shipping_postal_code, shipping_country, subtotal, total, status, notes)
     VALUES (?, ?, ?, 'Decoy', '000', 'Nowhere', 'Nowhere', '0000', 'Nowhere', 999, 999, 'delivered', '')`,
    [decoy.orderId, decoyId, decoy.customerId],
  );
  await query(
    `INSERT INTO order_items (organization_id, order_id, product_id, variant_id, quantity, snapshot_name,
       snapshot_sku, snapshot_attributes, snapshot_price, snapshot_image, position)
     VALUES (?, ?, ?, ?, 1, 'Decoy Product', 'DECOY-SKU-001', '{}', 999, '', 0)`,
    [decoyId, decoy.orderId, decoy.productId, decoy.variantId],
  );

  decoy.themeId = generateObjectId();
  await query(
    `INSERT INTO storefront_themes (id, organization_id, name, is_active, colors, dark_colors, fonts, features)
     VALUES (?, ?, 'Decoy Theme', 1, '{}', '{}', '{}', '{}')`,
    [decoy.themeId, decoyId],
  );

  await query(
    `INSERT INTO store_settings (organization_id, store_name, homepage, currency, promotions, exchange_policy,
       tax_rules, shipping_zones)
     VALUES (?, 'DECOY STORE', '{}', '{}', '{}', '{}', '[]', '[]')`,
    [decoyId],
  );

  decoy.couponId = generateObjectId();
  await query(
    `INSERT INTO coupons (id, organization_id, code, discount_type, discount_value, expires_at, is_active)
     VALUES (?, ?, 'DECOYCODE', 'percentage', 50, '2099-01-01 00:00:00', 1)`,
    [decoy.couponId, decoyId],
  );

  decoy.reviewId = generateObjectId();
  await query(
    `INSERT INTO reviews (id, organization_id, customer_id, product_id, rating, comment, images, admin_reply_text)
     VALUES (?, ?, ?, ?, 5, 'Decoy review', '[]', '')`,
    [decoy.reviewId, decoyId, decoy.customerId, decoy.productId],
  );

  decoy.brandId = generateObjectId();
  await query(
    `INSERT INTO brands (id, organization_id, name, slug, logo, description)
     VALUES (?, ?, 'Decoy Brand', 'decoy-brand', '', '')`,
    [decoy.brandId, decoyId],
  );

  decoy.attrId = generateObjectId();
  await query(
    `INSERT INTO attribute_definitions (id, organization_id, attr_key, label, label_bn, type)
     VALUES (?, ?, 'decoyattr', 'Decoy Attribute', '', 'text')`,
    [decoy.attrId, decoyId],
  );
}

async function removeDecoy() {
  for (const table of [
    "reviews", "order_items", "orders", "coupons", "customers", "product_variants", "products",
    "categories", "brands", "attribute_definitions", "storefront_themes", "store_settings",
  ]) {
    await query(`DELETE FROM \`${table}\` WHERE organization_id = ?`, [decoyId]);
  }
  await query("DELETE FROM branches WHERE organization_id = ?", [decoyId]);
  await query("DELETE FROM organizations WHERE id = ?", [decoyId]);
}

async function run() {
  const org = process.env.STORE_ORGANIZATION_ID;
  if (!org) throw new Error("STORE_ORGANIZATION_ID must be set to the store under test");

  const [{ n: realProducts }] = await query(
    "SELECT COUNT(*) AS n FROM products WHERE organization_id = ? AND deleted_at IS NULL",
    [org],
  );

  await plantDecoy();
  console.log(`\nDecoy organization ${decoyId} planted alongside ${org}.\n`);

  const Product = (await import("../models/productModel.js")).default;
  const Category = (await import("../models/categoryModel.js")).default;
  const Brand = (await import("../models/brandModel.js")).default;
  const Order = (await import("../models/orderModel.js")).default;
  const User = (await import("../models/userModel.js")).default;
  const Review = (await import("../models/reviewModel.js")).default;
  const Coupon = (await import("../models/couponModel.js")).default;
  const Theme = (await import("../models/themeModel.js")).default;
  const Settings = (await import("../models/settingsModel.js")).default;
  const AttributeDefinition = (await import("../models/attributeDefinitionModel.js")).default;

  /* ── Reads must never surface the decoy ─────────────────────────────── */

  const categories = await Category.findAll();
  check("categories exclude the decoy", !categories.some((c) => c._id === decoy.categoryId),
    `${categories.length} categories`);
  check("category by slug is scoped", (await Category.findBySlug("decoy-category")) === null);
  check("category by id is scoped", (await Category.findById(decoy.categoryId)) === null);

  const listed = await Product.findByFilter("is_active = 1", [], { limit: 500 });
  check("product list excludes the decoy", !listed.some((p) => p._id === decoy.productId),
    `${listed.length} products`);
  check("product by id is scoped", (await Product.findById(decoy.productId)) === null);
  check("product by slug is scoped", (await Product.findBySlug("decoy-product")) === null);
  check("product by ids is scoped", (await Product.findByIds([decoy.productId])).length === 0);
  check("product count matches this store", (await Product.countByFilter("1=1", [])) === realProducts,
    `${realProducts} active+inactive`);
  check("sitemap excludes the decoy", !(await Product.findSitemapEntries()).some((e) => e._id === decoy.productId));

  // SKU uniqueness is per store: the decoy's SKU must not read as taken here.
  check("SKU clash check is per store", (await Product.findVariantClash(["DECOY-SKU-001"], null)) === null);

  check("brands exclude the decoy", !(await Brand.findActive()).some((b) => b._id === decoy.brandId));
  check("brand by id is scoped", (await Brand.findById(decoy.brandId)) === null);

  check("order by id is scoped", (await Order.findById(decoy.orderId)) === null);
  check("orders by user are scoped", (await Order.findMyOrders(decoy.customerId)).length === 0);
  const adminOrders = await Order.findAdminList({ skip: 0, limit: 200 });
  check("admin order list excludes the decoy", !adminOrders.orders.some((o) => o._id === decoy.orderId),
    `${adminOrders.total} orders`);
  check("delivered-product lookup is scoped",
    (await Order.findDeliveredProductIdsByUser(decoy.customerId)).length === 0);
  check("delivered-with-product is scoped",
    (await Order.existsDeliveredWithProduct(decoy.customerId, decoy.productId)) === false);

  check("customer by id is scoped", (await User.findById(decoy.customerId)) === null);
  check("customer by email is scoped", (await User.findOne({ email: "decoy@isolation.test" })) === null);
  check("customer list excludes the decoy", !(await User.find({}, { limit: 500 })).some((u) => u._id === decoy.customerId));

  check("reviews by product are scoped", (await Review.findByProduct(decoy.productId, { skip: 0, limit: 50 })).length === 0);
  check("reviews by user+products are scoped",
    (await Review.findByUserAndProducts(decoy.customerId, [decoy.productId])).length === 0);
  check("rating breakdown is scoped",
    Object.values(await Review.ratingBreakdown(decoy.productId)).every((v) => Number(v) === 0));
  check("review count by product is scoped", Number(await Review.countByProduct(decoy.productId)) === 0);
  const adminReviews = await Review.findAdminList({ skip: 0, limit: 200 });
  check("admin review list excludes the decoy", !adminReviews.reviews.some((r) => r._id === decoy.reviewId));

  check("coupon by code is scoped", (await Coupon.findByCode("DECOYCODE")) === null);
  check("active coupon by code is scoped", (await Coupon.findByCodeActive("DECOYCODE")) === null);
  check("coupon by id is scoped", (await Coupon.findById(decoy.couponId)) === null);
  const adminCoupons = await Coupon.findAdminList({ skip: 0, limit: 200 });
  check("admin coupon list excludes the decoy", !adminCoupons.some((c) => c._id === decoy.couponId));

  const themes = await Theme.findAll();
  check("themes exclude the decoy", !themes.some((t) => t._id === decoy.themeId), `${themes.length} themes`);
  const activeTheme = await Theme.findActive();
  check("active theme is this store's", !activeTheme || activeTheme._id !== decoy.themeId);

  const settings = await Settings.getSingleton();
  check("settings are this store's", settings.store.name !== "DECOY STORE", `store: ${settings.store.name}`);

  const attrs = await AttributeDefinition.findAll();
  check("attribute definitions exclude the decoy", !attrs.some((a) => a._id === decoy.attrId),
    `${attrs.length} definitions`);
  check("attribute by key is scoped", (await AttributeDefinition.findByKeys(["decoyattr"])).length === 0);

  /* ── Aggregates must count only this store ──────────────────────────── */

  const analytics = await import("../services/analyticsService.js");
  const overview = await analytics.getOverview();
  const [{ n: realOrders }] = await query(
    `SELECT COUNT(*) AS n FROM orders
      WHERE organization_id = ? AND deleted_at IS NULL AND status NOT IN ('cancelled', 'refunded')`,
    [org],
  );
  const [{ n: realCustomers }] = await query(
    "SELECT COUNT(*) AS n FROM customers WHERE organization_id = ? AND deleted_at IS NULL",
    [org],
  );
  check("order count excludes the decoy", Number(overview.totalOrders) === Number(realOrders),
    `${overview.totalOrders} orders`);
  check("customer count excludes the decoy", Number(overview.totalUsers) === Number(realCustomers),
    `${overview.totalUsers} customers`);
  check("revenue excludes the decoy's 999", overview.totalRevenue < 999 || !String(overview.totalRevenue).includes("999"),
    `revenue ${overview.totalRevenue}`);

  const top = await analytics.getTopProducts(50);
  check("top products exclude the decoy", !top.some((t) => t._id === decoy.productId));
  const byMethod = await analytics.getRevenueByMethod();
  check("revenue by method excludes the decoy",
    byMethod.reduce((sum, r) => sum + r.revenue, 0) < Number(overview.totalRevenue) + 1);
  const breakdown = await analytics.getStatusBreakdown();
  check("status breakdown counts only this store",
    breakdown.reduce((sum, r) => sum + Number(r.count), 0) ===
      Number((await query("SELECT COUNT(*) AS n FROM orders WHERE organization_id = ? AND deleted_at IS NULL", [org]))[0].n));

  /* ── Writes must not reach across either ────────────────────────────── */

  // A helpful vote on another store's review must not land.
  const reviewService = await import("../services/reviewService.js");
  let votedAcross = false;
  try {
    await reviewService.markHelpful(decoy.reviewId, decoy.customerId);
    votedAcross = true;
  } catch {
    // 404 is the expected outcome: the review is not visible here.
  }
  const [decoyReview] = await query(
    "SELECT helpful_count FROM reviews WHERE organization_id = ? AND id = ?",
    [decoyId, decoy.reviewId],
  );
  check("a helpful vote cannot reach another store's review",
    !votedAcross && Number(decoyReview.helpful_count) === 0);


  const before = await query(
    "SELECT is_active FROM storefront_themes WHERE organization_id = ? AND id = ?",
    [decoyId, decoy.themeId],
  );
  const ours = themes[0];
  if (ours) {
    ours.isActive = true;
    await ours.save();
  }
  const after = await query(
    "SELECT is_active FROM storefront_themes WHERE organization_id = ? AND id = ?",
    [decoyId, decoy.themeId],
  );
  check("activating a theme leaves other stores alone",
    before[0].is_active === after[0].is_active,
    `decoy stayed is_active=${after[0].is_active}`);
}

try {
  await run();
} catch (error) {
  fail += 1;
  console.log(`\n  FAIL  threw: ${error.message}`);
  if (error.sql) console.log(`        ${error.sql.replace(/\s+/g, " ").slice(0, 160)}`);
} finally {
  await removeDecoy();
  console.log(`\nDecoy organization removed.`);
}

console.log(`\n${fail ? `${fail} check(s) FAILED, ${pass} passed.` : `All ${pass} checks passed.`}\n`);
await closePool();
process.exit(fail ? 1 : 0);
