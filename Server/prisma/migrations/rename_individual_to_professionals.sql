-- Membership tier restructure: rename 'individual' → 'professionals'
-- Part of v0.3.0 — SRA membership tier expansion.
--
-- Background:
--   "Individuals" tier (product 4601) is renamed to "Professionals".
--   The internal slug changes from 'individual' to 'professionals'.
--   All VARCHAR columns storing membership tier slugs must be updated.
--
-- Tables affected:
--   ticket_types.membershipTier
--   ticket_type_sra_discounts.membershipTier
--   pricing_variants.membershipTier
--
-- This migration is IDEMPOTENT — safe to run multiple times.

-- 1. Ticket types
UPDATE `ticket_types`
SET    `membershipTier` = 'professionals'
WHERE  `membershipTier` = 'individual';

-- 2. SRA per-tier discounts
UPDATE `ticket_type_sra_discounts`
SET    `membershipTier` = 'professionals'
WHERE  `membershipTier` = 'individual';

-- 3. Pricing variants (membership variants carry the tier slug)
UPDATE `pricing_variants`
SET    `membershipTier` = 'professionals'
WHERE  `membershipTier` = 'individual';
