-- Add maxStaff column to ticket_types for exhibitor staff pass limits
-- Previously stored in FormSchema.fields JSON; moved to TicketType for per-ticket control
ALTER TABLE `ticket_types` ADD COLUMN `maxStaff` INT NULL AFTER `maxPerOrder`;
