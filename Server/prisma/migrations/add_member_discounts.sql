-- Add RobotX flat discount fields to ticket_types
ALTER TABLE `ticket_types`
  ADD COLUMN `robotxDiscountType` VARCHAR(20) NULL,
  ADD COLUMN `robotxDiscountValue` INT NULL;

-- Create SRA member per-tier discount table
CREATE TABLE `ticket_type_sra_discounts` (
  `id` CHAR(36) NOT NULL,
  `ticketTypeId` CHAR(36) NOT NULL,
  `membershipTier` VARCHAR(50) NOT NULL,
  `discountType` VARCHAR(20) NOT NULL,
  `discountValue` INT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `ticket_type_sra_discounts_ticketTypeId_membershipTier_key` (`ticketTypeId`, `membershipTier`),
  INDEX `ticket_type_sra_discounts_ticketTypeId_idx` (`ticketTypeId`),
  CONSTRAINT `ticket_type_sra_discounts_ticketTypeId_fkey`
    FOREIGN KEY (`ticketTypeId`) REFERENCES `ticket_types` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
