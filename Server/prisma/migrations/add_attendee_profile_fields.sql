-- Migration: add_attendee_profile_fields
-- Apply with: npx prisma db push  (or run this SQL directly on the MariaDB instance)
-- Generated: 2026-02-20

ALTER TABLE `attendees`
  ADD COLUMN `badgeName`          VARCHAR(100)  NULL AFTER `company`,
  ADD COLUMN `jobTitle`           VARCHAR(150)  NULL AFTER `badgeName`,
  ADD COLUMN `orgRole`            VARCHAR(100)  NULL AFTER `jobTitle`,
  ADD COLUMN `dietaryNeeds`       VARCHAR(255)  NULL AFTER `orgRole`,
  ADD COLUMN `accessibilityNeeds` VARCHAR(255)  NULL AFTER `dietaryNeeds`,
  ADD COLUMN `consentMarketing`   TINYINT(1)    NOT NULL DEFAULT 0 AFTER `accessibilityNeeds`,
  ADD COLUMN `consentDataSharing` TINYINT(1)    NOT NULL DEFAULT 0 AFTER `consentMarketing`,
  ADD COLUMN `consentTimestamp`   DATETIME(3)   NULL AFTER `consentDataSharing`,
  ADD COLUMN `tags`               JSON          NULL AFTER `consentTimestamp`;
