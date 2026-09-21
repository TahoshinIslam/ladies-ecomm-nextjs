-- ---------------------------------------------------------------------------
-- The shared schema this storefront reads.
--
-- GENERATED — do not edit by hand. These tables are owned by the admin
-- dashboard, whose migrations are the source of truth
-- (ecom_erp/packages/database/migrations). This file is a structure-only
-- snapshot of the resulting database, kept in the repo so a fresh install
-- and the test database can be created without running the dashboard's
-- migration history.
--
-- To refresh it:
--
--   mysqldump --no-data --routines --skip-add-locks --skip-comments <shared-db> \
--     > sql/schema.sql
--
-- It contains the dashboard's own tables (organizations, roles, plans,
-- audit_logs …) as well as the storefront's, because they are one database.
-- The storefront reads only the rows carrying its own organization_id —
-- see lib/tenant.js and scripts/checkTenantScoping.mjs.
--
-- Tables this app used to own under other names: users -> customers,
-- sessions -> customer_sessions, settings -> store_settings,
-- themes -> storefront_themes, events -> storefront_events, and its
-- migration ledger schema_migrations -> storefront_migrations.
-- ---------------------------------------------------------------------------


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `addresses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `addresses` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `customer_id` varchar(32) NOT NULL,
  `label` enum('home','work','other') NOT NULL DEFAULT 'home',
  `full_name` varchar(255) NOT NULL,
  `phone` varchar(64) NOT NULL,
  `street` varchar(500) NOT NULL,
  `city` varchar(255) NOT NULL,
  `state` varchar(255) NOT NULL DEFAULT '',
  `postal_code` varchar(32) NOT NULL,
  `country` varchar(120) NOT NULL DEFAULT 'Bangladesh',
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_addresses_customer` (`customer_id`),
  KEY `fk_addresses_customer` (`organization_id`,`customer_id`),
  CONSTRAINT `fk_addresses_customer` FOREIGN KEY (`organization_id`, `customer_id`) REFERENCES `customers` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `attribute_definition_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `attribute_definition_categories` (
  `organization_id` varchar(32) NOT NULL,
  `attribute_definition_id` varchar(32) NOT NULL,
  `category_id` varchar(32) NOT NULL,
  PRIMARY KEY (`attribute_definition_id`,`category_id`),
  KEY `idx_attr_def_categories_org_category` (`organization_id`,`category_id`),
  KEY `fk_attr_def_categories_def` (`organization_id`,`attribute_definition_id`),
  CONSTRAINT `fk_attr_def_categories_category` FOREIGN KEY (`organization_id`, `category_id`) REFERENCES `categories` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_attr_def_categories_def` FOREIGN KEY (`organization_id`, `attribute_definition_id`) REFERENCES `attribute_definitions` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `attribute_definition_label_overrides`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `attribute_definition_label_overrides` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` varchar(32) NOT NULL,
  `attribute_definition_id` varchar(32) NOT NULL,
  `category_id` varchar(32) NOT NULL,
  `label` varchar(255) NOT NULL,
  `label_bn` varchar(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `idx_attr_overrides_def` (`attribute_definition_id`),
  KEY `fk_attr_overrides_def` (`organization_id`,`attribute_definition_id`),
  KEY `fk_attr_overrides_category` (`organization_id`,`category_id`),
  CONSTRAINT `fk_attr_overrides_category` FOREIGN KEY (`organization_id`, `category_id`) REFERENCES `categories` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_attr_overrides_def` FOREIGN KEY (`organization_id`, `attribute_definition_id`) REFERENCES `attribute_definitions` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `attribute_definition_options`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `attribute_definition_options` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` varchar(32) NOT NULL,
  `attribute_definition_id` varchar(32) NOT NULL,
  `value` varchar(255) NOT NULL,
  `label` varchar(255) NOT NULL,
  `label_bn` varchar(255) NOT NULL DEFAULT '',
  `swatch_hex` varchar(32) NOT NULL DEFAULT '',
  `position` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_attr_options_def` (`attribute_definition_id`,`position`),
  KEY `fk_attr_options_def` (`organization_id`,`attribute_definition_id`),
  CONSTRAINT `fk_attr_options_def` FOREIGN KEY (`organization_id`, `attribute_definition_id`) REFERENCES `attribute_definitions` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=145 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `attribute_definitions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `attribute_definitions` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `attr_key` varchar(100) NOT NULL,
  `label` varchar(255) NOT NULL,
  `label_bn` varchar(255) NOT NULL DEFAULT '',
  `type` enum('select','swatch','boolean','text') NOT NULL,
  `derived_from_variant` tinyint(1) NOT NULL DEFAULT 0,
  `filterable` tinyint(1) NOT NULL DEFAULT 1,
  `required` tinyint(1) NOT NULL DEFAULT 0,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attribute_definitions_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_attribute_definitions_org_key` (`organization_id`,`attr_key`),
  CONSTRAINT `fk_attribute_definitions_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `audit_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `actor_user_id` varchar(32) DEFAULT NULL,
  `actor_name` varchar(255) NOT NULL DEFAULT 'System',
  `actor_email` varchar(255) DEFAULT NULL,
  `actor_type` enum('PROVIDER','STORE_ADMIN','DEV','SPECIAL_GUEST','SYSTEM') NOT NULL DEFAULT 'SYSTEM',
  `actor_role_name` varchar(128) DEFAULT NULL,
  `organization_id` varchar(32) DEFAULT NULL,
  `organization_name` varchar(255) DEFAULT NULL,
  `branch_id` varchar(32) DEFAULT NULL,
  `branch_name` varchar(255) DEFAULT NULL,
  `category` enum('AUTH','DATA','PERMISSION','MODULE','SUBSCRIPTION','CONFIG','SUPPORT','SYSTEM') NOT NULL DEFAULT 'DATA',
  `action` varchar(64) NOT NULL,
  `module` varchar(128) DEFAULT NULL,
  `entity_type` varchar(128) DEFAULT NULL,
  `entity_id` varchar(64) DEFAULT NULL,
  `entity_label` varchar(255) DEFAULT NULL,
  `summary` varchar(512) NOT NULL DEFAULT '',
  `old_value` longtext DEFAULT NULL CHECK (`old_value` is null or json_valid(`old_value`)),
  `new_value` longtext DEFAULT NULL CHECK (`new_value` is null or json_valid(`new_value`)),
  `ip_address` varchar(45) DEFAULT NULL,
  `device` varchar(64) DEFAULT NULL,
  `browser` varchar(64) DEFAULT NULL,
  `session_id` varchar(64) DEFAULT NULL,
  `request_id` varchar(64) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_audit_org_time` (`organization_id`,`created_at`),
  KEY `idx_audit_actor` (`actor_user_id`,`created_at`),
  KEY `idx_audit_entity` (`entity_type`,`entity_id`,`created_at`),
  KEY `idx_audit_category` (`category`,`created_at`),
  CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_audit_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=1969 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `branch_module_grants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `branch_module_grants` (
  `id` varchar(32) NOT NULL,
  `branch_id` varchar(32) NOT NULL,
  `module_id` varchar(64) NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 0,
  `reason` varchar(255) NOT NULL DEFAULT '',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_branch_module_grants` (`branch_id`,`module_id`),
  KEY `fk_branch_grants_module` (`module_id`),
  CONSTRAINT `fk_branch_grants_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_branch_grants_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `branch_themes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `branch_themes` (
  `branch_id` varchar(32) NOT NULL,
  `preset` varchar(32) NOT NULL DEFAULT 'indigo',
  `primary_color` varchar(16) NOT NULL DEFAULT '#5850ec',
  `accent_color` varchar(16) NOT NULL DEFAULT '#8b5cf6',
  `gradient_from` varchar(16) NOT NULL DEFAULT '#5850ec',
  `gradient_via` varchar(16) NOT NULL DEFAULT '#8b5cf6',
  `gradient_to` varchar(16) NOT NULL DEFAULT '#06b6d4',
  `chart_palette` longtext DEFAULT NULL CHECK (`chart_palette` is null or json_valid(`chart_palette`)),
  `sidebar_style` enum('solid','glass','gradient') NOT NULL DEFAULT 'solid',
  `card_style` enum('flat','shadow','glass') NOT NULL DEFAULT 'shadow',
  `radius` enum('small','medium','rounded') NOT NULL DEFAULT 'medium',
  `font_style` varchar(64) NOT NULL DEFAULT 'geist',
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`branch_id`),
  CONSTRAINT `fk_branch_themes_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `branches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `branches` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `name` varchar(255) NOT NULL,
  `code` varchar(64) NOT NULL,
  `mobile` varchar(32) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `contact_person` varchar(255) DEFAULT NULL,
  `city` varchar(128) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `timezone` varchar(64) NOT NULL DEFAULT 'Asia/Dhaka',
  `status` enum('Active','Suspended','Archived') NOT NULL DEFAULT 'Active',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_branches_org_code` (`organization_id`,`code`),
  UNIQUE KEY `uq_branches_org_id` (`organization_id`,`id`),
  KEY `idx_branches_org` (`organization_id`,`status`),
  CONSTRAINT `fk_branches_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `brands`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `brands` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `name` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `logo` varchar(1024) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_brands_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_brands_org_name` (`organization_id`,`name`),
  UNIQUE KEY `uq_brands_org_slug` (`organization_id`,`slug`),
  KEY `idx_brands_org_active` (`organization_id`,`is_active`),
  CONSTRAINT `fk_brands_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `cart_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cart_items` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `cart_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT 1,
  `snapshot_sku` varchar(255) NOT NULL DEFAULT '',
  `snapshot_attributes` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`snapshot_attributes`)),
  `snapshot_price` decimal(12,2) DEFAULT NULL,
  `snapshot_image` varchar(1024) NOT NULL DEFAULT '',
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cart_items_line` (`cart_id`,`product_id`,`variant_id`),
  KEY `fk_cart_items_cart` (`organization_id`,`cart_id`),
  CONSTRAINT `fk_cart_items_cart` FOREIGN KEY (`organization_id`, `cart_id`) REFERENCES `carts` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `carts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `carts` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `customer_id` varchar(32) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_carts_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_carts_customer` (`customer_id`),
  KEY `fk_carts_customer` (`organization_id`,`customer_id`),
  CONSTRAINT `fk_carts_customer` FOREIGN KEY (`organization_id`, `customer_id`) REFERENCES `customers` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `categories` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `name` varchar(255) NOT NULL,
  `name_bn` varchar(255) NOT NULL DEFAULT '',
  `slug` varchar(255) NOT NULL,
  `parent_id` varchar(32) DEFAULT NULL,
  `image` varchar(1024) NOT NULL DEFAULT '',
  `icon` varchar(120) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `description_bn` text NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_categories_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_categories_org_slug` (`organization_id`,`slug`),
  KEY `idx_categories_org_parent_sort` (`organization_id`,`parent_id`,`sort_order`),
  KEY `idx_categories_org_active` (`organization_id`,`is_active`),
  CONSTRAINT `fk_categories_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `coupon_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `coupon_categories` (
  `organization_id` varchar(32) NOT NULL,
  `coupon_id` varchar(32) NOT NULL,
  `category_id` varchar(32) NOT NULL,
  PRIMARY KEY (`coupon_id`,`category_id`),
  KEY `idx_coupon_categories_org_category` (`organization_id`,`category_id`),
  KEY `fk_coupon_categories_coupon` (`organization_id`,`coupon_id`),
  CONSTRAINT `fk_coupon_categories_category` FOREIGN KEY (`organization_id`, `category_id`) REFERENCES `categories` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_coupon_categories_coupon` FOREIGN KEY (`organization_id`, `coupon_id`) REFERENCES `coupons` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `coupon_usages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `coupon_usages` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `coupon_id` varchar(32) NOT NULL,
  `customer_id` varchar(32) NOT NULL,
  `count` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coupon_usages_coupon_customer` (`coupon_id`,`customer_id`),
  KEY `idx_coupon_usages_org` (`organization_id`),
  KEY `fk_coupon_usages_coupon` (`organization_id`,`coupon_id`),
  KEY `fk_coupon_usages_customer` (`organization_id`,`customer_id`),
  CONSTRAINT `fk_coupon_usages_coupon` FOREIGN KEY (`organization_id`, `coupon_id`) REFERENCES `coupons` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_coupon_usages_customer` FOREIGN KEY (`organization_id`, `customer_id`) REFERENCES `customers` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `coupons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `coupons` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `branch_id` varchar(32) DEFAULT NULL,
  `code` varchar(64) NOT NULL,
  `discount_type` enum('percentage','flat') NOT NULL,
  `discount_value` decimal(12,2) NOT NULL,
  `min_order_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `max_discount` decimal(12,2) DEFAULT NULL,
  `usage_limit` int(11) DEFAULT NULL,
  `used_count` int(11) NOT NULL DEFAULT 0,
  `per_user_limit` int(11) DEFAULT 1,
  `expires_at` datetime(3) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coupons_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_coupons_org_code` (`organization_id`,`code`),
  KEY `idx_coupons_org_active` (`organization_id`,`is_active`,`expires_at`),
  KEY `fk_coupons_org_branch` (`organization_id`,`branch_id`),
  CONSTRAINT `fk_coupons_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_coupons_org_branch` FOREIGN KEY (`organization_id`, `branch_id`) REFERENCES `branches` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `customer_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `customer_sessions` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `customer_id` varchar(32) NOT NULL,
  `token_hash` char(64) NOT NULL,
  `csrf_token_hash` char(64) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `last_seen_at` datetime(3) NOT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  `user_agent` varchar(200) NOT NULL DEFAULT '',
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_sessions_token_hash` (`token_hash`),
  KEY `idx_customer_sessions_customer` (`customer_id`,`revoked_at`),
  KEY `idx_customer_sessions_expires_at` (`expires_at`),
  KEY `fk_customer_sessions_customer` (`organization_id`,`customer_id`),
  CONSTRAINT `fk_customer_sessions_customer` FOREIGN KEY (`organization_id`, `customer_id`) REFERENCES `customers` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `customers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `customers` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(320) NOT NULL,
  `password` varchar(255) NOT NULL,
  `avatar` varchar(1024) NOT NULL DEFAULT '',
  `phone` varchar(64) NOT NULL DEFAULT '',
  `is_verified` tinyint(1) NOT NULL DEFAULT 0,
  `reset_password_token` varchar(255) DEFAULT NULL,
  `reset_password_expires` datetime(3) DEFAULT NULL,
  `login_attempts` int(11) NOT NULL DEFAULT 0,
  `lock_until` datetime(3) DEFAULT NULL,
  `last_login` datetime(3) DEFAULT NULL,
  `first_order_promo_used` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customers_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_customers_org_email` (`organization_id`,`email`),
  KEY `idx_customers_org_created` (`organization_id`,`created_at`),
  CONSTRAINT `fk_customers_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `deleted_products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `deleted_products` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `name` varchar(500) NOT NULL,
  `slug` varchar(600) NOT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `deleted_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `snapshot` longtext NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_deleted_products_org_product` (`organization_id`,`product_id`),
  KEY `idx_deleted_products_org_deleted_at` (`organization_id`,`deleted_at`)
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `files`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `files` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) DEFAULT NULL,
  `branch_id` varchar(32) DEFAULT NULL,
  `purpose` varchar(32) NOT NULL DEFAULT 'general',
  `filename` varchar(255) NOT NULL,
  `mime_type` varchar(127) NOT NULL,
  `size_bytes` int(10) unsigned NOT NULL,
  `data` longblob NOT NULL,
  `uploaded_by_id` varchar(32) DEFAULT NULL,
  `uploaded_by_name` varchar(255) DEFAULT NULL,
  `uploaded_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_files_branch` (`branch_id`),
  KEY `idx_files_organization` (`organization_id`),
  CONSTRAINT `fk_files_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_files_organization` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `guest_module_grants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `guest_module_grants` (
  `id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `module_id` varchar(32) NOT NULL,
  `status` enum('Active','Revoked') NOT NULL DEFAULT 'Active',
  `reason` varchar(255) NOT NULL DEFAULT '',
  `granted_by_id` varchar(32) DEFAULT NULL,
  `granted_by_name` varchar(255) DEFAULT NULL,
  `granted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `revoked_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_guest_module` (`user_id`,`module_id`),
  KEY `idx_guest_grants_user` (`user_id`,`status`),
  KEY `fk_guest_grant_module` (`module_id`),
  CONSTRAINT `fk_guest_grant_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_guest_grant_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `icons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `icons` (
  `id` varchar(32) NOT NULL,
  `icon_key` varchar(64) NOT NULL,
  `label` varchar(64) NOT NULL,
  `category` varchar(32) NOT NULL DEFAULT 'navigation',
  `keywords` varchar(255) NOT NULL DEFAULT '',
  `library` varchar(32) NOT NULL DEFAULT 'lucide',
  `allowed` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_icons_key` (`icon_key`),
  KEY `idx_icons_category` (`category`,`allowed`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `locales`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `locales` (
  `id` varchar(32) NOT NULL,
  `code` varchar(8) NOT NULL,
  `name` varchar(64) NOT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_locales_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `login_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `login_logs` (
  `id` varchar(32) NOT NULL,
  `user_id` varchar(32) DEFAULT NULL,
  `attempted_email` varchar(255) NOT NULL,
  `user_name` varchar(255) DEFAULT NULL,
  `user_type` enum('PROVIDER','STORE_ADMIN','DEV','SPECIAL_GUEST') DEFAULT NULL,
  `organization_id` varchar(32) DEFAULT NULL,
  `session_id` varchar(64) DEFAULT NULL,
  `success` tinyint(1) NOT NULL DEFAULT 0,
  `failure_reason` varchar(64) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `browser` varchar(64) DEFAULT NULL,
  `device` varchar(64) DEFAULT NULL,
  `user_agent` varchar(512) DEFAULT NULL,
  `login_at` datetime NOT NULL DEFAULT current_timestamp(),
  `logout_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_login_logs_user` (`user_id`,`login_at`),
  KEY `idx_login_logs_email` (`attempted_email`,`login_at`),
  KEY `idx_login_logs_failures` (`success`,`login_at`),
  CONSTRAINT `fk_login_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `menus`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `menus` (
  `id` varchar(64) NOT NULL,
  `stable_key` varchar(128) NOT NULL,
  `module_id` varchar(64) NOT NULL,
  `parent_id` varchar(64) DEFAULT NULL,
  `page_id` varchar(64) DEFAULT NULL,
  `title` varchar(128) NOT NULL,
  `translation_key` varchar(191) DEFAULT NULL,
  `icon_key` varchar(64) NOT NULL,
  `permission_key` varchar(128) DEFAULT NULL,
  `order_position` int(11) NOT NULL DEFAULT 0,
  `status` enum('Active','Hidden','Archived') NOT NULL DEFAULT 'Active',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_menus_stable_key` (`stable_key`),
  KEY `idx_menus_module_parent` (`module_id`,`parent_id`,`order_position`),
  KEY `idx_menus_parent` (`parent_id`),
  KEY `fk_menus_icon` (`icon_key`),
  KEY `fk_menus_page` (`page_id`),
  KEY `fk_menus_translation_key` (`translation_key`),
  CONSTRAINT `fk_menus_icon` FOREIGN KEY (`icon_key`) REFERENCES `icons` (`icon_key`) ON UPDATE CASCADE,
  CONSTRAINT `fk_menus_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_menus_page` FOREIGN KEY (`page_id`) REFERENCES `pages` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_menus_parent` FOREIGN KEY (`parent_id`) REFERENCES `menus` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_menus_translation_key` FOREIGN KEY (`translation_key`) REFERENCES `translation_keys` (`key`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `modules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `modules` (
  `id` varchar(64) NOT NULL,
  `stable_key` varchar(128) NOT NULL,
  `name` varchar(128) NOT NULL,
  `slug` varchar(128) NOT NULL,
  `description` varchar(255) NOT NULL DEFAULT '',
  `translation_key` varchar(191) DEFAULT NULL,
  `target_portal` enum('STORE','PROVIDER','DEV') NOT NULL DEFAULT 'STORE',
  `type` enum('Core','Add-on','Platform') NOT NULL DEFAULT 'Core',
  `implementation_key` varchar(128) DEFAULT NULL,
  `icon_key` varchar(64) DEFAULT NULL,
  `base_path` varchar(255) NOT NULL DEFAULT '',
  `landing_route` varchar(255) NOT NULL DEFAULT '',
  `group_name` varchar(64) NOT NULL DEFAULT 'Modules',
  `order_position` int(11) NOT NULL DEFAULT 0,
  `version` varchar(16) NOT NULL DEFAULT '1.0.0',
  `lifecycle_status` enum('Draft','Implementation Pending','Ready','Published','Active','Deprecated','Archived') NOT NULL DEFAULT 'Draft',
  `health_status` enum('healthy','degraded','unknown') NOT NULL DEFAULT 'unknown',
  `has_dashboard` tinyint(1) NOT NULL DEFAULT 0,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_modules_stable_key` (`stable_key`),
  UNIQUE KEY `uq_modules_slug` (`slug`),
  KEY `idx_modules_portal` (`target_portal`,`lifecycle_status`),
  KEY `fk_modules_icon` (`icon_key`),
  KEY `fk_modules_translation_key` (`translation_key`),
  CONSTRAINT `fk_modules_icon` FOREIGN KEY (`icon_key`) REFERENCES `icons` (`icon_key`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_modules_translation_key` FOREIGN KEY (`translation_key`) REFERENCES `translation_keys` (`key`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `notifications` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `recipient_type` enum('staff','customer') NOT NULL,
  `recipient_id` varchar(32) NOT NULL,
  `message` varchar(1000) NOT NULL,
  `url` varchar(1024) NOT NULL DEFAULT '',
  `read_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_notifications_recipient` (`organization_id`,`recipient_type`,`recipient_id`,`read_at`,`created_at`),
  CONSTRAINT `fk_notifications_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `order_items` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` varchar(32) NOT NULL,
  `order_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `quantity` int(11) NOT NULL,
  `snapshot_name` varchar(500) NOT NULL,
  `snapshot_sku` varchar(255) NOT NULL DEFAULT '',
  `snapshot_attributes` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`snapshot_attributes`)),
  `snapshot_price` decimal(12,2) NOT NULL,
  `snapshot_image` varchar(1024) NOT NULL DEFAULT '',
  `position` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_order_items_order` (`order_id`,`position`),
  KEY `idx_order_items_org_product` (`organization_id`,`product_id`),
  KEY `fk_order_items_order` (`organization_id`,`order_id`),
  CONSTRAINT `fk_order_items_order` FOREIGN KEY (`organization_id`, `order_id`) REFERENCES `orders` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=130 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `orders` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `branch_id` varchar(32) DEFAULT NULL,
  `customer_id` varchar(32) NOT NULL,
  `coupon_id` varchar(32) DEFAULT NULL,
  `shipping_full_name` varchar(255) NOT NULL,
  `shipping_phone` varchar(64) NOT NULL,
  `shipping_street` varchar(500) NOT NULL,
  `shipping_city` varchar(255) NOT NULL,
  `shipping_state` varchar(255) NOT NULL DEFAULT '',
  `shipping_postal_code` varchar(32) NOT NULL,
  `shipping_country` varchar(120) NOT NULL,
  `subtotal` decimal(12,2) NOT NULL,
  `tax` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tax_label` varchar(120) NOT NULL DEFAULT '',
  `shipping_cost` decimal(12,2) NOT NULL DEFAULT 0.00,
  `shipping_tier` varchar(120) NOT NULL DEFAULT '',
  `discount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL,
  `shipping_region` enum('BD','INTL') NOT NULL DEFAULT 'BD',
  `currency` enum('BDT','USD') NOT NULL DEFAULT 'BDT',
  `status` enum('pending','paid','processing','shipped','delivered','cancelled','refunded') NOT NULL DEFAULT 'pending',
  `payment_method` varchar(64) NOT NULL DEFAULT '',
  `tracking_number` varchar(120) NOT NULL DEFAULT '',
  `delivered_at` datetime(3) DEFAULT NULL,
  `notes` text NOT NULL,
  `idempotency_key_hash` char(64) DEFAULT NULL,
  `idempotency_request_hash` char(64) DEFAULT NULL,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_orders_customer_idempotency` (`customer_id`,`idempotency_key_hash`),
  KEY `idx_orders_org_status_created` (`organization_id`,`status`,`created_at`),
  KEY `idx_orders_org_created` (`organization_id`,`created_at`),
  KEY `idx_orders_customer_created` (`customer_id`,`created_at`),
  KEY `idx_orders_branch_created` (`branch_id`,`created_at`),
  KEY `fk_orders_org_branch` (`organization_id`,`branch_id`),
  KEY `fk_orders_customer` (`organization_id`,`customer_id`),
  CONSTRAINT `fk_orders_customer` FOREIGN KEY (`organization_id`, `customer_id`) REFERENCES `customers` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_orders_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_orders_org_branch` FOREIGN KEY (`organization_id`, `branch_id`) REFERENCES `branches` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `organization_invitations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `organization_invitations` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `role_id` varchar(32) NOT NULL,
  `purpose` enum('BOOTSTRAP','RECOVERY') NOT NULL DEFAULT 'BOOTSTRAP',
  `reason` varchar(500) DEFAULT NULL,
  `branch_id` varchar(32) DEFAULT NULL,
  `email` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `mobile` varchar(32) DEFAULT NULL,
  `suggested_username` varchar(64) DEFAULT NULL,
  `user_id` varchar(32) DEFAULT NULL,
  `token_hash` char(64) NOT NULL,
  `status` enum('Pending','Accepted','Cancelled','Expired') NOT NULL DEFAULT 'Pending',
  `expires_at` datetime NOT NULL,
  `accepted_at` datetime DEFAULT NULL,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_org_invitations_token` (`token_hash`),
  KEY `idx_org_invitations_org` (`organization_id`,`status`),
  KEY `fk_org_invitations_role` (`role_id`),
  KEY `fk_org_invitations_branch` (`branch_id`),
  KEY `fk_org_invitations_user` (`user_id`),
  CONSTRAINT `fk_org_invitations_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_org_invitations_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_org_invitations_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`),
  CONSTRAINT `fk_org_invitations_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `organization_menu_overrides`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `organization_menu_overrides` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `menu_id` varchar(32) NOT NULL,
  `status` enum('ENABLED','DISABLED') NOT NULL,
  `reason` varchar(255) NOT NULL DEFAULT '',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_org_menu_overrides` (`organization_id`,`menu_id`),
  KEY `fk_org_menu_overrides_menu` (`menu_id`),
  CONSTRAINT `fk_org_menu_overrides_menu` FOREIGN KEY (`menu_id`) REFERENCES `menus` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_org_menu_overrides_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `organization_module_grants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `organization_module_grants` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `module_id` varchar(64) NOT NULL,
  `grant_type` enum('ENABLE','DISABLE') NOT NULL,
  `reason` varchar(255) NOT NULL DEFAULT '',
  `expires_at` datetime DEFAULT NULL,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_org_module_grants` (`organization_id`,`module_id`),
  KEY `fk_org_grants_module` (`module_id`),
  CONSTRAINT `fk_org_grants_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_org_grants_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `organization_themes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `organization_themes` (
  `organization_id` varchar(32) NOT NULL,
  `preset` varchar(32) NOT NULL DEFAULT 'indigo',
  `primary_color` varchar(16) NOT NULL DEFAULT '#5850ec',
  `accent_color` varchar(16) NOT NULL DEFAULT '#8b5cf6',
  `gradient_from` varchar(16) NOT NULL DEFAULT '#5850ec',
  `gradient_via` varchar(16) NOT NULL DEFAULT '#8b5cf6',
  `gradient_to` varchar(16) NOT NULL DEFAULT '#06b6d4',
  `chart_palette` longtext DEFAULT NULL CHECK (`chart_palette` is null or json_valid(`chart_palette`)),
  `sidebar_style` enum('solid','glass','gradient') NOT NULL DEFAULT 'solid',
  `card_style` enum('flat','shadow','glass') NOT NULL DEFAULT 'shadow',
  `radius` enum('small','medium','rounded') NOT NULL DEFAULT 'medium',
  `font_style` varchar(64) NOT NULL DEFAULT 'geist',
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`organization_id`),
  CONSTRAINT `fk_org_themes_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `organization_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `organization_users` (
  `id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `role_id` varchar(32) DEFAULT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT 0,
  `status` enum('Active','Invited','Suspended') NOT NULL DEFAULT 'Active',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_org_users` (`user_id`,`organization_id`),
  KEY `idx_org_users_org` (`organization_id`,`status`),
  KEY `fk_org_users_role` (`role_id`),
  CONSTRAINT `fk_org_users_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_org_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_org_users_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_org_users_role_check_insert
BEFORE INSERT ON organization_users
FOR EACH ROW
BEGIN
  DECLARE v_scope VARCHAR(32) COLLATE utf8mb4_unicode_ci;
  DECLARE v_org VARCHAR(32) COLLATE utf8mb4_unicode_ci;
  IF NEW.role_id IS NOT NULL THEN
    SELECT scope, organization_id INTO v_scope, v_org FROM roles WHERE id = NEW.role_id;
    IF v_scope = 'ORGANIZATION_TEMPLATE' THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'organization_users.role_id cannot reference a shared ORGANIZATION_TEMPLATE role — assign an organization-owned role instead';
    END IF;
    IF v_scope = 'Organization' AND (v_org IS NULL OR v_org <> NEW.organization_id) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'organization_users.role_id must belong to the same organization as the membership';
    END IF;
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_org_users_role_check_update
BEFORE UPDATE ON organization_users
FOR EACH ROW
BEGIN
  DECLARE v_scope VARCHAR(32) COLLATE utf8mb4_unicode_ci;
  DECLARE v_org VARCHAR(32) COLLATE utf8mb4_unicode_ci;
  IF NEW.role_id IS NOT NULL THEN
    SELECT scope, organization_id INTO v_scope, v_org FROM roles WHERE id = NEW.role_id;
    IF v_scope = 'ORGANIZATION_TEMPLATE' THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'organization_users.role_id cannot reference a shared ORGANIZATION_TEMPLATE role — assign an organization-owned role instead';
    END IF;
    IF v_scope = 'Organization' AND (v_org IS NULL OR v_org <> NEW.organization_id) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'organization_users.role_id must belong to the same organization as the membership';
    END IF;
  END IF;
END */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `organizations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `organizations` (
  `id` varchar(32) NOT NULL,
  `name` varchar(255) NOT NULL,
  `legal_name` varchar(255) DEFAULT NULL,
  `code` varchar(64) NOT NULL,
  `logo_url` varchar(512) DEFAULT NULL,
  `domain` varchar(255) DEFAULT NULL,
  `website` varchar(255) DEFAULT NULL,
  `contact_email` varchar(255) DEFAULT NULL,
  `contact_phone` varchar(32) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `status` enum('Active','Suspended','Archived') NOT NULL DEFAULT 'Active',
  `default_locale` varchar(8) DEFAULT NULL,
  `primary_branch_id` varchar(32) DEFAULT NULL,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_organizations_code` (`code`),
  KEY `idx_organizations_status` (`status`),
  KEY `fk_organizations_primary_branch` (`primary_branch_id`),
  KEY `fk_organizations_locale` (`default_locale`),
  CONSTRAINT `fk_organizations_locale` FOREIGN KEY (`default_locale`) REFERENCES `locales` (`code`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_organizations_primary_branch` FOREIGN KEY (`primary_branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pages` (
  `id` varchar(64) NOT NULL,
  `stable_key` varchar(128) NOT NULL,
  `module_id` varchar(64) NOT NULL,
  `title` varchar(255) NOT NULL,
  `translation_key` varchar(191) DEFAULT NULL,
  `route` varchar(255) NOT NULL,
  `implementation_key` varchar(128) NOT NULL,
  `required_capability` varchar(128) DEFAULT NULL,
  `page_type` enum('PAGE','FORM','DETAIL','DASHBOARD','REPORT') NOT NULL DEFAULT 'PAGE',
  `page_group` varchar(64) DEFAULT NULL,
  `implementation_status` enum('shipped','planned','deprecated') NOT NULL DEFAULT 'shipped',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pages_stable_key` (`stable_key`),
  UNIQUE KEY `uq_pages_route` (`route`),
  KEY `idx_pages_module` (`module_id`),
  KEY `fk_pages_translation_key` (`translation_key`),
  CONSTRAINT `fk_pages_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pages_translation_key` FOREIGN KEY (`translation_key`) REFERENCES `translation_keys` (`key`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `password_resets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `password_resets` (
  `id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `token_hash` char(64) NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_password_resets_token` (`token_hash`),
  KEY `idx_password_resets_user` (`user_id`,`used_at`),
  CONSTRAINT `fk_password_resets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `payments` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `order_id` varchar(32) NOT NULL,
  `customer_id` varchar(32) NOT NULL,
  `method` enum('cod') NOT NULL,
  `status` enum('pending','completed','failed','refunded') NOT NULL DEFAULT 'pending',
  `transaction_id` varchar(255) NOT NULL DEFAULT '',
  `gateway_response` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`gateway_response`)),
  `amount` decimal(12,2) NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'BDT',
  `paid_at` datetime(3) DEFAULT NULL,
  `refunded_at` datetime(3) DEFAULT NULL,
  `refund_reason` varchar(500) NOT NULL DEFAULT '',
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payments_order` (`order_id`),
  KEY `idx_payments_org_status` (`organization_id`,`status`),
  KEY `fk_payments_order` (`organization_id`,`order_id`),
  CONSTRAINT `fk_payments_order` FOREIGN KEY (`organization_id`, `order_id`) REFERENCES `orders` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `permissions` (
  `id` varchar(32) NOT NULL,
  `permission_key` varchar(128) NOT NULL,
  `module_id` varchar(64) DEFAULT NULL,
  `menu_id` varchar(64) DEFAULT NULL,
  `action` enum('view','create','update','delete','export','approve','manage','import','view_sensitive') NOT NULL DEFAULT 'view',
  `label` varchar(255) NOT NULL,
  `translation_key` varchar(191) DEFAULT NULL,
  `description` varchar(255) NOT NULL DEFAULT '',
  `allowed` tinyint(1) NOT NULL DEFAULT 1,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_permissions_key` (`permission_key`),
  KEY `idx_permissions_module` (`module_id`),
  KEY `idx_permissions_menu` (`menu_id`),
  KEY `fk_permissions_translation_key` (`translation_key`),
  CONSTRAINT `fk_permissions_menu` FOREIGN KEY (`menu_id`) REFERENCES `menus` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_permissions_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_permissions_translation_key` FOREIGN KEY (`translation_key`) REFERENCES `translation_keys` (`key`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `plan_menus`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `plan_menus` (
  `id` varchar(32) NOT NULL,
  `plan_id` varchar(32) NOT NULL,
  `menu_id` varchar(32) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_plan_menus` (`plan_id`,`menu_id`),
  KEY `fk_plan_menus_menu` (`menu_id`),
  CONSTRAINT `fk_plan_menus_menu` FOREIGN KEY (`menu_id`) REFERENCES `menus` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_plan_menus_plan` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `plan_modules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `plan_modules` (
  `id` varchar(32) NOT NULL,
  `plan_id` varchar(32) NOT NULL,
  `module_id` varchar(64) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_plan_modules` (`plan_id`,`module_id`),
  KEY `fk_plan_modules_module` (`module_id`),
  CONSTRAINT `fk_plan_modules_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_plan_modules_plan` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `plans` (
  `id` varchar(32) NOT NULL,
  `name` varchar(128) NOT NULL,
  `slug` varchar(64) NOT NULL,
  `description` varchar(255) NOT NULL DEFAULT '',
  `price_monthly` decimal(10,2) NOT NULL DEFAULT 0.00,
  `currency` char(3) NOT NULL DEFAULT 'USD',
  `max_branches` int(11) DEFAULT NULL,
  `max_users` int(11) DEFAULT NULL,
  `max_products` int(11) DEFAULT NULL,
  `is_sold` tinyint(1) NOT NULL DEFAULT 1,
  `order_position` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_plans_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `platform_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `platform_users` (
  `id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `role_id` varchar(32) NOT NULL,
  `status` enum('Active','Invited','Suspended') NOT NULL DEFAULT 'Active',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_platform_users_user` (`user_id`),
  KEY `idx_platform_users_role` (`role_id`),
  CONSTRAINT `fk_platform_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`),
  CONSTRAINT `fk_platform_users_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `product_attributes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `product_attributes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `attr_key` varchar(100) NOT NULL,
  `attr_value` varchar(255) NOT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_product_attributes_product` (`product_id`),
  KEY `idx_product_attributes_org_facet` (`organization_id`,`attr_key`,`attr_value`),
  KEY `fk_product_attributes_product` (`organization_id`,`product_id`),
  CONSTRAINT `fk_product_attributes_product` FOREIGN KEY (`organization_id`, `product_id`) REFERENCES `products` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=250 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `product_variants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `product_variants` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `variant_name` varchar(255) NOT NULL,
  `sku` varchar(255) NOT NULL,
  `attributes` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`attributes`)),
  `price` decimal(12,2) DEFAULT NULL,
  `discount_price` decimal(12,2) DEFAULT NULL,
  `stock` int(11) NOT NULL DEFAULT 0,
  `images` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`images`)),
  `position` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_variants_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_product_variants_org_sku` (`organization_id`,`sku`),
  KEY `idx_product_variants_product` (`product_id`,`position`),
  KEY `fk_product_variants_product` (`organization_id`,`product_id`),
  CONSTRAINT `fk_product_variants_product` FOREIGN KEY (`organization_id`, `product_id`) REFERENCES `products` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `products` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `name` varchar(500) NOT NULL,
  `name_bn` varchar(500) NOT NULL DEFAULT '',
  `slug` varchar(600) NOT NULL,
  `description` longtext NOT NULL,
  `description_bn` longtext NOT NULL,
  `category_id` varchar(32) NOT NULL,
  `top_category_id` varchar(32) DEFAULT NULL,
  `brand_id` varchar(32) DEFAULT NULL,
  `age_group` enum('adult','kids','girls') NOT NULL DEFAULT 'adult',
  `base_price` decimal(12,2) NOT NULL,
  `discount_price` decimal(12,2) DEFAULT NULL,
  `price_currency` enum('USD','BDT') NOT NULL DEFAULT 'BDT',
  `images` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`images`)),
  `image_framing` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`image_framing`)),
  `measurement_height_range` varchar(120) NOT NULL DEFAULT '',
  `measurement_chest` varchar(120) NOT NULL DEFAULT '',
  `measurement_sleeve_length` varchar(120) NOT NULL DEFAULT '',
  `included_items` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`included_items`)),
  `availability` enum('readyStock','preOrder','madeToOrder') NOT NULL DEFAULT 'readyStock',
  `tags` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`tags`)),
  `tags_text` text NOT NULL,
  `rating` decimal(3,2) NOT NULL DEFAULT 0.00,
  `num_reviews` int(11) NOT NULL DEFAULT 0,
  `is_featured` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `meta_title` varchar(255) NOT NULL DEFAULT '',
  `meta_description` varchar(500) NOT NULL DEFAULT '',
  `meta_keywords` varchar(500) NOT NULL DEFAULT '',
  `og_image` varchar(1024) NOT NULL DEFAULT '',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_products_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_products_org_slug` (`organization_id`,`slug`),
  KEY `idx_products_org_category` (`organization_id`,`category_id`,`top_category_id`,`age_group`),
  KEY `idx_products_org_price` (`organization_id`,`base_price`),
  KEY `idx_products_org_active_created` (`organization_id`,`is_active`,`created_at`),
  KEY `idx_products_org_active_topcat` (`organization_id`,`is_active`,`top_category_id`,`created_at`),
  KEY `idx_products_org_featured` (`organization_id`,`is_featured`,`is_active`,`rating`),
  KEY `idx_products_org_name` (`organization_id`,`name`),
  KEY `idx_products_org_brand` (`organization_id`,`brand_id`),
  KEY `idx_products_deleted_at` (`deleted_at`),
  KEY `fk_products_top_category` (`organization_id`,`top_category_id`),
  FULLTEXT KEY `ftx_products_search` (`name`,`description`,`tags_text`),
  CONSTRAINT `fk_products_brand` FOREIGN KEY (`organization_id`, `brand_id`) REFERENCES `brands` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_products_category` FOREIGN KEY (`organization_id`, `category_id`) REFERENCES `categories` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_products_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_products_top_category` FOREIGN KEY (`organization_id`, `top_category_id`) REFERENCES `categories` (`organization_id`, `id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `promotions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `promotions` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `name` varchar(120) NOT NULL,
  `type` enum('carousel','popup') NOT NULL,
  `placement` enum('home_hero','storefront_popup') NOT NULL,
  `status` enum('draft','active','paused') NOT NULL DEFAULT 'draft',
  `title` varchar(200) NOT NULL DEFAULT '',
  `title_bn` varchar(200) NOT NULL DEFAULT '',
  `subtitle` varchar(400) NOT NULL DEFAULT '',
  `subtitle_bn` varchar(400) NOT NULL DEFAULT '',
  `cta_label` varchar(60) NOT NULL DEFAULT '',
  `cta_label_bn` varchar(60) NOT NULL DEFAULT '',
  `desktop_image` varchar(1024) NOT NULL,
  `mobile_image` varchar(1024) NOT NULL DEFAULT '',
  `desktop_framing` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`desktop_framing`)),
  `mobile_framing` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`mobile_framing`)),
  `image_alt` varchar(200) NOT NULL DEFAULT '',
  `image_alt_bn` varchar(200) NOT NULL DEFAULT '',
  `target_type` varchar(32) NOT NULL DEFAULT 'none',
  `target_product_id` varchar(32) DEFAULT NULL,
  `target_category_id` varchar(32) DEFAULT NULL,
  `target_collection` varchar(64) DEFAULT NULL,
  `target_shop_filter_category_id` varchar(32) DEFAULT NULL,
  `target_shop_filter_collection` varchar(64) DEFAULT NULL,
  `target_shop_filter_style_id` varchar(32) DEFAULT NULL,
  `target_url` varchar(300) NOT NULL DEFAULT '',
  `start_at` datetime(3) DEFAULT NULL,
  `end_at` datetime(3) DEFAULT NULL,
  `priority` smallint(5) unsigned NOT NULL DEFAULT 0,
  `sort_order` smallint(5) unsigned NOT NULL DEFAULT 0,
  `audience` varchar(32) NOT NULL DEFAULT 'all',
  `page_scope` varchar(32) NOT NULL DEFAULT 'home',
  `popup_delay_ms` int(11) NOT NULL DEFAULT 2000,
  `frequency` varchar(32) NOT NULL DEFAULT 'once_per_session',
  `cooldown_hours` int(11) DEFAULT NULL,
  `version` int(11) NOT NULL DEFAULT 1,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_promotions_org_id` (`organization_id`,`id`),
  KEY `idx_promotions_eligibility` (`organization_id`,`type`,`placement`,`status`,`page_scope`,`sort_order`,`priority`),
  KEY `idx_promotions_admin_list` (`organization_id`,`type`,`status`,`created_at`),
  KEY `idx_promotions_schedule` (`organization_id`,`start_at`,`end_at`),
  KEY `fk_promotions_target_product` (`organization_id`,`target_product_id`),
  KEY `fk_promotions_target_category` (`organization_id`,`target_category_id`),
  CONSTRAINT `fk_promotions_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_promotions_target_category` FOREIGN KEY (`organization_id`, `target_category_id`) REFERENCES `categories` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_promotions_target_product` FOREIGN KEY (`organization_id`, `target_product_id`) REFERENCES `products` (`organization_id`, `id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `rate_limit_counters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `rate_limit_counters` (
  `organization_id` varchar(32) NOT NULL,
  `key_hash` char(64) NOT NULL,
  `action` varchar(64) NOT NULL,
  `window_start` datetime(3) NOT NULL,
  `count` int(10) unsigned NOT NULL DEFAULT 0,
  `expires_at` datetime(3) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`organization_id`,`key_hash`,`action`,`window_start`),
  KEY `idx_rate_limit_expires_at` (`expires_at`),
  CONSTRAINT `fk_rate_limit_organization` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `review_helpful_votes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `review_helpful_votes` (
  `organization_id` varchar(32) NOT NULL,
  `review_id` varchar(32) NOT NULL,
  `customer_id` varchar(32) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`review_id`,`customer_id`),
  KEY `idx_review_helpful_votes_customer` (`customer_id`),
  KEY `fk_review_helpful_votes_review` (`organization_id`,`review_id`),
  CONSTRAINT `fk_review_helpful_votes_review` FOREIGN KEY (`organization_id`, `review_id`) REFERENCES `reviews` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reviews`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `reviews` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `customer_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `rating` tinyint(3) unsigned NOT NULL,
  `title` varchar(100) NOT NULL DEFAULT '',
  `comment` text NOT NULL,
  `is_verified_purchase` tinyint(1) NOT NULL DEFAULT 0,
  `images` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`images`)),
  `helpful_count` int(11) NOT NULL DEFAULT 0,
  `admin_reply_text` text NOT NULL,
  `admin_reply_by` varchar(32) DEFAULT NULL,
  `admin_reply_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reviews_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_reviews_customer_product` (`customer_id`,`product_id`),
  KEY `idx_reviews_org_product_created` (`organization_id`,`product_id`,`created_at`),
  KEY `idx_reviews_org_created` (`organization_id`,`created_at`),
  KEY `fk_reviews_customer` (`organization_id`,`customer_id`),
  CONSTRAINT `fk_reviews_customer` FOREIGN KEY (`organization_id`, `customer_id`) REFERENCES `customers` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_reviews_product` FOREIGN KEY (`organization_id`, `product_id`) REFERENCES `products` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `role_menu_actions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `role_menu_actions` (
  `id` varchar(32) NOT NULL,
  `role_id` varchar(32) NOT NULL,
  `menu_id` varchar(32) NOT NULL,
  `action` enum('view','create','update','delete') NOT NULL,
  `allowed` tinyint(1) NOT NULL DEFAULT 1,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_role_menu_action` (`role_id`,`menu_id`,`action`),
  KEY `idx_role_menu_actions_role` (`role_id`),
  KEY `idx_role_menu_actions_menu` (`menu_id`),
  CONSTRAINT `fk_role_menu_actions_menu` FOREIGN KEY (`menu_id`) REFERENCES `menus` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_role_menu_actions_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='DEPRECATED as of migration 040 — read-only, historical data only. No application code reads or writes this table; do not promote allowed=1 rows into real grants. See scripts/export-role-menu-actions.mjs.';
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `role_menu_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `role_menu_permissions` (
  `id` varchar(32) NOT NULL,
  `role_id` varchar(32) NOT NULL,
  `menu_id` varchar(64) NOT NULL,
  `allowed` tinyint(1) NOT NULL DEFAULT 1,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_role_menu` (`role_id`,`menu_id`),
  KEY `idx_role_menu_menu` (`menu_id`),
  CONSTRAINT `fk_role_menu_menu` FOREIGN KEY (`menu_id`) REFERENCES `menus` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_role_menu_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `role_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `role_permissions` (
  `id` varchar(32) NOT NULL,
  `role_id` varchar(32) NOT NULL,
  `permission_id` varchar(32) NOT NULL,
  `allowed` tinyint(1) NOT NULL DEFAULT 1,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_role_permissions` (`role_id`,`permission_id`),
  KEY `idx_role_permissions_permission` (`permission_id`),
  CONSTRAINT `fk_role_permissions_permission` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_role_permissions_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `roles` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) DEFAULT NULL,
  `parent_role_id` varchar(32) DEFAULT NULL,
  `name` varchar(128) NOT NULL,
  `translation_key` varchar(191) DEFAULT NULL,
  `slug` varchar(128) NOT NULL,
  `description` varchar(255) NOT NULL DEFAULT '',
  `scope` enum('PLATFORM','ORGANIZATION_TEMPLATE','Organization','Branch') NOT NULL DEFAULT 'ORGANIZATION_TEMPLATE',
  `is_system` tinyint(1) NOT NULL DEFAULT 0,
  `status` enum('Active','Archived') NOT NULL DEFAULT 'Active',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  `template_slug` varchar(128) GENERATED ALWAYS AS (if(`organization_id` is null,`slug`,NULL)) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_roles_org_slug` (`organization_id`,`slug`),
  UNIQUE KEY `uq_roles_template_slug` (`template_slug`),
  KEY `idx_roles_org` (`organization_id`,`status`),
  KEY `fk_roles_parent` (`parent_role_id`),
  KEY `fk_roles_translation_key` (`translation_key`),
  CONSTRAINT `fk_roles_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_roles_parent` FOREIGN KEY (`parent_role_id`) REFERENCES `roles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_roles_translation_key` FOREIGN KEY (`translation_key`) REFERENCES `translation_keys` (`key`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `schema_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `schema_migrations` (
  `name` varchar(255) NOT NULL,
  `applied_at` datetime NOT NULL DEFAULT current_timestamp(),
  `duration_ms` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `sessions` (
  `id` varchar(64) NOT NULL,
  `token_hash` char(64) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `organization_id` varchar(32) DEFAULT NULL,
  `branch_id` varchar(32) DEFAULT NULL,
  `user_type` enum('PROVIDER','STORE_ADMIN','DEV','SPECIAL_GUEST') NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(512) DEFAULT NULL,
  `browser` varchar(64) DEFAULT NULL,
  `device` varchar(64) DEFAULT NULL,
  `impersonated_by_id` varchar(32) DEFAULT NULL,
  `impersonated_by_name` varchar(255) DEFAULT NULL,
  `impersonated_by_email` varchar(255) DEFAULT NULL,
  `support_reason` varchar(255) DEFAULT NULL,
  `support_scope` enum('tenant','branch','user') DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `last_seen_at` datetime NOT NULL DEFAULT current_timestamp(),
  `expires_at` datetime NOT NULL,
  `revoked_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sessions_token` (`token_hash`),
  KEY `idx_sessions_user` (`user_id`,`revoked_at`),
  KEY `idx_sessions_expiry` (`expires_at`),
  KEY `fk_sessions_org` (`organization_id`),
  KEY `fk_sessions_branch` (`branch_id`),
  CONSTRAINT `fk_sessions_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_sessions_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `store_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `store_settings` (
  `organization_id` varchar(32) NOT NULL,
  `store_name` varchar(255) NOT NULL DEFAULT 'My Store',
  `store_support_email` varchar(320) NOT NULL DEFAULT '',
  `store_support_phone` varchar(64) NOT NULL DEFAULT '',
  `store_logo_url` varchar(1024) NOT NULL DEFAULT '',
  `store_logo_dark_url` varchar(1024) NOT NULL DEFAULT '',
  `store_favicon_url` varchar(1024) NOT NULL DEFAULT '',
  `homepage` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`homepage`)),
  `currency` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`currency`)),
  `promotions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`promotions`)),
  `exchange_policy` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`exchange_policy`)),
  `tax_rules` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`tax_rules`)),
  `shipping_zones` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`shipping_zones`)),
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`organization_id`),
  CONSTRAINT `fk_store_settings_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `storefront_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `storefront_events` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` varchar(32) NOT NULL,
  `channel` varchar(120) NOT NULL,
  `type` varchar(120) NOT NULL,
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`payload`)),
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `expires_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_storefront_events_channel_id` (`organization_id`,`channel`,`id`),
  KEY `idx_storefront_events_expires_at` (`expires_at`),
  CONSTRAINT `fk_storefront_events_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `storefront_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `storefront_migrations` (
  `id` varchar(64) NOT NULL,
  `description` varchar(255) NOT NULL,
  `applied_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `storefront_themes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `storefront_themes` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `name` varchar(120) NOT NULL DEFAULT 'Default',
  `is_active` tinyint(1) NOT NULL DEFAULT 0,
  `colors` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`colors`)),
  `dark_colors` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`dark_colors`)),
  `fonts` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`fonts`)),
  `radius` varchar(32) NOT NULL DEFAULT '0.75rem',
  `shadow_style` enum('none','soft','medium','hard') NOT NULL DEFAULT 'soft',
  `density` enum('compact','comfortable','spacious') NOT NULL DEFAULT 'comfortable',
  `logo_url` varchar(1024) NOT NULL DEFAULT '',
  `logo_dark_url` varchar(1024) NOT NULL DEFAULT '',
  `favicon_url` varchar(1024) NOT NULL DEFAULT '',
  `site_name` varchar(120) NOT NULL DEFAULT '',
  `tagline` varchar(255) NOT NULL DEFAULT '',
  `features` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`features`)),
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_storefront_themes_org_id` (`organization_id`,`id`),
  KEY `idx_storefront_themes_org_active` (`organization_id`,`is_active`),
  CONSTRAINT `fk_storefront_themes_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `subscriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `subscriptions` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `plan_id` varchar(32) NOT NULL,
  `status` enum('Trial','Active','Past Due','Suspended','Cancelled','Expired') NOT NULL DEFAULT 'Trial',
  `started_at` datetime NOT NULL DEFAULT current_timestamp(),
  `trial_ends_at` datetime DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `seats` int(11) DEFAULT NULL,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subscriptions_org` (`organization_id`),
  KEY `idx_subscriptions_status` (`status`,`expires_at`),
  KEY `fk_subscriptions_plan` (`plan_id`),
  CONSTRAINT `fk_subscriptions_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_subscriptions_plan` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `theme_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `theme_settings` (
  `id` varchar(32) NOT NULL,
  `brand_name` varchar(128) NOT NULL DEFAULT 'Scoobee',
  `product_name` varchar(128) NOT NULL DEFAULT 'ERP Platform',
  `preset` varchar(32) NOT NULL DEFAULT 'indigo',
  `primary_color` varchar(16) NOT NULL DEFAULT '#5850ec',
  `accent_color` varchar(16) NOT NULL DEFAULT '#8b5cf6',
  `gradient_from` varchar(16) NOT NULL DEFAULT '#5850ec',
  `gradient_via` varchar(16) NOT NULL DEFAULT '#8b5cf6',
  `gradient_to` varchar(16) NOT NULL DEFAULT '#06b6d4',
  `chart_palette` longtext DEFAULT NULL CHECK (`chart_palette` is null or json_valid(`chart_palette`)),
  `sidebar_style` enum('solid','glass','gradient') NOT NULL DEFAULT 'solid',
  `card_style` enum('flat','shadow','glass') NOT NULL DEFAULT 'shadow',
  `radius` enum('small','medium','rounded') NOT NULL DEFAULT 'medium',
  `font_style` varchar(64) NOT NULL DEFAULT 'geist',
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `translation_keys`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `translation_keys` (
  `id` varchar(32) NOT NULL,
  `key` varchar(191) NOT NULL,
  `module` varchar(64) NOT NULL DEFAULT '',
  `description` varchar(255) NOT NULL DEFAULT '',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_translation_keys_key` (`key`),
  KEY `idx_translation_keys_module` (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `translations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `translations` (
  `id` varchar(32) NOT NULL,
  `translation_key_id` varchar(32) NOT NULL,
  `locale_id` varchar(32) NOT NULL,
  `organization_id` varchar(32) DEFAULT NULL,
  `value` varchar(1000) NOT NULL,
  `org_scope` varchar(32) GENERATED ALWAYS AS (coalesce(`organization_id`,'')) VIRTUAL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_translations` (`translation_key_id`,`locale_id`,`org_scope`),
  KEY `idx_translations_locale` (`locale_id`),
  KEY `idx_translations_org` (`organization_id`),
  CONSTRAINT `fk_translations_key` FOREIGN KEY (`translation_key_id`) REFERENCES `translation_keys` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_translations_locale` FOREIGN KEY (`locale_id`) REFERENCES `locales` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_translations_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_branches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user_branches` (
  `id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `branch_id` varchar(32) NOT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT 0,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_branches` (`user_id`,`branch_id`),
  KEY `idx_user_branches_branch` (`branch_id`),
  CONSTRAINT `fk_user_branches_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_branches_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_mobile_navigation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user_mobile_navigation` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `role_id` varchar(32) NOT NULL,
  `menu_id` varchar(64) NOT NULL,
  `order_position` int(11) NOT NULL DEFAULT 0,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mobile_nav` (`organization_id`,`role_id`,`menu_id`),
  KEY `idx_mobile_nav_role` (`role_id`,`order_position`),
  KEY `fk_mobile_nav_menu` (`menu_id`),
  CONSTRAINT `fk_mobile_nav_menu` FOREIGN KEY (`menu_id`) REFERENCES `menus` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mobile_nav_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mobile_nav_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_table_preferences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `user_table_preferences` (
  `id` varchar(32) NOT NULL,
  `user_id` varchar(32) NOT NULL,
  `table_key` varchar(64) NOT NULL,
  `visible_columns` longtext DEFAULT NULL CHECK (`visible_columns` is null or json_valid(`visible_columns`)),
  `sort_order` longtext DEFAULT NULL CHECK (`sort_order` is null or json_valid(`sort_order`)),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_table_pref` (`user_id`,`table_key`),
  KEY `idx_user_table_pref_user` (`user_id`),
  CONSTRAINT `fk_user_table_pref_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `users` (
  `id` varchar(32) NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `mobile` varchar(32) DEFAULT NULL,
  `username` varchar(64) DEFAULT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `password_changed_at` datetime DEFAULT NULL,
  `user_type` enum('PROVIDER','STORE_ADMIN','DEV','SPECIAL_GUEST') NOT NULL,
  `status` enum('Active','Invited','Suspended','Disabled') NOT NULL DEFAULT 'Invited',
  `avatar_url` varchar(512) DEFAULT NULL,
  `locale` varchar(8) DEFAULT NULL,
  `last_login_at` datetime DEFAULT NULL,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `deleted_by_id` varchar(32) DEFAULT NULL,
  `deleted_by_name` varchar(255) DEFAULT NULL,
  `deleted_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  UNIQUE KEY `uq_users_username` (`username`),
  KEY `idx_users_type_status` (`user_type`,`status`),
  KEY `fk_users_locale` (`locale`),
  CONSTRAINT `fk_users_locale` FOREIGN KEY (`locale`) REFERENCES `locales` (`code`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `wishlist_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `wishlist_items` (
  `organization_id` varchar(32) NOT NULL,
  `wishlist_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `added_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`wishlist_id`,`product_id`),
  KEY `idx_wishlist_items_org_product` (`organization_id`,`product_id`),
  KEY `fk_wishlist_items_wishlist` (`organization_id`,`wishlist_id`),
  CONSTRAINT `fk_wishlist_items_wishlist` FOREIGN KEY (`organization_id`, `wishlist_id`) REFERENCES `wishlists` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `wishlists`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `wishlists` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `customer_id` varchar(32) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wishlists_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_wishlists_customer` (`customer_id`),
  KEY `fk_wishlists_customer` (`organization_id`,`customer_id`),
  CONSTRAINT `fk_wishlists_customer` FOREIGN KEY (`organization_id`, `customer_id`) REFERENCES `customers` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

