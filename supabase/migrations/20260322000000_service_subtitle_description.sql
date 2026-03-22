-- Add subtitle column to services table.
-- subtitle: short tagline shown to callers (e.g., "Full rotation + balance")
-- description column already exists (from 20260308000000_create_services.sql),
-- but set a default for consistency.

ALTER TABLE services ADD COLUMN IF NOT EXISTS subtitle TEXT DEFAULT '';

-- Ensure description has a default (original migration had no default)
ALTER TABLE services ALTER COLUMN description SET DEFAULT '';

-- Backfill NULLs so existing rows are consistent
UPDATE services SET subtitle = '' WHERE subtitle IS NULL;
UPDATE services SET description = '' WHERE description IS NULL;
