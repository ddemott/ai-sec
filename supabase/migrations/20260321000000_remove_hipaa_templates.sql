-- Remove health-related business templates (HIPAA exclusion)
-- These verticals require BAA, specific encryption, audit requirements,
-- and breach notification procedures. Excluded until formal compliance
-- program is in place with legal counsel.

DELETE FROM business_templates WHERE business_type IN ('dentist', 'chiropractor', 'vet-clinic');
