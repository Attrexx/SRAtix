-- Add documentUrl (i18n JSON) to field_definitions for linking consent fields to their documents
ALTER TABLE `field_definitions` ADD COLUMN `documentUrl` JSON NULL AFTER `conditionalOn`;
