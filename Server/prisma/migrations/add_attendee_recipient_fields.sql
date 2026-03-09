-- Migration: Add attendee recipient registration fields
-- Date: 2026-03-09
-- Purpose: Support multi-ticket purchasing with designated recipients
--
-- New fields on `attendees` table:
--   status                     — attendee lifecycle (invited | registered | confirmed | cancelled)
--   registrationToken          — one-time token for tokenized registration link
--   registrationTokenExpiresAt — expiry (event end date at 23:59:59)
--   purchasedByAttendeeId      — self-referencing FK to purchasing attendee
--
-- All fields are nullable or have defaults — fully backward compatible.
-- Existing attendees get status='registered' (default).

ALTER TABLE `attendees`
  ADD COLUMN `status` VARCHAR(30) NOT NULL DEFAULT 'registered' AFTER `company`,
  ADD COLUMN `registration_token` VARCHAR(64) NULL DEFAULT NULL AFTER `status`,
  ADD COLUMN `registration_token_expires_at` DATETIME(3) NULL DEFAULT NULL AFTER `registration_token`,
  ADD COLUMN `purchased_by_attendee_id` CHAR(36) NULL DEFAULT NULL AFTER `registration_token_expires_at`;

-- Unique index on registration token (for fast lookups + enforce uniqueness)
ALTER TABLE `attendees`
  ADD UNIQUE INDEX `attendees_registration_token_key` (`registration_token`);

-- Index for finding recipients by status (invited attendees needing reminders)
ALTER TABLE `attendees`
  ADD INDEX `attendees_status_idx` (`status`);

-- Index for finding all recipients purchased by a specific attendee
ALTER TABLE `attendees`
  ADD INDEX `attendees_purchased_by_attendee_id_idx` (`purchased_by_attendee_id`);

-- Foreign key: self-referencing to purchasing attendee
ALTER TABLE `attendees`
  ADD CONSTRAINT `attendees_purchased_by_attendee_id_fkey`
  FOREIGN KEY (`purchased_by_attendee_id`) REFERENCES `attendees` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
