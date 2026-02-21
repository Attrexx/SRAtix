-- Migration: add_pricing_variants_form_templates_field_repo
-- Apply with: npx prisma db push  (or run this SQL directly on the MariaDB instance)
-- Generated: 2026-02-21
--
-- Adds:
--   1. ticket_types: category, membershipTier, wpProductId columns
--   2. pricing_variants table (PricingVariant model)
--   3. form_templates table (FormTemplate model)
--   4. field_definitions table (FieldDefinition model — global field repository)

-- ═══════════════════════════════════════════════════════════════
-- 1. Extend ticket_types with category & membership fields
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE `ticket_types`
  ADD COLUMN `category`        VARCHAR(30)  NOT NULL DEFAULT 'general' AFTER `formSchemaId`,
  ADD COLUMN `membershipTier`  VARCHAR(50)  NULL AFTER `category`,
  ADD COLUMN `wpProductId`     INT          NULL AFTER `membershipTier`,
  ADD INDEX `idx_ticket_types_category` (`category`);

-- ═══════════════════════════════════════════════════════════════
-- 2. Pricing variants — time-windowed price tiers per ticket type
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE `pricing_variants` (
  `id`              CHAR(36)     NOT NULL,
  `ticketTypeId`    CHAR(36)     NOT NULL,
  `variantType`     VARCHAR(30)  NOT NULL,
  `label`           VARCHAR(100) NOT NULL,
  `priceCents`      INT          NOT NULL DEFAULT 0,
  `validFrom`       DATETIME(3)  NULL,
  `validUntil`      DATETIME(3)  NULL,
  `wpProductId`     INT          NULL,
  `membershipTier`  VARCHAR(50)  NULL,
  `sortOrder`       INT          NOT NULL DEFAULT 0,
  `active`          TINYINT(1)   NOT NULL DEFAULT 1,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pricing_variants_type` (`ticketTypeId`, `variantType`),
  INDEX `idx_pricing_variants_ticket` (`ticketTypeId`),
  CONSTRAINT `fk_pricing_variants_ticket` FOREIGN KEY (`ticketTypeId`)
    REFERENCES `ticket_types` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════
-- 3. Form templates — reusable form configs scoped to Organization
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE `form_templates` (
  `id`          CHAR(36)     NOT NULL,
  `orgId`       CHAR(36)     NOT NULL,
  `name`        VARCHAR(255) NOT NULL,
  `description` VARCHAR(500) NULL,
  `category`    VARCHAR(50)  NULL,
  `fields`      JSON         NOT NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_form_templates_org_name` (`orgId`, `name`),
  INDEX `idx_form_templates_org` (`orgId`),
  CONSTRAINT `fk_form_templates_org` FOREIGN KEY (`orgId`)
    REFERENCES `organizations` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════
-- 4. Field definitions — global repository of available form fields
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE `field_definitions` (
  `id`                  CHAR(36)     NOT NULL,
  `slug`                VARCHAR(100) NOT NULL,
  `label`               JSON         NOT NULL,
  `type`                VARCHAR(30)  NOT NULL,
  `group`               VARCHAR(50)  NOT NULL,
  `options`             JSON         NULL,
  `defaultWidthDesktop` INT          NOT NULL DEFAULT 100,
  `defaultWidthMobile`  INT          NOT NULL DEFAULT 100,
  `validationRules`     JSON         NULL,
  `helpText`            JSON         NULL,
  `placeholder`         JSON         NULL,
  `defaultValue`        JSON         NULL,
  `categoryFilter`      JSON         NULL,
  `conditionalOn`       JSON         NULL,
  `sortOrder`           INT          NOT NULL DEFAULT 0,
  `isSystem`            TINYINT(1)   NOT NULL DEFAULT 0,
  `active`              TINYINT(1)   NOT NULL DEFAULT 1,
  `createdAt`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_field_definitions_slug` (`slug`),
  INDEX `idx_field_definitions_group` (`group`),
  INDEX `idx_field_definitions_system` (`isSystem`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
