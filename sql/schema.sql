-- =============================================================================
-- ladies_multi_ecomm — MySQL/MariaDB schema (migrated from MongoDB/Mongoose)
-- =============================================================================
--
-- HOW TO IMPORT: open phpMyAdmin -> create/select database "ladies_multi_ecomm"
-- (utf8mb4_unicode_ci) -> Import -> choose this file -> Go. Safe to re-run:
-- every statement is CREATE TABLE IF NOT EXISTS, so importing twice never
-- drops or truncates anything. This file never contains DROP/TRUNCATE/DELETE.
--
-- ENGINE: InnoDB everywhere (required for FOREIGN KEY + transactions — order
-- creation/cancellation need real ACID transactions, see services/orderService.js).
-- CHARSET: utf8mb4 / utf8mb4_unicode_ci everywhere, for correct Bangla (and
-- any other Unicode) text storage — utf8mb4 is required because plain MySQL
-- "utf8" is a legacy 3-byte encoding that cannot store the full Unicode range.
--
-- ID STRATEGY: every business-entity primary key is CHAR(24), storing the
-- exact same lowercase-hex MongoDB ObjectId string the document had in
-- Mongo (a real ObjectId is 12 bytes = 24 hex chars). This is deliberate,
-- not a placeholder:
--   - Preserves every existing externally-visible id (order confirmation
--     numbers are `_id.slice(-6)`, product slugs embed `_id.slice(-6)`,
--     URLs like /product/<slug>-<id-tail> and /orders/<id> all keep working).
--   - lib/objectId.js's generateObjectId() produces new ids in the exact
--     same 24-hex-char, roughly time-sortable format for every INSERT made
--     by the migrated app — nothing downstream (routes, tests, the
--     migration script's own id preservation) has to special-case "old
--     Mongo-style id" vs "new MySQL-style id".
--   - EXCEPTION: `events` and `rate_limit_counters` use a plain
--     AUTO_INCREMENT BIGINT id instead. Neither is a business entity a user
--     ever sees or an id anything external references — `events` is a
--     short-lived (10 min) SSE outbox whose whole job is a real monotonic
--     cursor (matching the old `_id` insertion-order cursor semantics
--     exactly, which AUTO_INCREMENT gives natively), and
--     `rate_limit_counters` is a purely internal fixed-window bucket.
--
-- REFERENTIAL INTEGRITY (read before changing FK behavior): MongoDB never
-- enforced any of these relationships — deleting a user, product, or
-- category never cascaded or was blocked by the database. Some of that is
-- intentional application behavior this schema must keep byte-for-byte:
--   - deleteProduct() is a SOFT delete (isActive=false) — products are
--     never actually removed by the app, so no FK question even arises
--     for "what references a deleted product" in practice.
--   - deleteCategory() hard-deletes, but only after an application-level
--     check that counts children/ACTIVE products referencing it (inactive
--     products may still reference a deleted category — allowed today).
--   - deleteUser() hard-deletes a non-admin user WITHOUT touching their
--     historical orders/reviews/addresses/sessions/etc — those rows are
--     left with a "dangling" user reference on purpose (order history must
--     survive account deletion).
-- A real FOREIGN KEY with RESTRICT would make some of these deletes start
-- failing (wrong); CASCADE would silently destroy order/review history the
-- day a user is deleted (worse, and explicitly forbidden by this migration's
-- "do not overwrite/destroy existing records" requirement). So: columns
-- that reference an independent top-level entity (user_id, product_id,
-- category_id, brand_id, coupon_id, variant_id, ...) are plain indexed
-- columns with NO foreign key constraint — exactly Mongo's own guarantee,
-- no more and no less. FOREIGN KEY ... ON DELETE CASCADE is used ONLY for
-- genuine owned-subdocument relationships (a product's variants/images, an
-- order's line items, ...) — rows that were literally embedded arrays
-- inside one Mongo document and must disappear together with their parent,
-- exactly as they did before.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- =============================================================================
-- Users, sessions, rate limiting (auth foundation — everything else depends
-- on `users` existing first)
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
  id CHAR(24) NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(320) NOT NULL,
  -- bcrypt hash (produced by bcryptjs, unchanged from the Mongo app) — always
  -- 60 chars, 255 leaves headroom without meaning anything.
  password VARCHAR(255) NOT NULL,
  role ENUM('customer', 'employee', 'admin') NOT NULL DEFAULT 'customer',
  -- JSON array of permission strings (models/userModel.js's `permissions: [String]`).
  permissions JSON NOT NULL,
  avatar VARCHAR(1024) NOT NULL DEFAULT '',
  phone VARCHAR(64) NOT NULL DEFAULT '',
  is_verified TINYINT(1) NOT NULL DEFAULT 0,
  reset_password_token VARCHAR(255) NULL,
  reset_password_expires DATETIME(3) NULL,
  login_attempts INT NOT NULL DEFAULT 0,
  lock_until DATETIME(3) NULL,
  last_login DATETIME(3) NULL,
  first_order_promo_used TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(24) NOT NULL,
  user_id CHAR(24) NOT NULL,
  -- SHA-256 hex digest, 64 chars — the raw token is never stored (see lib/session.js).
  token_hash CHAR(64) NOT NULL,
  csrf_token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  last_seen_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  user_agent VARCHAR(200) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token_hash (token_hash),
  KEY idx_sessions_user (user_id, revoked_at),
  -- TTL cleanup backstop (Mongo used a TTL index on expiresAt). MySQL has no
  -- native TTL index; scripts/cleanupExpired.mjs deletes rows where
  -- expires_at < NOW(), same as Mongo's background sweep — a storage-
  -- reclamation backstop only, never relied on for correctness (every
  -- authenticated request re-checks expires_at/revoked_at explicitly, see
  -- lib/session.js).
  KEY idx_sessions_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  -- No separate AUTO_INCREMENT surrogate id (deliberately, unlike every
  -- other AUTO_INCREMENT-exception table's shape) — models/rateLimitModel.js's
  -- atomic upsert-and-increment reads back the new count via MySQL's
  -- `LAST_INSERT_ID(expr)` idiom, which is a per-CONNECTION session value.
  -- An AUTO_INCREMENT column on the SAME table competes for that session
  -- value on a plain INSERT (MySQL/MariaDB overwrite it with the column's
  -- own generated value after the statement finishes, even when the insert
  -- expression itself calls `LAST_INSERT_ID(1)`) — confirmed empirically
  -- against MariaDB 10.4, not just a theoretical concern. Making the
  -- natural composite key the PRIMARY KEY removes that competing value
  -- entirely, so `LAST_INSERT_ID(count + 1)` / `LAST_INSERT_ID(1)` are the
  -- only thing ever setting the session's last-insert-id on this table.
  key_hash CHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  window_start DATETIME(3) NOT NULL,
  count INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- Same role as Mongo's unique {keyHash,action,windowStart} index: makes
  -- the atomic upsert-and-increment (lib/rateLimit.js) converge concurrent
  -- first-hits-in-a-new-window onto one row instead of creating duplicates.
  PRIMARY KEY (key_hash, action, window_start),
  KEY idx_rate_limit_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Catalog: brands, categories, attribute definitions
-- =============================================================================

CREATE TABLE IF NOT EXISTS brands (
  id CHAR(24) NOT NULL,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  logo VARCHAR(1024) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_brands_name (name),
  UNIQUE KEY uq_brands_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id CHAR(24) NOT NULL,
  name VARCHAR(255) NOT NULL,
  name_bn VARCHAR(255) NOT NULL DEFAULT '',
  slug VARCHAR(255) NOT NULL,
  -- No FK: categories.parent is a self-reference and MUST allow the exact
  -- same "delete a category, children keep a dangling parent id" behavior
  -- Mongo has today (deleteCategory() already blocks deleting a category
  -- that still has children at the application level — see categoryService.js
  -- — so in practice this column is never actually left dangling, but the
  -- schema itself must not add a stricter guarantee than the app enforces).
  parent_id CHAR(24) NULL,
  image VARCHAR(1024) NOT NULL DEFAULT '',
  icon VARCHAR(120) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  description_bn TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug),
  KEY idx_categories_parent_sort (parent_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attribute_definitions (
  id CHAR(24) NOT NULL,
  attr_key VARCHAR(100) NOT NULL,
  label VARCHAR(255) NOT NULL,
  label_bn VARCHAR(255) NOT NULL DEFAULT '',
  type ENUM('select', 'swatch', 'boolean', 'text') NOT NULL,
  derived_from_variant TINYINT(1) NOT NULL DEFAULT 0,
  filterable TINYINT(1) NOT NULL DEFAULT 1,
  required TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_attribute_definitions_key (attr_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Owned subdocument (attributeDefinition.options[]) -> cascades with parent.
CREATE TABLE IF NOT EXISTS attribute_definition_options (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  attribute_definition_id CHAR(24) NOT NULL,
  value VARCHAR(255) NOT NULL,
  label VARCHAR(255) NOT NULL,
  label_bn VARCHAR(255) NOT NULL DEFAULT '',
  swatch_hex VARCHAR(32) NOT NULL DEFAULT '',
  position INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_attr_options_def (attribute_definition_id, position),
  CONSTRAINT fk_attr_options_def FOREIGN KEY (attribute_definition_id)
    REFERENCES attribute_definitions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Owned subdocument (attributeDefinition.labelOverrides[]) -> cascades with parent.
CREATE TABLE IF NOT EXISTS attribute_definition_label_overrides (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  attribute_definition_id CHAR(24) NOT NULL,
  category_id CHAR(24) NOT NULL,
  label VARCHAR(255) NOT NULL,
  label_bn VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_attr_overrides_def (attribute_definition_id),
  CONSTRAINT fk_attr_overrides_def FOREIGN KEY (attribute_definition_id)
    REFERENCES attribute_definitions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Join table (attributeDefinition.appliesToCategories[]) -> cascades with parent definition.
CREATE TABLE IF NOT EXISTS attribute_definition_categories (
  attribute_definition_id CHAR(24) NOT NULL,
  category_id CHAR(24) NOT NULL,
  PRIMARY KEY (attribute_definition_id, category_id),
  CONSTRAINT fk_attr_def_categories_def FOREIGN KEY (attribute_definition_id)
    REFERENCES attribute_definitions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Products, variants, images, denormalized facet attributes
-- =============================================================================

CREATE TABLE IF NOT EXISTS products (
  id CHAR(24) NOT NULL,
  name VARCHAR(500) NOT NULL,
  name_bn VARCHAR(500) NOT NULL DEFAULT '',
  slug VARCHAR(600) NOT NULL,
  description LONGTEXT NOT NULL,
  description_bn LONGTEXT NOT NULL,
  -- No FK on category_id/top_category_id/brand_id — see header comment.
  category_id CHAR(24) NOT NULL,
  top_category_id CHAR(24) NULL,
  brand_id CHAR(24) NULL,
  age_group ENUM('adult', 'kids', 'girls') NOT NULL DEFAULT 'adult',
  base_price DECIMAL(12,2) NOT NULL,
  discount_price DECIMAL(12,2) NULL,
  -- Transitional column for the BDT-only currency migration (see
  -- docs/CURRENCY_MIGRATION_PLAN.md and scripts/migrations/0003_*): most
  -- catalog prices are USD-denominated (converted to BDT at display/
  -- checkout time via the live exchange rate); a product is flipped to
  -- 'BDT' once its base_price/discount_price/variant prices have been
  -- migrated to true, already-BDT values that must NEVER be multiplied by
  -- the exchange rate again. Once every product is 'BDT', this column
  -- (and the exchange-rate conversion path entirely) can be dropped.
  -- Default is 'BDT', not 'USD': every product has been migrated (see
  -- scripts/migrations/0003_bdt_price_currency.mjs / 0004_bdt_hijab_burqa.mjs)
  -- and the store is BDT-only going forward — a fresh install, and every
  -- new product created from now on, should assume BDT unless a future
  -- multi-currency relaunch reintroduces USD deliberately.
  price_currency ENUM('USD', 'BDT') NOT NULL DEFAULT 'BDT',
  -- JSON string array — display-only, never individually queried (see header).
  images JSON NOT NULL,
  measurement_height_range VARCHAR(120) NOT NULL DEFAULT '',
  measurement_chest VARCHAR(120) NOT NULL DEFAULT '',
  measurement_sleeve_length VARCHAR(120) NOT NULL DEFAULT '',
  -- JSON string array (product.includedItems) — bundle contents, display-only.
  included_items JSON NOT NULL,
  availability ENUM('readyStock', 'preOrder', 'madeToOrder') NOT NULL DEFAULT 'readyStock',
  -- JSON string array for display/round-tripping; tags_text (below) is the
  -- flattened copy actually indexed for full-text search.
  tags JSON NOT NULL,
  tags_text TEXT NOT NULL,
  rating DECIMAL(3,2) NOT NULL DEFAULT 0,
  num_reviews INT NOT NULL DEFAULT 0,
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  meta_title VARCHAR(255) NOT NULL DEFAULT '',
  meta_description VARCHAR(500) NOT NULL DEFAULT '',
  meta_keywords VARCHAR(500) NOT NULL DEFAULT '',
  og_image VARCHAR(1024) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_slug (slug),
  KEY idx_products_category (category_id, top_category_id, age_group),
  KEY idx_products_base_price (base_price),
  KEY idx_products_active_created (is_active, created_at DESC),
  KEY idx_products_active_topcat_created (is_active, top_category_id, created_at DESC),
  KEY idx_products_featured (is_featured, is_active, rating DESC),
  KEY idx_products_name (name),
  KEY idx_products_brand (brand_id),
  -- Mongo had exactly one text index across name/description/tags/attribute
  -- values. MySQL/MariaDB FULLTEXT covers name/description/tags_text here;
  -- an attribute-value match (e.g. searching "nida") is additionally
  -- covered in the application query layer with a supplementary join
  -- against product_attributes (see models/productModel.js's searchProducts()).
  FULLTEXT KEY ftx_products_search (name, description, tags_text)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Owned subdocument (product.variants[]) -> cascades with parent product.
-- Referenced BY id from cart_items/order_items/wishlist (variant_id) exactly
-- like Mongo (a subdocument _id, not a top-level collection ref) — no FK
-- from those tables back to this one, same reasoning as the header comment.
CREATE TABLE IF NOT EXISTS product_variants (
  id CHAR(24) NOT NULL,
  product_id CHAR(24) NOT NULL,
  variant_name VARCHAR(255) NOT NULL,
  sku VARCHAR(255) NOT NULL,
  -- JSON object (variant.attributes Mixed bag) — e.g. {"color":"Black","size":"XL"}.
  attributes JSON NOT NULL,
  price DECIMAL(12,2) NULL,
  discount_price DECIMAL(12,2) NULL,
  stock INT NOT NULL DEFAULT 0,
  images JSON NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_product_variants_product (product_id, position),
  -- Confirmed audit finding, fixed: previously a plain (non-unique) KEY,
  -- enforcement left entirely to services/productService.js's
  -- assertSkusUnique() check-then-insert (a real TOCTOU gap under
  -- concurrent admin writes). This UNIQUE constraint only benefits a
  -- brand-new database import — an already-deployed database must run
  -- scripts/migrations/0002_product_variants_sku_unique.mjs instead (which
  -- refuses to apply while any duplicate SKU still exists — see that
  -- file and docs/CATALOG_REPAIR_PROPOSAL.md for the exact conflicts
  -- found in this project's dev database and how to resolve them).
  UNIQUE KEY uq_product_variants_sku (sku),
  CONSTRAINT fk_product_variants_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Denormalized facet table (product.attributes[] = [{key, values[]}], one
-- row per key/value pair) — this IS the thing filter queries actually hit
-- (mirrors Mongo's {"attributes.key":1,"attributes.values":1} index).
-- Owned subdocument -> cascades with parent product.
CREATE TABLE IF NOT EXISTS product_attributes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id CHAR(24) NOT NULL,
  attr_key VARCHAR(100) NOT NULL,
  attr_value VARCHAR(255) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_product_attributes_product (product_id),
  KEY idx_product_attributes_facet (attr_key, attr_value),
  CONSTRAINT fk_product_attributes_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Cart
-- =============================================================================

CREATE TABLE IF NOT EXISTS carts (
  id CHAR(24) NOT NULL,
  user_id CHAR(24) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_carts_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Owned subdocument (cart.items[]) -> cascades with parent cart. No FK to
-- products/variants (see header comment) — product_id/variant_id are plain
-- indexed columns, exactly like the Mongo document's own fields.
CREATE TABLE IF NOT EXISTS cart_items (
  id CHAR(24) NOT NULL,
  cart_id CHAR(24) NOT NULL,
  product_id CHAR(24) NOT NULL,
  variant_id CHAR(24) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  snapshot_sku VARCHAR(255) NOT NULL DEFAULT '',
  snapshot_attributes JSON NOT NULL,
  snapshot_price DECIMAL(12,2) NULL,
  snapshot_image VARCHAR(1024) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_cart_items_line (cart_id, product_id, variant_id),
  CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id)
    REFERENCES carts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Coupons
-- =============================================================================

CREATE TABLE IF NOT EXISTS coupons (
  id CHAR(24) NOT NULL,
  code VARCHAR(64) NOT NULL,
  discount_type ENUM('percentage', 'flat') NOT NULL,
  discount_value DECIMAL(12,2) NOT NULL,
  min_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  max_discount DECIMAL(12,2) NULL,
  usage_limit INT NULL,
  used_count INT NOT NULL DEFAULT 0,
  per_user_limit INT NULL DEFAULT 1,
  expires_at DATETIME(3) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_coupons_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Join table (coupon.applicableCategories[]) -> cascades with parent coupon.
CREATE TABLE IF NOT EXISTS coupon_categories (
  coupon_id CHAR(24) NOT NULL,
  category_id CHAR(24) NOT NULL,
  PRIMARY KEY (coupon_id, category_id),
  CONSTRAINT fk_coupon_categories_coupon FOREIGN KEY (coupon_id)
    REFERENCES coupons (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Independent top-level collection (models/couponUsageModel.js) — the
-- atomic per-user-claim row. No FK to coupons/users (see header comment);
-- the unique index is what the guarded-upsert claim in
-- services/orderService.js relies on for atomicity, exactly as in Mongo.
CREATE TABLE IF NOT EXISTS coupon_usages (
  id CHAR(24) NOT NULL,
  coupon_id CHAR(24) NOT NULL,
  user_id CHAR(24) NOT NULL,
  count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_coupon_usages_coupon_user (coupon_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Orders, order items, payments
-- =============================================================================

CREATE TABLE IF NOT EXISTS orders (
  id CHAR(24) NOT NULL,
  -- No FK (see header comment — deleteUser() must not be blocked by, or
  -- cascade into, historical order data).
  user_id CHAR(24) NOT NULL,
  -- No FK to coupons — an order keeps referencing the coupon it used even
  -- if that coupon is later deleted (coupons currently have no delete route
  -- at all, but the schema shouldn't assume that never changes).
  coupon_id CHAR(24) NULL,
  -- Shipping address is a point-in-time snapshot (never a live join to
  -- `addresses`), so it's inlined exactly like the embedded Mongo subdocument.
  shipping_full_name VARCHAR(255) NOT NULL,
  shipping_phone VARCHAR(64) NOT NULL,
  shipping_street VARCHAR(500) NOT NULL,
  shipping_city VARCHAR(255) NOT NULL,
  shipping_state VARCHAR(255) NOT NULL DEFAULT '',
  shipping_postal_code VARCHAR(32) NOT NULL,
  shipping_country VARCHAR(120) NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL,
  tax DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_label VARCHAR(120) NOT NULL DEFAULT '',
  shipping_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  shipping_tier VARCHAR(120) NOT NULL DEFAULT '',
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total DECIMAL(12,2) NOT NULL,
  region ENUM('BD', 'INTL') NOT NULL DEFAULT 'BD',
  currency ENUM('BDT', 'USD') NOT NULL DEFAULT 'BDT',
  status ENUM('pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')
    NOT NULL DEFAULT 'pending',
  payment_method VARCHAR(64) NOT NULL DEFAULT '',
  tracking_number VARCHAR(120) NOT NULL DEFAULT '',
  delivered_at DATETIME(3) NULL,
  notes TEXT NOT NULL,
  -- Phase 4 idempotency (see lib/idempotency.js). SHA-256 hashes, never the
  -- raw values.
  idempotency_key_hash CHAR(64) NULL,
  idempotency_request_hash CHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_orders_status_created (status, created_at DESC),
  KEY idx_orders_user_created (user_id, created_at DESC),
  KEY idx_orders_created (created_at DESC),
  -- Mirrors Mongo's partial unique index {user,idempotencyKeyHash} — MySQL
  -- has no partial-index syntax, but a UNIQUE index over a nullable column
  -- gets the same effect natively: MySQL/MariaDB never enforce uniqueness
  -- among NULLs, so pre-Phase-4 (or otherwise key-less) orders never
  -- collide, exactly like the Mongo partialFilterExpression intended.
  UNIQUE KEY uq_orders_user_idempotency (user_id, idempotency_key_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Owned subdocument (order.items[]) -> cascades with parent order. No FK to
-- products/variants (see header comment) — an order line is a frozen
-- snapshot that must keep displaying correctly even after the product is
-- deactivated or a variant no longer exists.
CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id CHAR(24) NOT NULL,
  product_id CHAR(24) NOT NULL,
  variant_id CHAR(24) NOT NULL,
  quantity INT NOT NULL,
  snapshot_name VARCHAR(500) NOT NULL,
  snapshot_sku VARCHAR(255) NOT NULL DEFAULT '',
  snapshot_attributes JSON NOT NULL,
  snapshot_price DECIMAL(12,2) NOT NULL,
  snapshot_image VARCHAR(1024) NOT NULL DEFAULT '',
  position INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_order_items_order (order_id, position),
  KEY idx_order_items_product (product_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Independent top-level collection. No FK to orders/users (see header comment).
CREATE TABLE IF NOT EXISTS payments (
  id CHAR(24) NOT NULL,
  order_id CHAR(24) NOT NULL,
  user_id CHAR(24) NOT NULL,
  method ENUM('cod') NOT NULL,
  status ENUM('pending', 'completed', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
  transaction_id VARCHAR(255) NOT NULL DEFAULT '',
  -- Mixed/select:false in Mongo — raw gateway payload for debugging only,
  -- never returned in a normal read.
  gateway_response JSON NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'BDT',
  paid_at DATETIME(3) NULL,
  refunded_at DATETIME(3) NULL,
  refund_reason VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Addresses, wishlist, notifications, reviews
-- =============================================================================

-- Independent top-level collection. No FK to users (see header comment).
CREATE TABLE IF NOT EXISTS addresses (
  id CHAR(24) NOT NULL,
  user_id CHAR(24) NOT NULL,
  label ENUM('home', 'work', 'other') NOT NULL DEFAULT 'home',
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(64) NOT NULL,
  street VARCHAR(500) NOT NULL,
  city VARCHAR(255) NOT NULL,
  state VARCHAR(255) NOT NULL DEFAULT '',
  postal_code VARCHAR(32) NOT NULL,
  country VARCHAR(120) NOT NULL DEFAULT 'Bangladesh',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_addresses_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wishlists (
  id CHAR(24) NOT NULL,
  user_id CHAR(24) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_wishlists_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Join table (wishlist.products[]) -> cascades with parent wishlist. No FK
-- to products (see header comment).
CREATE TABLE IF NOT EXISTS wishlist_items (
  wishlist_id CHAR(24) NOT NULL,
  product_id CHAR(24) NOT NULL,
  added_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (wishlist_id, product_id),
  CONSTRAINT fk_wishlist_items_wishlist FOREIGN KEY (wishlist_id)
    REFERENCES wishlists (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Independent top-level collection. No FK to users (see header comment).
CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(24) NOT NULL,
  recipient_id CHAR(24) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  url VARCHAR(1024) NOT NULL DEFAULT '',
  read_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notifications_recipient (recipient_id, read_at, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Independent top-level collection. No FK to users/products (see header comment).
CREATE TABLE IF NOT EXISTS reviews (
  id CHAR(24) NOT NULL,
  user_id CHAR(24) NOT NULL,
  product_id CHAR(24) NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  title VARCHAR(100) NOT NULL DEFAULT '',
  comment TEXT NOT NULL,
  is_verified_purchase TINYINT(1) NOT NULL DEFAULT 0,
  images JSON NOT NULL,
  helpful_count INT NOT NULL DEFAULT 0,
  admin_reply_text TEXT NOT NULL,
  admin_reply_by CHAR(24) NULL,
  admin_reply_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reviews_user_product (user_id, product_id),
  KEY idx_reviews_product_created (product_id, created_at DESC),
  KEY idx_reviews_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-user helpful-vote dedupe (added post-launch; see
-- scripts/migrations/0001_review_helpful_votes.mjs for the ALTER-equivalent
-- migration an already-deployed database must run — this CREATE TABLE IF
-- NOT EXISTS only benefits a brand-new database import). No FK on
-- review_id/user_id, matching this schema's top-level-reference convention
-- (see header comment).
CREATE TABLE IF NOT EXISTS review_helpful_votes (
  review_id CHAR(24) NOT NULL,
  user_id CHAR(24) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (review_id, user_id),
  KEY idx_review_helpful_votes_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Promotions (carousel banners + campaign popups)
-- =============================================================================

CREATE TABLE IF NOT EXISTS promotions (
  id CHAR(24) NOT NULL,
  name VARCHAR(120) NOT NULL,
  type ENUM('carousel', 'popup') NOT NULL,
  placement ENUM('home_hero', 'storefront_popup') NOT NULL,
  status ENUM('draft', 'active', 'paused') NOT NULL DEFAULT 'draft',
  title VARCHAR(200) NOT NULL DEFAULT '',
  title_bn VARCHAR(200) NOT NULL DEFAULT '',
  subtitle VARCHAR(400) NOT NULL DEFAULT '',
  subtitle_bn VARCHAR(400) NOT NULL DEFAULT '',
  cta_label VARCHAR(60) NOT NULL DEFAULT '',
  cta_label_bn VARCHAR(60) NOT NULL DEFAULT '',
  desktop_image VARCHAR(1024) NOT NULL,
  mobile_image VARCHAR(1024) NOT NULL DEFAULT '',
  image_alt VARCHAR(200) NOT NULL DEFAULT '',
  image_alt_bn VARCHAR(200) NOT NULL DEFAULT '',
  target_type VARCHAR(32) NOT NULL DEFAULT 'none',
  target_product_id CHAR(24) NULL,
  target_category_id CHAR(24) NULL,
  target_collection VARCHAR(64) NULL,
  -- Small fixed-shape nested object (promotion.targetShopFilter) -> inlined.
  target_shop_filter_category_id CHAR(24) NULL,
  target_shop_filter_collection VARCHAR(64) NULL,
  target_shop_filter_style_id CHAR(24) NULL,
  target_url VARCHAR(300) NOT NULL DEFAULT '',
  start_at DATETIME(3) NULL,
  end_at DATETIME(3) NULL,
  priority SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  audience VARCHAR(32) NOT NULL DEFAULT 'all',
  page_scope VARCHAR(32) NOT NULL DEFAULT 'home',
  popup_delay_ms INT NOT NULL DEFAULT 2000,
  frequency VARCHAR(32) NOT NULL DEFAULT 'once_per_session',
  cooldown_hours INT NULL,
  version INT NOT NULL DEFAULT 1,
  created_by CHAR(24) NULL,
  updated_by CHAR(24) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_promotions_eligibility (type, placement, status, page_scope, sort_order, priority DESC),
  KEY idx_promotions_admin_list (type, status, created_at DESC),
  KEY idx_promotions_schedule (start_at, end_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Settings (singleton), Theme (admin-managed design tokens)
-- =============================================================================

-- True singleton row, id is always the literal string "main" (matches
-- Mongo's `_id: { type: String, default: "main" }`). Deeply-nested,
-- admin-authored config blocks with no relational access pattern (never
-- filtered/joined, always read/written as a whole) are stored as JSON
-- columns rather than forced into extra tables.
CREATE TABLE IF NOT EXISTS settings (
  id VARCHAR(32) NOT NULL,
  store_name VARCHAR(255) NOT NULL DEFAULT 'My Store',
  store_support_email VARCHAR(320) NOT NULL DEFAULT '',
  store_support_phone VARCHAR(64) NOT NULL DEFAULT '',
  store_logo_url VARCHAR(1024) NOT NULL DEFAULT '',
  store_logo_dark_url VARCHAR(1024) NOT NULL DEFAULT '',
  store_favicon_url VARCHAR(1024) NOT NULL DEFAULT '',
  homepage JSON NOT NULL,
  currency JSON NOT NULL,
  promotions JSON NOT NULL,
  exchange_policy JSON NOT NULL,
  tax_rules JSON NOT NULL,
  shipping_zones JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS themes (
  id CHAR(24) NOT NULL,
  name VARCHAR(120) NOT NULL DEFAULT 'Default',
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  colors JSON NOT NULL,
  dark_colors JSON NOT NULL,
  fonts JSON NOT NULL,
  radius VARCHAR(32) NOT NULL DEFAULT '0.75rem',
  shadow_style ENUM('none', 'soft', 'medium', 'hard') NOT NULL DEFAULT 'soft',
  density ENUM('compact', 'comfortable', 'spacious') NOT NULL DEFAULT 'comfortable',
  logo_url VARCHAR(1024) NOT NULL DEFAULT '',
  logo_dark_url VARCHAR(1024) NOT NULL DEFAULT '',
  favicon_url VARCHAR(1024) NOT NULL DEFAULT '',
  site_name VARCHAR(120) NOT NULL DEFAULT 'TAHOS.',
  tagline VARCHAR(255) NOT NULL DEFAULT '',
  features JSON NOT NULL,
  updated_by CHAR(24) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_themes_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Events (durable SSE outbox) — see header comment for the AUTO_INCREMENT
-- id exception. Ephemeral (10 min TTL, cleaned up the same way sessions/
-- rate-limit counters are), never referenced by anything else.
-- =============================================================================

CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel VARCHAR(120) NOT NULL,
  type VARCHAR(120) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_events_channel_id (channel, id),
  KEY idx_events_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
