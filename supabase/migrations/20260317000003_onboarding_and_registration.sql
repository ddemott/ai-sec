-- Add onboarding_completed flag to tenants
-- Used by wizard detection: show onboarding wizard when false and no services/resources/employees
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;
