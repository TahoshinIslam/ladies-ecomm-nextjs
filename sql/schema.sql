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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
DELIMITER ;;
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_branches_keep_order_history BEFORE DELETE ON branches
FOR EACH ROW
  IF EXISTS (SELECT 1 FROM orders o WHERE o.organization_id = OLD.organization_id AND o.branch_id = OLD.id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This branch has orders, so it cannot be deleted: its orders, payments and stock belong to it. Set its status to Suspended or Archived instead.';
  END IF */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
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
DROP TABLE IF EXISTS `customer_return_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `customer_return_lines` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `return_id` varchar(32) NOT NULL,
  `order_item_id` bigint(20) unsigned DEFAULT NULL,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `sku` varchar(255) NOT NULL DEFAULT '',
  `item_name` varchar(500) NOT NULL DEFAULT '',
  `quantity` decimal(14,3) NOT NULL,
  `item_condition` enum('sellable','damaged','defective','wrong_item') NOT NULL,
  `restocked` tinyint(1) NOT NULL DEFAULT 0,
  `position` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_customer_return_lines_doc` (`return_id`,`position`),
  KEY `idx_customer_return_lines_order_item` (`organization_id`,`order_item_id`),
  KEY `fk_customer_return_lines_doc` (`organization_id`,`return_id`),
  CONSTRAINT `fk_customer_return_lines_doc` FOREIGN KEY (`organization_id`, `return_id`) REFERENCES `customer_returns` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_customer_return_lines_qty` CHECK (`quantity` > 0),
  CONSTRAINT `chk_customer_return_lines_restock` CHECK (`restocked` = 0 or `item_condition` = 'sellable')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `customer_returns`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `customer_returns` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `number` varchar(20) NOT NULL,
  `order_id` varchar(32) DEFAULT NULL,
  `customer_id` varchar(32) DEFAULT NULL,
  `location_id` varchar(32) NOT NULL,
  `reason` varchar(500) NOT NULL DEFAULT '',
  `notes` varchar(1000) NOT NULL DEFAULT '',
  `submission_key` varchar(64) DEFAULT NULL,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_returns_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_customer_returns_org_number` (`organization_id`,`number`),
  UNIQUE KEY `uq_customer_returns_submission` (`organization_id`,`submission_key`),
  KEY `idx_customer_returns_order` (`organization_id`,`order_id`),
  KEY `fk_customer_returns_location` (`organization_id`,`location_id`),
  CONSTRAINT `fk_customer_returns_location` FOREIGN KEY (`organization_id`, `location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_customer_returns_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `document_sequences`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `document_sequences` (
  `organization_id` varchar(32) NOT NULL,
  `doc_type` varchar(16) NOT NULL,
  `last_number` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`organization_id`,`doc_type`),
  CONSTRAINT `fk_document_sequences_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
DROP TABLE IF EXISTS `inventory_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `inventory_settings` (
  `organization_id` varchar(32) NOT NULL,
  `default_location_id` varchar(32) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`organization_id`),
  KEY `fk_inventory_settings_location` (`default_location_id`),
  CONSTRAINT `fk_inventory_settings_location` FOREIGN KEY (`default_location_id`) REFERENCES `stock_locations` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_settings_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
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
DROP TABLE IF EXISTS `location_branch_access`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `location_branch_access` (
  `organization_id` varchar(32) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `branch_id` varchar(32) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `created_by_name` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`location_id`,`branch_id`),
  KEY `idx_location_branch_access_branch` (`organization_id`,`branch_id`),
  KEY `fk_location_branch_access_location` (`organization_id`,`location_id`),
  CONSTRAINT `fk_location_branch_access_branch` FOREIGN KEY (`organization_id`, `branch_id`) REFERENCES `branches` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_location_branch_access_location` FOREIGN KEY (`organization_id`, `location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  KEY `fk_orders_customer` (`organization_id`,`customer_id`),
  KEY `fk_orders_org_branch` (`organization_id`,`branch_id`),
  CONSTRAINT `fk_orders_customer` FOREIGN KEY (`organization_id`, `customer_id`) REFERENCES `customers` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_orders_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_orders_org_branch` FOREIGN KEY (`organization_id`, `branch_id`) REFERENCES `branches` (`organization_id`, `id`) ON UPDATE CASCADE
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
DROP TABLE IF EXISTS `pos_cash_movements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pos_cash_movements` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `session_id` varchar(32) NOT NULL,
  `kind` enum('cash_in','cash_out') NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `reason` varchar(255) NOT NULL,
  `actor_id` varchar(32) DEFAULT NULL,
  `actor_name` varchar(255) NOT NULL DEFAULT 'System',
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_pos_cash_movements_session` (`organization_id`,`session_id`,`created_at`),
  CONSTRAINT `fk_pos_cash_movements_session` FOREIGN KEY (`organization_id`, `session_id`) REFERENCES `pos_sessions` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `chk_pos_cash_movements_amount` CHECK (`amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pos_held_bill_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pos_held_bill_lines` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `bill_id` varchar(32) NOT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `sku` varchar(255) NOT NULL DEFAULT '',
  `item_name` varchar(500) NOT NULL DEFAULT '',
  `packaging_id` varchar(32) DEFAULT NULL,
  `packaging_code` varchar(32) NOT NULL DEFAULT '',
  `packaging_name` varchar(120) NOT NULL DEFAULT '',
  `quantity` decimal(14,3) NOT NULL,
  `base_quantity` decimal(14,3) NOT NULL,
  `unit_price` decimal(12,2) NOT NULL,
  `price_source` varchar(16) NOT NULL DEFAULT 'price',
  `override_reason` varchar(255) NOT NULL DEFAULT '',
  `discount_type` enum('none','percent','amount') NOT NULL DEFAULT 'none',
  `discount_value` decimal(12,2) NOT NULL DEFAULT 0.00,
  `reserved_quantity` decimal(14,3) NOT NULL DEFAULT 0.000,
  PRIMARY KEY (`id`),
  KEY `idx_pos_held_bill_lines_bill` (`organization_id`,`bill_id`,`position`),
  CONSTRAINT `fk_pos_held_bill_lines_bill` FOREIGN KEY (`organization_id`, `bill_id`) REFERENCES `pos_held_bills` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_pos_held_bill_lines_qty` CHECK (`quantity` > 0 and `base_quantity` > 0 and `reserved_quantity` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pos_held_bills`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pos_held_bills` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `number` varchar(20) NOT NULL,
  `branch_id` varchar(32) NOT NULL,
  `register_id` varchar(32) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `cashier_id` varchar(32) NOT NULL,
  `cashier_name` varchar(255) NOT NULL,
  `customer_id` varchar(32) DEFAULT NULL,
  `customer_name` varchar(255) NOT NULL DEFAULT '',
  `customer_phone` varchar(64) NOT NULL DEFAULT '',
  `label` varchar(120) NOT NULL DEFAULT '',
  `notes` varchar(500) NOT NULL DEFAULT '',
  `status` enum('held','completed','cancelled') NOT NULL DEFAULT 'held',
  `reservation_state` enum('reserved','expired') NOT NULL DEFAULT 'reserved',
  `expires_at` datetime(3) NOT NULL,
  `completed_sale_id` varchar(32) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pos_held_bills_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_pos_held_bills_number` (`organization_id`,`number`),
  KEY `idx_pos_held_bills_branch` (`organization_id`,`branch_id`,`status`,`created_at`),
  KEY `idx_pos_held_bills_expiry` (`organization_id`,`status`,`reservation_state`,`expires_at`),
  KEY `fk_pos_held_bills_register` (`organization_id`,`register_id`),
  CONSTRAINT `fk_pos_held_bills_register` FOREIGN KEY (`organization_id`, `register_id`) REFERENCES `pos_registers` (`organization_id`, `id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pos_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pos_payments` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `session_id` varchar(32) NOT NULL,
  `sale_id` varchar(32) DEFAULT NULL,
  `return_id` varchar(32) DEFAULT NULL,
  `direction` enum('in','out') NOT NULL,
  `method` enum('cash','card','mobile','other') NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `tendered` decimal(12,2) DEFAULT NULL,
  `change_given` decimal(12,2) NOT NULL DEFAULT 0.00,
  `reference` varchar(120) NOT NULL DEFAULT '',
  `recording` enum('manual') NOT NULL DEFAULT 'manual',
  `status` enum('completed','pending','failed') NOT NULL DEFAULT 'completed',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) NOT NULL DEFAULT 'System',
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_pos_payments_session` (`organization_id`,`session_id`,`direction`,`method`),
  KEY `idx_pos_payments_sale` (`organization_id`,`sale_id`),
  KEY `idx_pos_payments_return` (`organization_id`,`return_id`),
  KEY `idx_pos_payments_org_created` (`organization_id`,`created_at`),
  CONSTRAINT `fk_pos_payments_session` FOREIGN KEY (`organization_id`, `session_id`) REFERENCES `pos_sessions` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `chk_pos_payments_amount` CHECK (`amount` > 0),
  CONSTRAINT `chk_pos_payments_target` CHECK (`sale_id` is not null or `return_id` is not null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pos_registers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pos_registers` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `branch_id` varchar(32) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `name` varchar(120) NOT NULL,
  `code` varchar(32) NOT NULL,
  `status` enum('Active','Archived') NOT NULL DEFAULT 'Active',
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pos_registers_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_pos_registers_org_code` (`organization_id`,`code`),
  KEY `idx_pos_registers_branch` (`organization_id`,`branch_id`),
  KEY `fk_pos_registers_location` (`organization_id`,`location_id`),
  CONSTRAINT `fk_pos_registers_branch` FOREIGN KEY (`organization_id`, `branch_id`) REFERENCES `branches` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_pos_registers_location` FOREIGN KEY (`organization_id`, `location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_pos_registers_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pos_return_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pos_return_lines` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `return_id` varchar(32) NOT NULL,
  `sale_line_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `sku` varchar(255) NOT NULL DEFAULT '',
  `item_name` varchar(500) NOT NULL DEFAULT '',
  `quantity` decimal(14,3) NOT NULL,
  `base_quantity` decimal(14,3) NOT NULL,
  `disposition` enum('restock','quarantine','damaged','refund_only') NOT NULL,
  `credit_amount` decimal(12,2) NOT NULL,
  `reason` varchar(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `idx_pos_return_lines_return` (`organization_id`,`return_id`),
  KEY `idx_pos_return_lines_sale_line` (`organization_id`,`sale_line_id`),
  CONSTRAINT `fk_pos_return_lines_return` FOREIGN KEY (`organization_id`, `return_id`) REFERENCES `pos_returns` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_pos_return_lines_sale_line` FOREIGN KEY (`organization_id`, `sale_line_id`) REFERENCES `pos_sale_lines` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `chk_pos_return_lines_qty` CHECK (`quantity` > 0 and `base_quantity` > 0 and `credit_amount` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pos_returns`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pos_returns` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `number` varchar(20) NOT NULL,
  `sale_id` varchar(32) NOT NULL,
  `session_id` varchar(32) NOT NULL,
  `register_id` varchar(32) NOT NULL,
  `branch_id` varchar(32) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `cashier_id` varchar(32) NOT NULL,
  `cashier_name` varchar(255) NOT NULL,
  `reason` varchar(500) NOT NULL DEFAULT '',
  `credit_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `replacement_sale_id` varchar(32) DEFAULT NULL,
  `net_settlement` decimal(12,2) NOT NULL DEFAULT 0.00,
  `submission_key` varchar(64) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pos_returns_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_pos_returns_number` (`organization_id`,`number`),
  UNIQUE KEY `uq_pos_returns_submission` (`organization_id`,`submission_key`),
  KEY `idx_pos_returns_sale` (`organization_id`,`sale_id`),
  KEY `idx_pos_returns_org_created` (`organization_id`,`created_at`),
  KEY `fk_pos_returns_session` (`organization_id`,`session_id`),
  CONSTRAINT `fk_pos_returns_sale` FOREIGN KEY (`organization_id`, `sale_id`) REFERENCES `pos_sales` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_pos_returns_session` FOREIGN KEY (`organization_id`, `session_id`) REFERENCES `pos_sessions` (`organization_id`, `id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pos_sale_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pos_sale_lines` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `sale_id` varchar(32) NOT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `sku` varchar(255) NOT NULL DEFAULT '',
  `item_name` varchar(500) NOT NULL DEFAULT '',
  `base_unit` varchar(8) NOT NULL DEFAULT 'pc',
  `packaging_id` varchar(32) DEFAULT NULL,
  `packaging_code` varchar(32) NOT NULL DEFAULT '',
  `packaging_name` varchar(120) NOT NULL DEFAULT '',
  `quantity` decimal(14,3) NOT NULL,
  `base_quantity` decimal(14,3) NOT NULL,
  `unit_price` decimal(12,2) NOT NULL,
  `list_price` decimal(12,2) NOT NULL,
  `price_source` varchar(16) NOT NULL DEFAULT 'price',
  `override_reason` varchar(255) NOT NULL DEFAULT '',
  `line_gross` decimal(12,2) NOT NULL,
  `line_discount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `bill_discount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tax_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `line_total` decimal(12,2) NOT NULL,
  `returned_quantity` decimal(14,3) NOT NULL DEFAULT 0.000,
  `refunded_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pos_sale_lines_org_id` (`organization_id`,`id`),
  KEY `idx_pos_sale_lines_sale` (`organization_id`,`sale_id`,`position`),
  KEY `idx_pos_sale_lines_variant` (`organization_id`,`variant_id`),
  CONSTRAINT `fk_pos_sale_lines_sale` FOREIGN KEY (`organization_id`, `sale_id`) REFERENCES `pos_sales` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `chk_pos_sale_lines_qty` CHECK (`quantity` > 0 and `base_quantity` > 0),
  CONSTRAINT `chk_pos_sale_lines_returned` CHECK (`returned_quantity` >= 0 and `returned_quantity` <= `quantity`),
  CONSTRAINT `chk_pos_sale_lines_refunded` CHECK (`refunded_amount` >= 0 and `refunded_amount` <= `line_total`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pos_sales`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pos_sales` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `number` varchar(20) NOT NULL,
  `branch_id` varchar(32) NOT NULL,
  `register_id` varchar(32) NOT NULL,
  `session_id` varchar(32) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `cashier_id` varchar(32) NOT NULL,
  `cashier_name` varchar(255) NOT NULL,
  `customer_id` varchar(32) DEFAULT NULL,
  `customer_name` varchar(255) NOT NULL DEFAULT '',
  `customer_phone` varchar(64) NOT NULL DEFAULT '',
  `kind` enum('sale','exchange') NOT NULL DEFAULT 'sale',
  `status` enum('completed') NOT NULL DEFAULT 'completed',
  `subtotal` decimal(12,2) NOT NULL,
  `discount_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tax_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tax_label` varchar(120) NOT NULL DEFAULT '',
  `tax_inclusive` tinyint(1) NOT NULL DEFAULT 1,
  `total` decimal(12,2) NOT NULL,
  `tendered_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `change_due` decimal(12,2) NOT NULL DEFAULT 0.00,
  `currency` varchar(8) NOT NULL DEFAULT 'BDT',
  `notes` varchar(500) NOT NULL DEFAULT '',
  `submission_key` varchar(64) DEFAULT NULL,
  `held_bill_id` varchar(32) DEFAULT NULL,
  `exchange_return_id` varchar(32) DEFAULT NULL,
  `reprint_count` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pos_sales_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_pos_sales_number` (`organization_id`,`number`),
  UNIQUE KEY `uq_pos_sales_submission` (`organization_id`,`submission_key`),
  KEY `idx_pos_sales_org_created` (`organization_id`,`created_at`),
  KEY `idx_pos_sales_branch_created` (`organization_id`,`branch_id`,`created_at`),
  KEY `idx_pos_sales_session` (`organization_id`,`session_id`),
  KEY `idx_pos_sales_register` (`organization_id`,`register_id`,`created_at`),
  CONSTRAINT `fk_pos_sales_branch` FOREIGN KEY (`organization_id`, `branch_id`) REFERENCES `branches` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_pos_sales_register` FOREIGN KEY (`organization_id`, `register_id`) REFERENCES `pos_registers` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_pos_sales_session` FOREIGN KEY (`organization_id`, `session_id`) REFERENCES `pos_sessions` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `chk_pos_sales_amounts` CHECK (`total` >= 0 and `subtotal` >= 0 and `discount_total` >= 0 and `tax_total` >= 0 and `change_due` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pos_sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pos_sessions` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `register_id` varchar(32) NOT NULL,
  `branch_id` varchar(32) NOT NULL,
  `cashier_id` varchar(32) NOT NULL,
  `cashier_name` varchar(255) NOT NULL,
  `opened_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `opening_cash` decimal(12,2) NOT NULL DEFAULT 0.00,
  `status` enum('open','closed') NOT NULL DEFAULT 'open',
  `open_flag` tinyint(4) DEFAULT 1,
  `closed_at` datetime(3) DEFAULT NULL,
  `closed_by_id` varchar(32) DEFAULT NULL,
  `closed_by_name` varchar(255) DEFAULT NULL,
  `counted_cash` decimal(12,2) DEFAULT NULL,
  `expected_cash` decimal(12,2) DEFAULT NULL,
  `variance` decimal(12,2) DEFAULT NULL,
  `close_note` varchar(500) NOT NULL DEFAULT '',
  `reviewed_by_id` varchar(32) DEFAULT NULL,
  `reviewed_by_name` varchar(255) DEFAULT NULL,
  `reviewed_at` datetime(3) DEFAULT NULL,
  `review_note` varchar(500) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pos_sessions_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_pos_sessions_one_open` (`register_id`,`open_flag`),
  KEY `idx_pos_sessions_org_opened` (`organization_id`,`opened_at`),
  KEY `idx_pos_sessions_cashier` (`organization_id`,`cashier_id`,`opened_at`),
  KEY `fk_pos_sessions_register` (`organization_id`,`register_id`),
  CONSTRAINT `fk_pos_sessions_register` FOREIGN KEY (`organization_id`, `register_id`) REFERENCES `pos_registers` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `chk_pos_sessions_opening` CHECK (`opening_cash` >= 0),
  CONSTRAINT `chk_pos_sessions_open_flag` CHECK (`status` = 'open' and `open_flag` = 1 or `status` = 'closed' and `open_flag` is null)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `pos_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pos_settings` (
  `organization_id` varchar(32) NOT NULL,
  `held_expiry_minutes` int(11) NOT NULL DEFAULT 120,
  `max_discount_percent` decimal(5,2) NOT NULL DEFAULT 10.00,
  `accept_cash` tinyint(1) NOT NULL DEFAULT 1,
  `accept_card` tinyint(1) NOT NULL DEFAULT 1,
  `accept_mobile` tinyint(1) NOT NULL DEFAULT 1,
  `receipt_header` varchar(255) NOT NULL DEFAULT '',
  `receipt_footer` varchar(255) NOT NULL DEFAULT 'Thank you for shopping with us.',
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`organization_id`),
  CONSTRAINT `fk_pos_settings_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_pos_settings_expiry` CHECK (`held_expiry_minutes` between 1 and 10080),
  CONSTRAINT `chk_pos_settings_discount` CHECK (`max_discount_percent` between 0 and 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `price_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `price_history` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) DEFAULT NULL,
  `packaging_id` varchar(32) DEFAULT NULL,
  `sku` varchar(255) NOT NULL DEFAULT '',
  `item_name` varchar(500) NOT NULL DEFAULT '',
  `price_kind` enum('base_price','discount_price','price','packaging_price') NOT NULL,
  `scope_type` enum('global','branch','channel') NOT NULL DEFAULT 'global',
  `scope_id` varchar(32) DEFAULT NULL,
  `previous_value` decimal(12,2) DEFAULT NULL,
  `new_value` decimal(12,2) DEFAULT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'BDT',
  `pricing_unit` varchar(32) NOT NULL DEFAULT 'pc',
  `effective_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `reason` varchar(255) NOT NULL DEFAULT '',
  `operation_id` varchar(40) NOT NULL DEFAULT '',
  `actor_id` varchar(32) DEFAULT NULL,
  `actor_name` varchar(255) NOT NULL DEFAULT 'System',
  `actor_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_price_history_org_created` (`organization_id`,`created_at`),
  KEY `idx_price_history_variant` (`organization_id`,`variant_id`,`id`),
  KEY `idx_price_history_product` (`organization_id`,`product_id`,`id`),
  KEY `idx_price_history_operation` (`organization_id`,`operation_id`),
  CONSTRAINT `fk_price_history_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_price_history_changed` CHECK (!(`previous_value` <=> `new_value`))
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
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_price_history_no_update BEFORE UPDATE ON price_history
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'price_history is append-only: change the price again instead' */;;
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
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_price_history_no_delete BEFORE DELETE ON price_history
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'price_history is append-only: change the price again instead' */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  `base_unit` varchar(8) NOT NULL DEFAULT 'pc',
  `quantity_scale` tinyint(3) unsigned NOT NULL DEFAULT 0,
  `sold_by` enum('unit','weight') NOT NULL DEFAULT 'unit',
  `barcode` varchar(64) DEFAULT NULL,
  `tracking` enum('none','lot','expiry') NOT NULL DEFAULT 'none',
  `sell_online` tinyint(1) NOT NULL DEFAULT 1,
  `sell_pos` tinyint(1) NOT NULL DEFAULT 1,
  `images` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`images`)),
  `position` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_variants_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_product_variants_org_sku` (`organization_id`,`sku`),
  UNIQUE KEY `uq_product_variants_org_barcode` (`organization_id`,`barcode`),
  KEY `idx_product_variants_product` (`product_id`,`position`),
  KEY `fk_product_variants_product` (`organization_id`,`product_id`),
  CONSTRAINT `fk_product_variants_product` FOREIGN KEY (`organization_id`, `product_id`) REFERENCES `products` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_product_variants_scale` CHECK (`quantity_scale` <= 3),
  CONSTRAINT `chk_product_variants_unit` CHECK (`base_unit` in ('pc','kg','g','l','ml'))
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
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_product_variants_keep_unit BEFORE UPDATE ON product_variants
FOR EACH ROW
  IF (NEW.base_unit <> OLD.base_unit OR NEW.quantity_scale < OLD.quantity_scale)
     AND (EXISTS (SELECT 1 FROM stock_movements m WHERE m.organization_id = OLD.organization_id AND m.variant_id = OLD.id)
          OR EXISTS (SELECT 1 FROM stock_levels l WHERE l.organization_id = OLD.organization_id AND l.variant_id = OLD.id AND (l.on_hand <> 0 OR l.reserved <> 0))
          OR EXISTS (SELECT 1 FROM stock_reservations r WHERE r.organization_id = OLD.organization_id AND r.variant_id = OLD.id)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The base unit of a product that has stock history cannot change: its movements and balances are counted in that unit. Create a new variant instead.';
  END IF */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
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
DROP TABLE IF EXISTS `purchase_order_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `purchase_order_lines` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `purchase_order_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `sku` varchar(255) NOT NULL DEFAULT '',
  `item_name` varchar(500) NOT NULL DEFAULT '',
  `packaging_id` varchar(32) DEFAULT NULL,
  `packaging_code` varchar(32) NOT NULL DEFAULT '',
  `packaging_name` varchar(120) NOT NULL DEFAULT '',
  `packaging_quantity` decimal(14,3) DEFAULT NULL,
  `base_per_packaging` decimal(14,3) DEFAULT NULL,
  `quantity_ordered` decimal(14,3) NOT NULL,
  `quantity_received` decimal(14,3) NOT NULL DEFAULT 0.000,
  `unit_cost` decimal(12,2) DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_purchase_order_lines_org_id` (`organization_id`,`id`),
  KEY `idx_purchase_order_lines_po` (`purchase_order_id`,`position`),
  KEY `fk_purchase_order_lines_po` (`organization_id`,`purchase_order_id`),
  CONSTRAINT `fk_purchase_order_lines_po` FOREIGN KEY (`organization_id`, `purchase_order_id`) REFERENCES `purchase_orders` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_purchase_order_lines_qty` CHECK (`quantity_ordered` > 0 and `quantity_received` >= 0 and `quantity_received` <= `quantity_ordered`),
  CONSTRAINT `chk_purchase_order_lines_cost` CHECK (`unit_cost` is null or `unit_cost` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `purchase_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `purchase_orders` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `number` varchar(20) NOT NULL,
  `supplier_id` varchar(32) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `status` enum('draft','approved','partially_received','received','cancelled') NOT NULL DEFAULT 'draft',
  `expected_at` date DEFAULT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'BDT',
  `notes` varchar(1000) NOT NULL DEFAULT '',
  `submission_key` varchar(64) DEFAULT NULL,
  `approved_by_id` varchar(32) DEFAULT NULL,
  `approved_by_name` varchar(255) DEFAULT NULL,
  `approved_at` datetime(3) DEFAULT NULL,
  `cancelled_by_id` varchar(32) DEFAULT NULL,
  `cancelled_by_name` varchar(255) DEFAULT NULL,
  `cancelled_at` datetime(3) DEFAULT NULL,
  `cancel_reason` varchar(500) NOT NULL DEFAULT '',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_purchase_orders_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_purchase_orders_org_number` (`organization_id`,`number`),
  UNIQUE KEY `uq_purchase_orders_submission` (`organization_id`,`submission_key`),
  KEY `idx_purchase_orders_org_status` (`organization_id`,`status`,`created_at`),
  KEY `fk_purchase_orders_supplier` (`organization_id`,`supplier_id`),
  KEY `fk_purchase_orders_location` (`organization_id`,`location_id`),
  CONSTRAINT `fk_purchase_orders_location` FOREIGN KEY (`organization_id`, `location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_purchase_orders_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_purchase_orders_supplier` FOREIGN KEY (`organization_id`, `supplier_id`) REFERENCES `suppliers` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
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
DROP TABLE IF EXISTS `stock_adjustment_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_adjustment_lines` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `adjustment_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `sku` varchar(255) NOT NULL DEFAULT '',
  `item_name` varchar(500) NOT NULL DEFAULT '',
  `quantity_change` decimal(14,3) NOT NULL,
  `on_hand_before` decimal(14,3) NOT NULL,
  `on_hand_after` decimal(14,3) NOT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_stock_adjustment_lines_doc` (`adjustment_id`,`position`),
  KEY `fk_stock_adjustment_lines_doc` (`organization_id`,`adjustment_id`),
  CONSTRAINT `fk_stock_adjustment_lines_doc` FOREIGN KEY (`organization_id`, `adjustment_id`) REFERENCES `stock_adjustments` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_stock_adjustment_lines_change` CHECK (`quantity_change` <> 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_adjustments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_adjustments` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `number` varchar(20) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `reason_code` enum('damaged','lost','theft','found','correction','expired','sample','other') NOT NULL,
  `note` varchar(1000) NOT NULL,
  `status` enum('posted','reversed') NOT NULL DEFAULT 'posted',
  `submission_key` varchar(64) DEFAULT NULL,
  `reversed_by_id` varchar(32) DEFAULT NULL,
  `reversed_by_name` varchar(255) DEFAULT NULL,
  `reversed_at` datetime(3) DEFAULT NULL,
  `reversal_reason` varchar(500) NOT NULL DEFAULT '',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_adjustments_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_stock_adjustments_org_number` (`organization_id`,`number`),
  UNIQUE KEY `uq_stock_adjustments_submission` (`organization_id`,`submission_key`),
  KEY `idx_stock_adjustments_org_created` (`organization_id`,`created_at`),
  KEY `fk_stock_adjustments_location` (`organization_id`,`location_id`),
  CONSTRAINT `fk_stock_adjustments_location` FOREIGN KEY (`organization_id`, `location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_adjustments_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_availability`;
/*!50001 DROP VIEW IF EXISTS `stock_availability`*/;
SET @saved_cs_client     = @@character_set_client;
SET character_set_client = utf8;
/*!50001 CREATE VIEW `stock_availability` AS SELECT
 1 AS `organization_id`,
  1 AS `location_id`,
  1 AS `variant_id`,
  1 AS `product_id`,
  1 AS `on_hand`,
  1 AS `reserved`,
  1 AS `expired_unswept`,
  1 AS `available` */;
SET character_set_client = @saved_cs_client;
DROP TABLE IF EXISTS `stock_condition_levels`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_condition_levels` (
  `organization_id` varchar(32) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `lot_id` varchar(32) NOT NULL DEFAULT '',
  `item_condition` enum('quarantine','damaged','expired') NOT NULL,
  `on_hand` decimal(14,3) NOT NULL DEFAULT 0.000,
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`location_id`,`variant_id`,`lot_id`,`item_condition`),
  KEY `idx_stock_condition_levels_org` (`organization_id`,`item_condition`),
  KEY `fk_stock_condition_levels_location` (`organization_id`,`location_id`),
  CONSTRAINT `fk_stock_condition_levels_location` FOREIGN KEY (`organization_id`, `location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_stock_condition_levels_on_hand` CHECK (`on_hand` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_count_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_count_lines` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `count_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `sku` varchar(255) NOT NULL DEFAULT '',
  `item_name` varchar(500) NOT NULL DEFAULT '',
  `counted_quantity` decimal(14,3) DEFAULT NULL,
  `system_quantity` decimal(14,3) DEFAULT NULL,
  `counted_at` datetime(3) DEFAULT NULL,
  `counted_by_name` varchar(255) DEFAULT NULL,
  `posted_change` decimal(14,3) DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_count_lines_variant` (`count_id`,`variant_id`),
  KEY `idx_stock_count_lines_org` (`organization_id`,`count_id`),
  CONSTRAINT `fk_stock_count_lines_count` FOREIGN KEY (`organization_id`, `count_id`) REFERENCES `stock_counts` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_stock_count_lines_qty` CHECK (`counted_quantity` is null or `counted_quantity` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_counts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_counts` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `number` varchar(20) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `status` enum('in_progress','submitted','posted','cancelled') NOT NULL DEFAULT 'in_progress',
  `notes` varchar(1000) NOT NULL DEFAULT '',
  `submitted_by_id` varchar(32) DEFAULT NULL,
  `submitted_by_name` varchar(255) DEFAULT NULL,
  `submitted_at` datetime(3) DEFAULT NULL,
  `posted_by_id` varchar(32) DEFAULT NULL,
  `posted_by_name` varchar(255) DEFAULT NULL,
  `posted_at` datetime(3) DEFAULT NULL,
  `cancelled_by_id` varchar(32) DEFAULT NULL,
  `cancelled_by_name` varchar(255) DEFAULT NULL,
  `cancelled_at` datetime(3) DEFAULT NULL,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_counts_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_stock_counts_org_number` (`organization_id`,`number`),
  KEY `idx_stock_counts_org_status` (`organization_id`,`status`,`created_at`),
  KEY `fk_stock_counts_location` (`organization_id`,`location_id`),
  CONSTRAINT `fk_stock_counts_location` FOREIGN KEY (`organization_id`, `location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_counts_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_levels`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_levels` (
  `organization_id` varchar(32) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `on_hand` decimal(14,3) NOT NULL DEFAULT 0.000,
  `reserved` decimal(14,3) NOT NULL DEFAULT 0.000,
  `reorder_point` decimal(14,3) DEFAULT NULL,
  `reorder_quantity` decimal(14,3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`location_id`,`variant_id`),
  KEY `idx_stock_levels_org_variant` (`organization_id`,`variant_id`),
  KEY `idx_stock_levels_org_product` (`organization_id`,`product_id`),
  KEY `fk_stock_levels_location` (`organization_id`,`location_id`),
  CONSTRAINT `fk_stock_levels_location` FOREIGN KEY (`organization_id`, `location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_stock_levels_on_hand` CHECK (`on_hand` >= 0),
  CONSTRAINT `chk_stock_levels_reserved` CHECK (`reserved` >= 0 and `reserved` <= `on_hand`),
  CONSTRAINT `chk_stock_levels_reorder` CHECK ((`reorder_point` is null or `reorder_point` >= 0) and (`reorder_quantity` is null or `reorder_quantity` > 0))
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
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_stock_levels_sync_insert AFTER INSERT ON stock_levels
FOR EACH ROW
  UPDATE product_variants pv
     SET pv.stock = online_available(NEW.organization_id, NEW.variant_id)
   WHERE pv.id = NEW.variant_id AND pv.organization_id = NEW.organization_id */;;
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
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_stock_levels_sync_update AFTER UPDATE ON stock_levels
FOR EACH ROW
  UPDATE product_variants pv
     SET pv.stock = online_available(NEW.organization_id, NEW.variant_id)
   WHERE pv.id = NEW.variant_id AND pv.organization_id = NEW.organization_id */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `stock_locations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_locations` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `branch_id` varchar(32) DEFAULT NULL,
  `parent_location_id` varchar(32) DEFAULT NULL,
  `name` varchar(120) NOT NULL,
  `code` varchar(32) NOT NULL,
  `location_type` enum('store','warehouse','other','area') NOT NULL DEFAULT 'store',
  `status` enum('Active','Archived') NOT NULL DEFAULT 'Active',
  `fulfils_online` tinyint(1) NOT NULL DEFAULT 0,
  `fulfilment_priority` int(11) DEFAULT NULL,
  `notes` varchar(500) NOT NULL DEFAULT '',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_locations_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_stock_locations_org_code` (`organization_id`,`code`),
  KEY `idx_stock_locations_org_branch` (`organization_id`,`branch_id`),
  KEY `fk_stock_locations_branch` (`branch_id`),
  KEY `idx_stock_locations_parent` (`organization_id`,`parent_location_id`),
  CONSTRAINT `fk_stock_locations_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_locations_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_stock_locations_parent` FOREIGN KEY (`organization_id`, `parent_location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON UPDATE CASCADE,
  CONSTRAINT `chk_stock_locations_not_own_parent` CHECK (`parent_location_id` is null or `parent_location_id` <> `id`),
  CONSTRAINT `chk_stock_locations_priority` CHECK (`fulfilment_priority` is null or `fulfilment_priority` >= 1)
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
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_stock_locations_sync_projection AFTER UPDATE ON stock_locations
FOR EACH ROW
  IF NEW.fulfils_online <> OLD.fulfils_online OR NEW.status <> OLD.status THEN
    UPDATE product_variants pv
      JOIN stock_levels sl ON sl.organization_id = pv.organization_id AND sl.variant_id = pv.id
       SET pv.stock = online_available(pv.organization_id, pv.id)
     WHERE sl.location_id = NEW.id;
  END IF */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `stock_lot_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_lot_events` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` varchar(32) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `lot_id` varchar(32) NOT NULL DEFAULT '',
  `item_condition` enum('sellable','quarantine','damaged','expired') NOT NULL,
  `quantity` decimal(14,3) NOT NULL,
  `source_type` varchar(32) NOT NULL,
  `source_id` varchar(40) NOT NULL,
  `source_line_id` varchar(40) NOT NULL DEFAULT '',
  `reason` varchar(255) NOT NULL DEFAULT '',
  `actor_id` varchar(32) DEFAULT NULL,
  `actor_name` varchar(255) NOT NULL DEFAULT 'System',
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_lot_events_source` (`organization_id`,`source_type`,`source_id`,`source_line_id`,`location_id`,`variant_id`,`lot_id`,`item_condition`),
  KEY `idx_stock_lot_events_lot` (`organization_id`,`lot_id`,`id`),
  KEY `idx_stock_lot_events_level` (`organization_id`,`location_id`,`variant_id`,`id`),
  CONSTRAINT `fk_stock_lot_events_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_stock_lot_events_quantity` CHECK (`quantity` <> 0)
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
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_stock_lot_events_no_update BEFORE UPDATE ON stock_lot_events
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_lot_events is append-only: record the opposite event instead' */;;
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
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_stock_lot_events_no_delete BEFORE DELETE ON stock_lot_events
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_lot_events is append-only: record the opposite event instead' */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `stock_lot_levels`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_lot_levels` (
  `organization_id` varchar(32) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `lot_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `on_hand` decimal(14,3) NOT NULL DEFAULT 0.000,
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`location_id`,`lot_id`),
  KEY `idx_stock_lot_levels_variant` (`organization_id`,`location_id`,`variant_id`),
  KEY `fk_stock_lot_levels_lot` (`organization_id`,`lot_id`),
  CONSTRAINT `fk_stock_lot_levels_location` FOREIGN KEY (`organization_id`, `location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_lot_levels_lot` FOREIGN KEY (`organization_id`, `lot_id`) REFERENCES `stock_lots` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_stock_lot_levels_on_hand` CHECK (`on_hand` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_lots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_lots` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `lot_ref` varchar(80) NOT NULL,
  `supplier_id` varchar(32) DEFAULT NULL,
  `received_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `expiry_date` date DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_lots_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_stock_lots_ref` (`organization_id`,`variant_id`,`lot_ref`),
  KEY `idx_stock_lots_expiry` (`organization_id`,`expiry_date`),
  CONSTRAINT `fk_stock_lots_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_movements`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_movements` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` varchar(32) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `sku` varchar(255) NOT NULL DEFAULT '',
  `item_name` varchar(500) NOT NULL DEFAULT '',
  `movement_type` enum('opening','receipt','adjustment','count','transfer_out','transfer_in','sale','customer_return','supplier_return','reversal','expiry','condition') NOT NULL,
  `quantity` decimal(14,3) NOT NULL,
  `on_hand_after` decimal(14,3) NOT NULL,
  `unit_cost` decimal(12,2) DEFAULT NULL,
  `source_type` varchar(32) NOT NULL,
  `source_id` varchar(40) NOT NULL,
  `source_line_id` varchar(40) NOT NULL DEFAULT '',
  `reason` varchar(255) NOT NULL DEFAULT '',
  `note` varchar(500) NOT NULL DEFAULT '',
  `reversal_of_id` bigint(20) unsigned DEFAULT NULL,
  `actor_id` varchar(32) DEFAULT NULL,
  `actor_name` varchar(255) NOT NULL DEFAULT 'System',
  `actor_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_movements_source` (`organization_id`,`source_type`,`source_id`,`source_line_id`,`movement_type`,`location_id`),
  KEY `idx_stock_movements_org_created` (`organization_id`,`created_at`),
  KEY `idx_stock_movements_level` (`organization_id`,`location_id`,`variant_id`,`id`),
  KEY `idx_stock_movements_org_type` (`organization_id`,`movement_type`,`created_at`),
  CONSTRAINT `fk_stock_movements_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_stock_movements_quantity` CHECK (`quantity` <> 0),
  CONSTRAINT `chk_stock_movements_after` CHECK (`on_hand_after` >= 0)
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
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_stock_movements_no_update BEFORE UPDATE ON stock_movements
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movements is append-only: record a reversal or an adjustment instead' */;;
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
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_stock_movements_no_delete BEFORE DELETE ON stock_movements
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movements is append-only: record a reversal or an adjustment instead' */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `stock_receipt_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_receipt_lines` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `receipt_id` varchar(32) NOT NULL,
  `purchase_order_line_id` varchar(32) DEFAULT NULL,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `sku` varchar(255) NOT NULL DEFAULT '',
  `item_name` varchar(500) NOT NULL DEFAULT '',
  `packaging_id` varchar(32) DEFAULT NULL,
  `packaging_code` varchar(32) NOT NULL DEFAULT '',
  `packaging_name` varchar(120) NOT NULL DEFAULT '',
  `packaging_quantity` decimal(14,3) DEFAULT NULL,
  `base_per_packaging` decimal(14,3) DEFAULT NULL,
  `base_unit` varchar(8) NOT NULL DEFAULT 'pc',
  `quantity` decimal(14,3) NOT NULL,
  `unit_cost` decimal(12,2) DEFAULT NULL,
  `line_total` decimal(14,2) DEFAULT NULL,
  `lot_id` varchar(32) DEFAULT NULL,
  `lot_ref` varchar(80) NOT NULL DEFAULT '',
  `expiry_date` date DEFAULT NULL,
  `item_condition` enum('sellable','quarantine','damaged') NOT NULL DEFAULT 'sellable',
  `discrepancy` varchar(500) NOT NULL DEFAULT '',
  `position` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_stock_receipt_lines_receipt` (`receipt_id`,`position`),
  KEY `idx_stock_receipt_lines_po_line` (`organization_id`,`purchase_order_line_id`),
  KEY `fk_stock_receipt_lines_receipt` (`organization_id`,`receipt_id`),
  CONSTRAINT `fk_stock_receipt_lines_receipt` FOREIGN KEY (`organization_id`, `receipt_id`) REFERENCES `stock_receipts` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_stock_receipt_lines_qty` CHECK (`quantity` > 0),
  CONSTRAINT `chk_stock_receipt_lines_cost` CHECK (`unit_cost` is null or `unit_cost` >= 0),
  CONSTRAINT `chk_stock_receipt_lines_total` CHECK (`line_total` is null or `line_total` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_receipts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_receipts` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `number` varchar(20) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `supplier_id` varchar(32) DEFAULT NULL,
  `purchase_order_id` varchar(32) DEFAULT NULL,
  `reference` varchar(120) NOT NULL DEFAULT '',
  `supplier_invoice` varchar(120) NOT NULL DEFAULT '',
  `received_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `status` enum('posted','reversed') NOT NULL DEFAULT 'posted',
  `notes` varchar(1000) NOT NULL DEFAULT '',
  `submission_key` varchar(64) DEFAULT NULL,
  `reversed_by_id` varchar(32) DEFAULT NULL,
  `reversed_by_name` varchar(255) DEFAULT NULL,
  `reversed_at` datetime(3) DEFAULT NULL,
  `reversal_reason` varchar(500) NOT NULL DEFAULT '',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_receipts_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_stock_receipts_org_number` (`organization_id`,`number`),
  UNIQUE KEY `uq_stock_receipts_submission` (`organization_id`,`submission_key`),
  KEY `idx_stock_receipts_org_created` (`organization_id`,`created_at`),
  KEY `idx_stock_receipts_po` (`organization_id`,`purchase_order_id`),
  KEY `fk_stock_receipts_location` (`organization_id`,`location_id`),
  KEY `fk_stock_receipts_supplier` (`organization_id`,`supplier_id`),
  CONSTRAINT `fk_stock_receipts_location` FOREIGN KEY (`organization_id`, `location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_receipts_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_stock_receipts_po` FOREIGN KEY (`organization_id`, `purchase_order_id`) REFERENCES `purchase_orders` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_receipts_supplier` FOREIGN KEY (`organization_id`, `supplier_id`) REFERENCES `suppliers` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_reservations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_reservations` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `order_id` varchar(32) NOT NULL,
  `order_item_id` bigint(20) unsigned NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `quantity` decimal(14,3) NOT NULL,
  `status` enum('active','released','consumed') NOT NULL DEFAULT 'active',
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `resolved_at` datetime(3) DEFAULT NULL,
  `resolved_reason` varchar(120) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_reservations_line` (`order_item_id`),
  KEY `idx_stock_reservations_order` (`organization_id`,`order_id`,`status`),
  KEY `idx_stock_reservations_level` (`organization_id`,`location_id`,`variant_id`,`status`),
  CONSTRAINT `fk_stock_reservations_location` FOREIGN KEY (`organization_id`, `location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_reservations_order` FOREIGN KEY (`organization_id`, `order_id`) REFERENCES `orders` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_stock_reservations_quantity` CHECK (`quantity` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_transfer_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_transfer_events` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `organization_id` varchar(32) NOT NULL,
  `transfer_id` varchar(32) NOT NULL,
  `event_type` enum('created','updated','approved','rejected','cancelled','dispatched','received','shortage_resolved') NOT NULL,
  `actor_id` varchar(32) DEFAULT NULL,
  `actor_name` varchar(255) NOT NULL DEFAULT 'System',
  `note` varchar(500) NOT NULL DEFAULT '',
  `details` longtext DEFAULT NULL,
  `client_key` varchar(64) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_transfer_events_client_key` (`organization_id`,`transfer_id`,`client_key`),
  KEY `idx_stock_transfer_events_transfer` (`organization_id`,`transfer_id`,`id`),
  CONSTRAINT `fk_stock_transfer_events_transfer` FOREIGN KEY (`organization_id`, `transfer_id`) REFERENCES `stock_transfers` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
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
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_stock_transfer_events_no_update BEFORE UPDATE ON stock_transfer_events
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_transfer_events is append-only: the timeline records what happened' */;;
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
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER trg_stock_transfer_events_no_delete BEFORE DELETE ON stock_transfer_events
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_transfer_events is append-only: the timeline records what happened' */;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
DROP TABLE IF EXISTS `stock_transfer_line_lots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_transfer_line_lots` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `transfer_id` varchar(32) NOT NULL,
  `line_id` varchar(32) NOT NULL,
  `lot_id` varchar(32) NOT NULL,
  `quantity_dispatched` decimal(14,3) NOT NULL,
  `quantity_received` decimal(14,3) NOT NULL DEFAULT 0.000,
  `quantity_damaged` decimal(14,3) NOT NULL DEFAULT 0.000,
  `quantity_lost` decimal(14,3) NOT NULL DEFAULT 0.000,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_transfer_line_lots` (`line_id`,`lot_id`),
  KEY `idx_stock_transfer_line_lots_transfer` (`organization_id`,`transfer_id`),
  CONSTRAINT `fk_stock_transfer_line_lots_line` FOREIGN KEY (`line_id`) REFERENCES `stock_transfer_lines` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_transfer_line_lots_transfer` FOREIGN KEY (`organization_id`, `transfer_id`) REFERENCES `stock_transfers` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_stock_transfer_line_lots` CHECK (`quantity_dispatched` > 0 and `quantity_received` >= 0 and `quantity_damaged` >= 0 and `quantity_lost` >= 0 and `quantity_received` + `quantity_damaged` + `quantity_lost` <= `quantity_dispatched`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_transfer_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_transfer_lines` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `transfer_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `sku` varchar(255) NOT NULL DEFAULT '',
  `item_name` varchar(500) NOT NULL DEFAULT '',
  `packaging_id` varchar(32) DEFAULT NULL,
  `packaging_code` varchar(32) NOT NULL DEFAULT '',
  `packaging_name` varchar(120) NOT NULL DEFAULT '',
  `packaging_quantity` decimal(14,3) DEFAULT NULL,
  `base_per_packaging` decimal(14,3) DEFAULT NULL,
  `base_unit` varchar(8) NOT NULL DEFAULT 'pc',
  `quantity` decimal(14,3) NOT NULL,
  `reserved_quantity` decimal(14,3) NOT NULL DEFAULT 0.000,
  `quantity_dispatched` decimal(14,3) NOT NULL DEFAULT 0.000,
  `quantity_received` decimal(14,3) NOT NULL DEFAULT 0.000,
  `quantity_damaged` decimal(14,3) NOT NULL DEFAULT 0.000,
  `quantity_lost` decimal(14,3) NOT NULL DEFAULT 0.000,
  `position` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_transfer_lines_variant` (`transfer_id`,`variant_id`),
  KEY `fk_stock_transfer_lines_doc` (`organization_id`,`transfer_id`),
  CONSTRAINT `fk_stock_transfer_lines_doc` FOREIGN KEY (`organization_id`, `transfer_id`) REFERENCES `stock_transfers` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_stock_transfer_lines_qty` CHECK (`quantity` > 0),
  CONSTRAINT `chk_stock_transfer_lines_reserved` CHECK (`reserved_quantity` >= 0),
  CONSTRAINT `chk_stock_transfer_lines_accounted` CHECK (`quantity_dispatched` >= 0 and `quantity_received` >= 0 and `quantity_damaged` >= 0 and `quantity_lost` >= 0 and `quantity_received` + `quantity_damaged` + `quantity_lost` <= `quantity_dispatched`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `stock_transfers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `stock_transfers` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `number` varchar(20) NOT NULL,
  `from_location_id` varchar(32) NOT NULL,
  `to_location_id` varchar(32) NOT NULL,
  `status` enum('draft','approved','in_transit','partially_received','received','rejected','cancelled') NOT NULL DEFAULT 'draft',
  `notes` varchar(1000) NOT NULL DEFAULT '',
  `approved_by_id` varchar(32) DEFAULT NULL,
  `approved_by_name` varchar(255) DEFAULT NULL,
  `approved_at` datetime(3) DEFAULT NULL,
  `rejected_by_id` varchar(32) DEFAULT NULL,
  `rejected_by_name` varchar(255) DEFAULT NULL,
  `rejected_at` datetime(3) DEFAULT NULL,
  `rejection_reason` varchar(500) NOT NULL DEFAULT '',
  `expected_at` date DEFAULT NULL,
  `submission_key` varchar(64) DEFAULT NULL,
  `dispatched_by_id` varchar(32) DEFAULT NULL,
  `dispatched_by_name` varchar(255) DEFAULT NULL,
  `dispatched_at` datetime(3) DEFAULT NULL,
  `received_by_id` varchar(32) DEFAULT NULL,
  `received_by_name` varchar(255) DEFAULT NULL,
  `received_at` datetime(3) DEFAULT NULL,
  `cancelled_by_id` varchar(32) DEFAULT NULL,
  `cancelled_by_name` varchar(255) DEFAULT NULL,
  `cancelled_at` datetime(3) DEFAULT NULL,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_transfers_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_stock_transfers_org_number` (`organization_id`,`number`),
  UNIQUE KEY `uq_stock_transfers_submission` (`organization_id`,`submission_key`),
  KEY `idx_stock_transfers_org_status` (`organization_id`,`status`,`created_at`),
  KEY `fk_stock_transfers_from` (`organization_id`,`from_location_id`),
  KEY `fk_stock_transfers_to` (`organization_id`,`to_location_id`),
  CONSTRAINT `fk_stock_transfers_from` FOREIGN KEY (`organization_id`, `from_location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_transfers_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_stock_transfers_to` FOREIGN KEY (`organization_id`, `to_location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_stock_transfers_locations` CHECK (`from_location_id` <> `to_location_id`)
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
DROP TABLE IF EXISTS `supplier_return_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `supplier_return_lines` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `return_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `product_id` varchar(32) NOT NULL,
  `sku` varchar(255) NOT NULL DEFAULT '',
  `item_name` varchar(500) NOT NULL DEFAULT '',
  `quantity` decimal(14,3) NOT NULL,
  `unit_cost` decimal(12,2) DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_supplier_return_lines_doc` (`return_id`,`position`),
  KEY `fk_supplier_return_lines_doc` (`organization_id`,`return_id`),
  CONSTRAINT `fk_supplier_return_lines_doc` FOREIGN KEY (`organization_id`, `return_id`) REFERENCES `supplier_returns` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_supplier_return_lines_qty` CHECK (`quantity` > 0),
  CONSTRAINT `chk_supplier_return_lines_cost` CHECK (`unit_cost` is null or `unit_cost` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `supplier_returns`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `supplier_returns` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `number` varchar(20) NOT NULL,
  `supplier_id` varchar(32) NOT NULL,
  `location_id` varchar(32) NOT NULL,
  `receipt_id` varchar(32) DEFAULT NULL,
  `reference` varchar(120) NOT NULL DEFAULT '',
  `reason` varchar(500) NOT NULL DEFAULT '',
  `notes` varchar(1000) NOT NULL DEFAULT '',
  `submission_key` varchar(64) DEFAULT NULL,
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_supplier_returns_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_supplier_returns_org_number` (`organization_id`,`number`),
  UNIQUE KEY `uq_supplier_returns_submission` (`organization_id`,`submission_key`),
  KEY `fk_supplier_returns_supplier` (`organization_id`,`supplier_id`),
  KEY `fk_supplier_returns_location` (`organization_id`,`location_id`),
  KEY `fk_supplier_returns_receipt` (`organization_id`,`receipt_id`),
  CONSTRAINT `fk_supplier_returns_location` FOREIGN KEY (`organization_id`, `location_id`) REFERENCES `stock_locations` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_supplier_returns_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_supplier_returns_receipt` FOREIGN KEY (`organization_id`, `receipt_id`) REFERENCES `stock_receipts` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_supplier_returns_supplier` FOREIGN KEY (`organization_id`, `supplier_id`) REFERENCES `suppliers` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `suppliers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `suppliers` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `code` varchar(32) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `contact_name` varchar(255) NOT NULL DEFAULT '',
  `email` varchar(255) NOT NULL DEFAULT '',
  `phone` varchar(64) NOT NULL DEFAULT '',
  `address` varchar(500) NOT NULL DEFAULT '',
  `payment_terms` varchar(120) NOT NULL DEFAULT '',
  `notes` varchar(1000) NOT NULL DEFAULT '',
  `status` enum('Active','Archived') NOT NULL DEFAULT 'Active',
  `created_by_id` varchar(32) DEFAULT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_by_email` varchar(255) DEFAULT NULL,
  `updated_by_id` varchar(32) DEFAULT NULL,
  `updated_by_name` varchar(255) DEFAULT NULL,
  `updated_by_email` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_suppliers_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_suppliers_org_name` (`organization_id`,`name`),
  UNIQUE KEY `uq_suppliers_org_code` (`organization_id`,`code`),
  KEY `idx_suppliers_org_status` (`organization_id`,`status`),
  CONSTRAINT `fk_suppliers_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
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
DROP TABLE IF EXISTS `variant_packagings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `variant_packagings` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `code` varchar(32) NOT NULL,
  `name` varchar(120) NOT NULL,
  `base_quantity` decimal(14,3) NOT NULL,
  `sku` varchar(255) DEFAULT NULL,
  `barcode` varchar(64) DEFAULT NULL,
  `price` decimal(12,2) DEFAULT NULL,
  `sells` tinyint(1) NOT NULL DEFAULT 1,
  `receives` tinyint(1) NOT NULL DEFAULT 1,
  `position` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_variant_packagings_org_id` (`organization_id`,`id`),
  UNIQUE KEY `uq_variant_packagings_code` (`variant_id`,`code`),
  UNIQUE KEY `uq_variant_packagings_org_barcode` (`organization_id`,`barcode`),
  UNIQUE KEY `uq_variant_packagings_org_sku` (`organization_id`,`sku`),
  KEY `fk_variant_packagings_variant` (`organization_id`,`variant_id`),
  CONSTRAINT `fk_variant_packagings_variant` FOREIGN KEY (`organization_id`, `variant_id`) REFERENCES `product_variants` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_variant_packagings_qty` CHECK (`base_quantity` > 0),
  CONSTRAINT `chk_variant_packagings_price` CHECK (`price` is null or `price` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `variant_price_overrides`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `variant_price_overrides` (
  `id` varchar(32) NOT NULL,
  `organization_id` varchar(32) NOT NULL,
  `variant_id` varchar(32) NOT NULL,
  `channel` enum('pos') NOT NULL DEFAULT 'pos',
  `branch_key` varchar(32) NOT NULL DEFAULT '',
  `price` decimal(12,2) NOT NULL,
  `created_by_name` varchar(255) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_variant_price_overrides` (`organization_id`,`variant_id`,`channel`,`branch_key`),
  CONSTRAINT `fk_variant_price_overrides_variant` FOREIGN KEY (`organization_id`, `variant_id`) REFERENCES `product_variants` (`organization_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_variant_price_overrides_price` CHECK (`price` >= 0)
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
/*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
/*!50003 SET sql_mode              = 'IGNORE_SPACE,STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION' */ ;
/*!50003 DROP FUNCTION IF EXISTS `online_available` */;
/*!50003 SET @saved_cs_client      = @@character_set_client */ ;
/*!50003 SET @saved_cs_results     = @@character_set_results */ ;
/*!50003 SET @saved_col_connection = @@collation_connection */ ;
/*!50003 SET character_set_client  = utf8mb4 */ ;
/*!50003 SET character_set_results = utf8mb4 */ ;
/*!50003 SET collation_connection  = utf8mb4_unicode_ci */ ;
DELIMITER ;;
CREATE DEFINER=`root`@`localhost` FUNCTION `online_available`(p_org VARCHAR(32) COLLATE utf8mb4_unicode_ci, p_variant VARCHAR(32) COLLATE utf8mb4_unicode_ci) RETURNS int(11)
    READS SQL DATA
RETURN COALESCE((
  SELECT MAX(FLOOR(GREATEST(sl.on_hand - sl.reserved - COALESCE(x.expired_qty, 0), 0)))
    FROM stock_levels sl
    JOIN stock_locations l ON l.id = sl.location_id AND l.organization_id = sl.organization_id
    LEFT JOIN (
      SELECT ll.location_id, SUM(ll.on_hand) AS expired_qty
        FROM stock_lot_levels ll
        JOIN stock_lots lt ON lt.id = ll.lot_id AND lt.organization_id = ll.organization_id
       WHERE ll.organization_id = p_org AND ll.variant_id = p_variant
         AND lt.expiry_date IS NOT NULL AND lt.expiry_date < UTC_DATE()
       GROUP BY ll.location_id
    ) x ON x.location_id = sl.location_id
   WHERE sl.organization_id = p_org AND sl.variant_id = p_variant
     AND l.status = 'Active' AND l.fulfils_online = 1
), 0) ;;
DELIMITER ;
/*!50003 SET sql_mode              = @saved_sql_mode */ ;
/*!50003 SET character_set_client  = @saved_cs_client */ ;
/*!50003 SET character_set_results = @saved_cs_results */ ;
/*!50003 SET collation_connection  = @saved_col_connection */ ;
/*!50001 DROP VIEW IF EXISTS `stock_availability`*/;
/*!50001 SET @saved_cs_client          = @@character_set_client */;
/*!50001 SET @saved_cs_results         = @@character_set_results */;
/*!50001 SET @saved_col_connection     = @@collation_connection */;
/*!50001 SET character_set_client      = utf8mb4 */;
/*!50001 SET character_set_results     = utf8mb4 */;
/*!50001 SET collation_connection      = utf8mb4_unicode_ci */;
/*!50001 CREATE ALGORITHM=UNDEFINED */
/*!50013 DEFINER=`root`@`localhost` SQL SECURITY DEFINER */
/*!50001 VIEW `stock_availability` AS select `sl`.`organization_id` AS `organization_id`,`sl`.`location_id` AS `location_id`,`sl`.`variant_id` AS `variant_id`,`sl`.`product_id` AS `product_id`,`sl`.`on_hand` AS `on_hand`,`sl`.`reserved` AS `reserved`,coalesce(`x`.`expired_qty`,0) AS `expired_unswept`,greatest(`sl`.`on_hand` - `sl`.`reserved` - coalesce(`x`.`expired_qty`,0),0) AS `available` from (`stock_levels` `sl` left join (select `ll`.`organization_id` AS `organization_id`,`ll`.`location_id` AS `location_id`,`ll`.`variant_id` AS `variant_id`,sum(`ll`.`on_hand`) AS `expired_qty` from (`stock_lot_levels` `ll` join `stock_lots` `lt` on(`lt`.`id` = `ll`.`lot_id` and `lt`.`organization_id` = `ll`.`organization_id`)) where `lt`.`expiry_date` is not null and `lt`.`expiry_date` < utc_date() group by `ll`.`organization_id`,`ll`.`location_id`,`ll`.`variant_id`) `x` on(`x`.`organization_id` = `sl`.`organization_id` and `x`.`location_id` = `sl`.`location_id` and `x`.`variant_id` = `sl`.`variant_id`)) */;
/*!50001 SET character_set_client      = @saved_cs_client */;
/*!50001 SET character_set_results     = @saved_cs_results */;
/*!50001 SET collation_connection      = @saved_col_connection */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

