// One-time (but safely repeatable) data migration: reads every document out
// of the OLD MongoDB database and upserts it into the NEW MySQL database
// (sql/schema.sql), preserving _id strings, relationships, timestamps, and
// password hashes exactly.
//
// READ-ONLY against MongoDB — this script never writes to, deletes from, or
// otherwise mutates the source database. It is safe to run it more than
// once: every write to MySQL is an upsert (INSERT ... ON DUPLICATE KEY
// UPDATE), so a re-run re-syncs rows that changed in Mongo since the last
// run and never duplicates or deletes anything.
//
// Usage:
//   node --env-file=.env scripts/migrateMongoToMysql.mjs
//
// Requires:
//   - MONGO_MIGRATION_URI in .env (the OLD MongoDB connection string — see
//     .env's own comment; this is deliberately a different variable name
//     than the app itself reads, so the app can never accidentally fall
//     back to it).
//   - DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD in .env (the target
//     MySQL database) with sql/schema.sql already imported into it.
//
// Prints a per-collection summary (source count / migrated / skipped /
// failed) and a list of any individual records that failed to migrate,
// with the reason — it does not abort the whole run on one bad record.

import { MongoClient } from "mongodb";

import { getPool, closePool } from "../config/db.js";
import { resolveSnapshotAttributes } from "../lib/legacySnapshotAttributes.js";

const MONGO_URI = process.env.MONGO_MIGRATION_URI;
if (!MONGO_URI) {
  console.error(
    "MONGO_MIGRATION_URI is not set. Add it to .env (see that file's own comment) — " +
      "the OLD MongoDB connection string, used only by this script.",
  );
  process.exit(1);
}

const report = []; // { collection, sourceCount, migrated, skipped, failed: [{id, reason}] }

function newReport(collection) {
  const r = { collection, sourceCount: 0, migrated: 0, skipped: 0, failed: [] };
  report.push(r);
  return r;
}

const oid = (v) => (v == null ? null : String(v));
const num = (v, fallback = 0) => (v == null ? fallback : Number(v));
const bool = (v) => (v ? 1 : 0);
const json = (v, fallback) => JSON.stringify(v ?? fallback);
const date = (v) => (v == null ? null : new Date(v));

async function upsert(pool, table, idColumn, id, columns, values) {
  const setClause = columns.map((c) => `${c} = VALUES(${c})`).join(", ");
  const sql = `INSERT INTO ${table} (${idColumn}, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})
               ON DUPLICATE KEY UPDATE ${setClause}`;
  await pool.query(sql, [id, ...values]);
}

/**
 * Some tables have a second UNIQUE column besides `id` (attribute_definitions.attr_key,
 * coupons.code, categories.slug, brands.slug) — if a row with the SAME
 * natural key but a DIFFERENT id already exists (e.g. because
 * `npm run seed` created it first, with a freshly-generated id), MySQL's
 * `ON DUPLICATE KEY UPDATE` still fires (any unique-key collision
 * triggers it, not just the primary key), but it updates THAT existing
 * row in place — the Mongo `_id` is never actually written anywhere. Code
 * that then inserts FK-CASCADE children keyed off the Mongo id (e.g.
 * attribute_definition_options.attribute_definition_id) would silently
 * insert against an id nothing references, and MySQL's real FK constraint
 * catches the mismatch immediately as an error. Call this AFTER upsert()
 * to get back whichever id the row actually ended up under, and use that
 * — never the raw Mongo id — for every child-table write.
 */
async function resolveActualId(pool, table, naturalKeyColumn, naturalKeyValue) {
  const [rows] = await pool.query(`SELECT id FROM ${table} WHERE ${naturalKeyColumn} = ? LIMIT 1`, [naturalKeyValue]);
  return rows[0]?.id ?? null;
}

async function migrateCollection(db, pool, collectionName, migrateOne, { collectionLabel } = {}) {
  const r = newReport(collectionLabel || collectionName);
  const cursor = db.collection(collectionName).find({});
  for await (const doc of cursor) {
    r.sourceCount++;
    try {
      const migrated = await migrateOne(doc);
      if (migrated === false) r.skipped++;
      else r.migrated++;
    } catch (err) {
      r.failed.push({ id: oid(doc._id), reason: err.message });
    }
  }
  return r;
}

async function main() {
  const mongo = new MongoClient(MONGO_URI, { readPreference: "secondaryPreferred" });
  await mongo.connect();
  const db = mongo.db(); // uses the database named in the URI's own path
  const pool = getPool();
  // Sanity check: prove we can reach MySQL and the schema is imported before touching Mongo at all.
  const [tables] = await pool.query("SHOW TABLES LIKE 'users'");
  if (!tables.length) {
    throw new Error('Target MySQL database has no "users" table — import sql/schema.sql into it first.');
  }

  console.log(`Source (read-only): MongoDB database "${db.databaseName}"`);
  console.log(`Target: MySQL database "${process.env.DB_NAME}"\n`);

  // ---- users (must run first — everything else references user ids) ----
  await migrateCollection(db, pool, "users", async (u) => {
    await upsert(
      pool,
      "users",
      "id",
      oid(u._id),
      ["name", "email", "password", "role", "permissions", "avatar", "phone", "is_verified", "reset_password_token", "reset_password_expires", "login_attempts", "lock_until", "last_login", "first_order_promo_used", "created_at", "updated_at"],
      [
        u.name,
        String(u.email || "").toLowerCase().trim(),
        u.password,
        u.role || "customer",
        json(u.permissions, []),
        u.avatar || "",
        u.phone || "",
        bool(u.isVerified),
        u.resetPasswordToken ?? null,
        date(u.resetPasswordExpires),
        num(u.loginAttempts),
        date(u.lockUntil),
        date(u.lastLogin),
        bool(u.firstOrderPromoUsed),
        date(u.createdAt) || new Date(),
        date(u.updatedAt) || new Date(),
      ],
    );
  });

  // ---- sessions ----
  await migrateCollection(db, pool, "sessions", async (s) => {
    if (!s.user) return false; // dangling/malformed — nothing to link to
    await upsert(
      pool,
      "sessions",
      "id",
      oid(s._id),
      ["user_id", "token_hash", "csrf_token_hash", "expires_at", "last_seen_at", "revoked_at", "user_agent", "created_at", "updated_at"],
      [oid(s.user), s.tokenHash, s.csrfTokenHash, date(s.expiresAt), date(s.lastSeenAt) || new Date(), date(s.revokedAt), s.userAgent || "", date(s.createdAt) || new Date(), date(s.updatedAt) || new Date()],
    );
  });

  // ---- brands ----
  await migrateCollection(db, pool, "brands", async (b) => {
    await upsert(
      pool,
      "brands",
      "id",
      oid(b._id),
      ["name", "slug", "logo", "description", "is_active", "created_at", "updated_at"],
      [b.name, b.slug, b.logo || "", b.description || "", bool(b.isActive !== false), date(b.createdAt) || new Date(), date(b.updatedAt) || new Date()],
    );
  });

  // ---- categories (self-referencing parent — one pass is fine since MySQL
  // has no FK constraint on parent_id here, see sql/schema.sql) ----
  await migrateCollection(db, pool, "categories", async (c) => {
    await upsert(
      pool,
      "categories",
      "id",
      oid(c._id),
      ["name", "name_bn", "slug", "parent_id", "image", "icon", "description", "description_bn", "sort_order", "is_active", "created_at", "updated_at"],
      [c.name, c.nameBn || "", c.slug, oid(c.parent), c.image || "", c.icon || "", c.description || "", c.descriptionBn || "", num(c.sortOrder), bool(c.isActive !== false), date(c.createdAt) || new Date(), date(c.updatedAt) || new Date()],
    );
  });

  // ---- attributedefinitions (+ options/labelOverrides/appliesToCategories) ----
  await migrateCollection(db, pool, "attributedefinitions", async (a) => {
    const mongoId = oid(a._id);
    await upsert(
      pool,
      "attribute_definitions",
      "id",
      mongoId,
      ["attr_key", "label", "label_bn", "type", "derived_from_variant", "filterable", "required", "sort_order", "created_at", "updated_at"],
      [a.key, a.label, a.labelBn || "", a.type, bool(a.derivedFromVariant), bool(a.filterable !== false), bool(a.required), num(a.sortOrder), date(a.createdAt) || new Date(), date(a.updatedAt) || new Date()],
    );
    // attr_key is separately UNIQUE — a pre-existing row under a different
    // id (e.g. from `npm run seed`) redirects the upsert above to THAT
    // row; every child write below must target its real id, not the raw
    // Mongo one (see resolveActualId()'s own comment).
    const id = (await resolveActualId(pool, "attribute_definitions", "attr_key", a.key)) || mongoId;
    await pool.query("DELETE FROM attribute_definition_options WHERE attribute_definition_id = ?", [id]);
    let pos = 0;
    for (const o of a.options || []) {
      await pool.query(
        "INSERT INTO attribute_definition_options (attribute_definition_id, value, label, label_bn, swatch_hex, position) VALUES (?, ?, ?, ?, ?, ?)",
        [id, o.value, o.label, o.labelBn || "", o.swatchHex || "", pos++],
      );
    }
    await pool.query("DELETE FROM attribute_definition_label_overrides WHERE attribute_definition_id = ?", [id]);
    for (const o of a.labelOverrides || []) {
      await pool.query(
        "INSERT INTO attribute_definition_label_overrides (attribute_definition_id, category_id, label, label_bn) VALUES (?, ?, ?, ?)",
        [id, oid(o.category), o.label, o.labelBn || ""],
      );
    }
    await pool.query("DELETE FROM attribute_definition_categories WHERE attribute_definition_id = ?", [id]);
    for (const categoryId of a.appliesToCategories || []) {
      await pool.query("INSERT IGNORE INTO attribute_definition_categories (attribute_definition_id, category_id) VALUES (?, ?)", [id, oid(categoryId)]);
    }
  });

  // ---- products (+ variants + denormalized attribute facets) ----
  await migrateCollection(db, pool, "products", async (p) => {
    const id = oid(p._id);
    const tags = p.tags || [];
    await upsert(
      pool,
      "products",
      "id",
      id,
      [
        "name", "name_bn", "slug", "description", "description_bn", "category_id", "top_category_id", "brand_id",
        "age_group", "base_price", "discount_price", "images", "measurement_height_range", "measurement_chest",
        "measurement_sleeve_length", "included_items", "availability", "tags", "tags_text", "rating", "num_reviews",
        "is_featured", "is_active", "meta_title", "meta_description", "meta_keywords", "og_image", "created_at", "updated_at",
      ],
      [
        p.name, p.nameBn || "", p.slug, p.description || "", p.descriptionBn || "", oid(p.category), oid(p.topCategory), oid(p.brand),
        p.ageGroup || "adult", num(p.basePrice), p.discountPrice ?? null, json(p.images, []), p.measurements?.heightRange || "",
        p.measurements?.chest || "", p.measurements?.sleeveLength || "", json(p.includedItems, []), p.availability || "readyStock",
        json(tags, []), tags.join(" "), num(p.rating), num(p.numReviews), bool(p.isFeatured), bool(p.isActive !== false),
        p.metaTitle || "", p.metaDescription || "", p.metaKeywords || "", p.ogImage || "", date(p.createdAt) || new Date(), date(p.updatedAt) || new Date(),
      ],
    );

    await pool.query("DELETE FROM product_variants WHERE product_id = ?", [id]);
    let vPos = 0;
    for (const v of p.variants || []) {
      await pool.query(
        `INSERT INTO product_variants (id, product_id, variant_name, sku, attributes, price, discount_price, stock, images, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [oid(v._id), id, v.variantName, v.sku, json(v.attributes, {}), v.price ?? null, v.discountPrice ?? null, num(v.stock), json(v.images, []), vPos++],
      );
    }

    await pool.query("DELETE FROM product_attributes WHERE product_id = ?", [id]);
    let aPos = 0;
    for (const a of p.attributes || []) {
      for (const value of a.values || []) {
        await pool.query("INSERT INTO product_attributes (product_id, attr_key, attr_value, position) VALUES (?, ?, ?, ?)", [id, a.key, value, aPos++]);
      }
    }
  });

  // ---- carts (+ items) ----
  await migrateCollection(db, pool, "carts", async (c) => {
    if (!c.userId) return false;
    const id = oid(c._id);
    await upsert(pool, "carts", "id", id, ["user_id", "created_at", "updated_at"], [oid(c.userId), date(c.createdAt) || new Date(), date(c.updatedAt) || new Date()]);
    await pool.query("DELETE FROM cart_items WHERE cart_id = ?", [id]);
    for (const item of c.items || []) {
      await pool.query(
        `INSERT INTO cart_items (id, cart_id, product_id, variant_id, quantity, snapshot_sku, snapshot_attributes, snapshot_price, snapshot_image)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [oid(item._id), id, oid(item.productId), oid(item.variantId), num(item.quantity, 1), item.snapshot?.sku || "", json(resolveSnapshotAttributes(item.snapshot), {}), item.snapshot?.price ?? null, item.snapshot?.image || ""],
      );
    }
  });

  // ---- coupons (+ applicableCategories) ----
  await migrateCollection(db, pool, "coupons", async (c) => {
    const mongoId = oid(c._id);
    const code = String(c.code || "").toUpperCase();
    await upsert(
      pool,
      "coupons",
      "id",
      mongoId,
      ["code", "discount_type", "discount_value", "min_order_amount", "max_discount", "usage_limit", "used_count", "per_user_limit", "expires_at", "is_active", "created_at", "updated_at"],
      [code, c.discountType, num(c.discountValue), num(c.minOrderAmount), c.maxDiscount ?? null, c.usageLimit ?? null, num(c.usedCount), c.perUserLimit ?? 1, date(c.expiresAt), bool(c.isActive !== false), date(c.createdAt) || new Date(), date(c.updatedAt) || new Date()],
    );
    // code is separately UNIQUE — see resolveActualId()'s comment.
    const id = (await resolveActualId(pool, "coupons", "code", code)) || mongoId;
    await pool.query("DELETE FROM coupon_categories WHERE coupon_id = ?", [id]);
    for (const categoryId of c.applicableCategories || []) {
      await pool.query("INSERT IGNORE INTO coupon_categories (coupon_id, category_id) VALUES (?, ?)", [id, oid(categoryId)]);
    }
  });

  // ---- couponusages ----
  await migrateCollection(db, pool, "couponusages", async (u) => {
    if (!u.coupon || !u.user) return false;
    await upsert(pool, "coupon_usages", "id", oid(u._id), ["coupon_id", "user_id", "count", "created_at", "updated_at"], [oid(u.coupon), oid(u.user), num(u.count), date(u.createdAt) || new Date(), date(u.updatedAt) || new Date()]);
  });

  // ---- orders (+ items) ----
  await migrateCollection(db, pool, "orders", async (o) => {
    const id = oid(o._id);
    const addr = o.shippingAddress || {};
    await upsert(
      pool,
      "orders",
      "id",
      id,
      [
        "user_id", "coupon_id", "shipping_full_name", "shipping_phone", "shipping_street", "shipping_city",
        "shipping_state", "shipping_postal_code", "shipping_country", "subtotal", "tax", "tax_label", "shipping_cost",
        "shipping_tier", "discount", "total", "region", "currency", "status", "payment_method", "tracking_number",
        "delivered_at", "notes", "idempotency_key_hash", "idempotency_request_hash", "created_at", "updated_at",
      ],
      [
        oid(o.user), oid(o.coupon), addr.fullName || "", addr.phone || "", addr.street || "", addr.city || "",
        addr.state || "", addr.postalCode || "", addr.country || "", num(o.subtotal), num(o.tax), o.taxLabel || "",
        num(o.shippingCost), o.shippingTier || "", num(o.discount), num(o.total), o.region || "BD", o.currency || "BDT",
        o.status || "pending", o.paymentMethod || "", o.trackingNumber || "", date(o.deliveredAt), o.notes || "",
        o.idempotencyKeyHash ?? null, o.idempotencyRequestHash ?? null, date(o.createdAt) || new Date(), date(o.updatedAt) || new Date(),
      ],
    );
    await pool.query("DELETE FROM order_items WHERE order_id = ?", [id]);
    let pos = 0;
    for (const it of o.items || []) {
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, variant_id, quantity, snapshot_name, snapshot_sku, snapshot_attributes, snapshot_price, snapshot_image, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, oid(it.product), oid(it.variantId), num(it.quantity, 1), it.snapshot?.name || "", it.snapshot?.sku || "", json(resolveSnapshotAttributes(it.snapshot), {}), num(it.snapshot?.price), it.snapshot?.image || "", pos++],
      );
    }
  });

  // ---- payments ----
  await migrateCollection(db, pool, "payments", async (p) => {
    if (!p.order || !p.user) return false;
    await upsert(
      pool,
      "payments",
      "id",
      oid(p._id),
      ["order_id", "user_id", "method", "status", "transaction_id", "gateway_response", "amount", "currency", "paid_at", "refunded_at", "refund_reason", "created_at", "updated_at"],
      [oid(p.order), oid(p.user), p.method, p.status || "pending", p.transactionId || "", json(p.gatewayResponse, {}), num(p.amount), p.currency || "BDT", date(p.paidAt), date(p.refundedAt), p.refundReason || "", date(p.createdAt) || new Date(), date(p.updatedAt) || new Date()],
    );
  });

  // ---- addresses ----
  await migrateCollection(db, pool, "addresses", async (a) => {
    if (!a.user) return false;
    await upsert(
      pool,
      "addresses",
      "id",
      oid(a._id),
      ["user_id", "label", "full_name", "phone", "street", "city", "state", "postal_code", "country", "is_default", "created_at", "updated_at"],
      [oid(a.user), a.label || "home", a.fullName, a.phone, a.street, a.city, a.state || "", a.postalCode, a.country || "Bangladesh", bool(a.isDefault), date(a.createdAt) || new Date(), date(a.updatedAt) || new Date()],
    );
  });

  // ---- wishlists (+ items) ----
  await migrateCollection(db, pool, "wishlists", async (w) => {
    if (!w.user) return false;
    const id = oid(w._id);
    await upsert(pool, "wishlists", "id", id, ["user_id", "created_at", "updated_at"], [oid(w.user), date(w.createdAt) || new Date(), date(w.updatedAt) || new Date()]);
    await pool.query("DELETE FROM wishlist_items WHERE wishlist_id = ?", [id]);
    for (const productId of w.products || []) {
      await pool.query("INSERT IGNORE INTO wishlist_items (wishlist_id, product_id) VALUES (?, ?)", [id, oid(productId)]);
    }
  });

  // ---- notifications ----
  await migrateCollection(db, pool, "notifications", async (n) => {
    if (!n.recipient) return false;
    await upsert(
      pool,
      "notifications",
      "id",
      oid(n._id),
      ["recipient_id", "message", "url", "read_at", "created_at", "updated_at"],
      [oid(n.recipient), n.message, n.url || "", date(n.readAt), date(n.createdAt) || new Date(), date(n.updatedAt) || new Date()],
    );
  });

  // ---- reviews ----
  await migrateCollection(db, pool, "reviews", async (r) => {
    if (!r.user || !r.product) return false;
    await upsert(
      pool,
      "reviews",
      "id",
      oid(r._id),
      ["user_id", "product_id", "rating", "title", "comment", "is_verified_purchase", "images", "helpful_count", "admin_reply_text", "admin_reply_by", "admin_reply_at", "created_at", "updated_at"],
      [oid(r.user), oid(r.product), num(r.rating), r.title || "", r.comment || "", bool(r.isVerifiedPurchase), json(r.images, []), num(r.helpfulCount), r.adminReply?.text || "", oid(r.adminReply?.repliedBy), date(r.adminReply?.repliedAt), date(r.createdAt) || new Date(), date(r.updatedAt) || new Date()],
    );
  });

  // ---- promotions ----
  await migrateCollection(db, pool, "promotions", async (p) => {
    await upsert(
      pool,
      "promotions",
      "id",
      oid(p._id),
      [
        "name", "type", "placement", "status", "title", "title_bn", "subtitle", "subtitle_bn", "cta_label", "cta_label_bn",
        "desktop_image", "mobile_image", "image_alt", "image_alt_bn", "target_type", "target_product_id", "target_category_id",
        "target_collection", "target_shop_filter_category_id", "target_shop_filter_collection", "target_shop_filter_style_id",
        "target_url", "start_at", "end_at", "priority", "sort_order", "audience", "page_scope", "popup_delay_ms", "frequency",
        "cooldown_hours", "version", "created_by", "updated_by", "created_at", "updated_at",
      ],
      [
        p.name, p.type, p.placement, p.status || "draft", p.title || "", p.titleBn || "", p.subtitle || "", p.subtitleBn || "",
        p.ctaLabel || "", p.ctaLabelBn || "", p.desktopImage, p.mobileImage || "", p.imageAlt || "", p.imageAltBn || "",
        p.targetType || "none", oid(p.targetProduct), oid(p.targetCategory), p.targetCollection ?? null,
        oid(p.targetShopFilter?.category), p.targetShopFilter?.collection ?? null, oid(p.targetShopFilter?.style),
        p.targetUrl || "", date(p.startAt), date(p.endAt), num(p.priority), num(p.sortOrder), p.audience || "all",
        p.pageScope || "home", num(p.popupDelayMs, 2000), p.frequency || "once_per_session", p.cooldownHours ?? null,
        num(p.version, 1), oid(p.createdBy), oid(p.updatedBy), date(p.createdAt) || new Date(), date(p.updatedAt) || new Date(),
      ],
    );
  });

  // ---- settings (singleton, id="main") ----
  await migrateCollection(db, pool, "settings", async (s) => {
    await upsert(
      pool,
      "settings",
      "id",
      "main",
      ["store_name", "store_support_email", "store_support_phone", "store_logo_url", "store_logo_dark_url", "store_favicon_url", "homepage", "currency", "promotions", "exchange_policy", "tax_rules", "shipping_zones", "created_at", "updated_at"],
      [
        s.store?.name || "My Store", s.store?.supportEmail || "", s.store?.supportPhone || "", s.store?.logoUrl || "",
        s.store?.logoDarkUrl || "", s.store?.faviconUrl || "", json(s.homepage, {}), json(s.currency, {}),
        json(s.promotions, {}), json(s.exchangePolicy, {}), json(s.taxRules, []), json(s.shippingZones, []),
        date(s.createdAt) || new Date(), date(s.updatedAt) || new Date(),
      ],
    );
  });

  // ---- themes ----
  await migrateCollection(db, pool, "themes", async (t) => {
    await upsert(
      pool,
      "themes",
      "id",
      oid(t._id),
      ["name", "is_active", "colors", "dark_colors", "fonts", "radius", "shadow_style", "density", "logo_url", "logo_dark_url", "favicon_url", "site_name", "tagline", "features", "updated_by", "created_at", "updated_at"],
      [
        t.name || "Default", bool(t.isActive), json(t.colors, {}), json(t.darkColors, {}), json(t.fonts, {}), t.radius || "0.75rem",
        t.shadowStyle || "soft", t.density || "comfortable", t.logoUrl || "", t.logoDarkUrl || "", t.faviconUrl || "",
        t.siteName || "TAHOS.", t.tagline || "", json(t.features, {}), oid(t.updatedBy), date(t.createdAt) || new Date(), date(t.updatedAt) || new Date(),
      ],
    );
  });

  await mongo.close();

  // -------------------------------------------------- Relationship checks
  // Informational only — MongoDB never enforced these either (see
  // sql/schema.sql's header comment on why MySQL doesn't add FK
  // constraints for cross-entity references), so a dangling reference here
  // reflects pre-existing source data, not something this migration
  // introduced. Reported so you can decide whether it's expected (e.g. an
  // order placed by a since-deleted user) or a real data-quality issue.
  const relationshipChecks = [
    ["orders with a user_id that doesn't exist", "SELECT COUNT(*) AS n FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE u.id IS NULL"],
    ["order_items with a product_id that doesn't exist", "SELECT COUNT(*) AS n FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE p.id IS NULL"],
    ["products with a category_id that doesn't exist", "SELECT COUNT(*) AS n FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE c.id IS NULL"],
    ["reviews with a user_id or product_id that doesn't exist", "SELECT COUNT(*) AS n FROM reviews r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN products p ON p.id = r.product_id WHERE u.id IS NULL OR p.id IS NULL"],
    ["cart_items with a product_id that doesn't exist", "SELECT COUNT(*) AS n FROM cart_items ci LEFT JOIN products p ON p.id = ci.product_id WHERE p.id IS NULL"],
  ];
  const relationshipWarnings = [];
  for (const [label, sql] of relationshipChecks) {
    const [rows] = await pool.query(sql);
    if (rows[0].n > 0) relationshipWarnings.push(`${rows[0].n} ${label}`);
  }

  await closePool();

  // ---------------------------------------------------------------- Report
  console.log("\n================ Migration report ================");
  let anyFailed = false;
  for (const r of report) {
    console.log(`${r.collection.padEnd(24)} source=${r.sourceCount}  migrated=${r.migrated}  skipped=${r.skipped}  failed=${r.failed.length}`);
    if (r.failed.length) {
      anyFailed = true;
      for (const f of r.failed) console.log(`    ✖ _id=${f.id}: ${f.reason}`);
    }
  }
  console.log("====================================================");
  if (relationshipWarnings.length) {
    console.log("\nRelationship warnings (informational — see comment above this check in the script):");
    for (const w of relationshipWarnings) console.log(`  ⚠ ${w}`);
  }
  if (anyFailed) {
    console.log("\nSome records failed to migrate — see ✖ lines above. Nothing was deleted from MongoDB; fix the underlying data and re-run this script (it's safe to re-run).");
    process.exit(1);
  }
  console.log("\nDone. MongoDB was not modified. Verify counts above match your expectations before decommissioning it.");
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await closePool().catch(() => {});
  process.exit(1);
});
